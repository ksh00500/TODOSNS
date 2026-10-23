package kr.kro.mungsil

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.ProfileModel
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val profile = ProfileRecord("user", "cloud", "구름", "", "", emptyList(), "구름씨앗", 0, 0, 0, 0, 0, 0, 0, 0, emptyList())
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun growthAndBadgesUseExactThresholdsAndUnknownGroupState() {
        assertEquals(1, profileGrowth(99).remaining)
        assertEquals(200, profileGrowth(100).remaining)
        assertEquals(5000, profileGrowth(4999).next)
        assertNull(profileGrowth(5000).next)
        assertEquals(1f, profileGrowth(5000).progress)
        val thresholds = listOf(100, 300, 800, 2000, 5000)
        thresholds.forEachIndexed { index, threshold ->
            assertEquals(threshold, profileGrowth(threshold - 1).next)
            assertEquals(1, profileGrowth(threshold - 1).remaining)
            assertEquals(thresholds.getOrNull(index + 1), profileGrowth(threshold).next)
        }
        assertNull(profileBadges(profile, null).first { it.id == "routine-maker" }.unlocked)
        assertEquals(false, profileBadges(profile, 0).first { it.id == "routine-maker" }.unlocked)
        assertEquals(true, profileBadges(profile.copy(power = 100), 1).first { it.id == "rank-piece" }.unlocked)
    }
    @Test fun groupErrorIsNotAnEmptyListAndRetryDoesNotReloadProfile() = runTest(dispatcher) {
        var failed = true; var profileCalls = 0
        val source = object : ProfileSource {
            override suspend fun profile(): ProfileRecord { profileCalls++; return profile }
            override suspend fun groups(): List<ProfileGroup> { if(failed) throw java.io.IOException(); return emptyList() }
            override suspend fun posts(handle: String) = emptyList<ProfilePost>()
        }
        val model = ProfileModel(source); model.load(); advanceUntilIdle()
        assertNotNull(model.state.value.profile.data)
        assertNotNull(model.state.value.groups.error)
        assertNull(model.state.value.groups.data)
        failed = false; model.retryGroups(); advanceUntilIdle()
        assertEquals(emptyList<ProfileGroup>(), model.state.value.groups.data)
        assertEquals(1, profileCalls)
    }
    @Test fun supersededResponseCannotReplaceAnotherAccountsProfile() = runTest(dispatcher) {
        val delayed = CompletableDeferred<ProfileRecord>(); var calls = 0
        val source = object : ProfileSource {
            override suspend fun profile(): ProfileRecord = if(++calls == 1) withContext(NonCancellable) { delayed.await() } else profile.copy(id = "next-user", handle = "next")
            override suspend fun groups() = emptyList<ProfileGroup>()
            override suspend fun posts(handle: String) = listOf(ProfilePost(handle, handle, "", 0))
        }
        val model = ProfileModel(source); model.load(); runCurrent(); model.load(); runCurrent()
        delayed.complete(profile); advanceUntilIdle()
        assertEquals("next-user", model.state.value.profile.data!!.id)
        assertEquals("next", model.state.value.posts.data!!.single().id)
    }
    @Test fun invalidRequiredCountIsNotDisplayedAsZero() {
        val payload = json("id" to "user", "handle" to "cloud", "nickname" to "구름", "rank" to "구름씨앗", "lifetimePower" to 0)
        try { parseProfile(payload); fail("A missing points/count field must fail explicitly") }
        catch(e: ApiException) { assertEquals("PROFILE_RESPONSE_INVALID", e.code) }
    }

    @Test fun supersededGroupRetryCannotRestoreOldBadgeState() = runTest(dispatcher) {
        var calls = 0; val first = CompletableDeferred<List<ProfileGroup>>()
        val source = object : ProfileSource {
            override suspend fun profile() = profile
            override suspend fun groups(): List<ProfileGroup> = if(++calls == 1) withContext(NonCancellable) { first.await() } else emptyList()
            override suspend fun posts(handle: String) = emptyList<ProfilePost>()
        }
        val model = ProfileModel(source); model.load(); runCurrent(); model.retryGroups(); runCurrent()
        first.complete(listOf(ProfileGroup("old", "이전 그룹", "", 1, 0))); advanceUntilIdle()
        assertEquals(emptyList<ProfileGroup>(), model.state.value.groups.data)
    }
    @Test fun supersededPostRetryCannotReplaceNewerRecords() = runTest(dispatcher) {
        var calls = 0; val first = CompletableDeferred<List<ProfilePost>>()
        val source = object : ProfileSource {
            override suspend fun profile() = profile
            override suspend fun groups() = emptyList<ProfileGroup>()
            override suspend fun posts(handle: String): List<ProfilePost> = if(++calls == 1) withContext(NonCancellable) { first.await() } else listOf(ProfilePost("new", "최근 실천", "", 1))
        }
        val model = ProfileModel(source); model.load(); runCurrent(); model.retryPosts(); runCurrent()
        first.complete(listOf(ProfilePost("old", "이전 실천", "", 0))); advanceUntilIdle()
        assertEquals("new", model.state.value.posts.data!!.single().id)
    }
}
