package kr.kro.mungsil

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.PublicProfileModel
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class PublicProfileModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val person = PublicPerson("other", "cloud", "구름", "", "", "조각구름", 120, 1, 2, 3)
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun lateProfileCannotRestorePreviousAccountsRecords() = runTest(dispatcher) {
        val delayed = CompletableDeferred<PublicPerson>()
        val source = object : PublicProfileSource {
            override suspend fun profile(handle: String, auth: Boolean) = if(handle == "old") withContext(NonCancellable) { delayed.await() } else person.copy(id = "new", handle = "new")
            override suspend fun followStatus(id: String) = FollowStatus(false, false, 2, 3)
        }
        val model = PublicProfileModel(source)
        model.load("old", true, "first-viewer"); runCurrent()
        model.load("new", true, "next-viewer"); runCurrent()
        delayed.complete(person); advanceUntilIdle()
        assertEquals("new", model.state.value.person.data!!.id)
    }
    @Test fun lateRelationshipCannotOverwriteNewerBlockAndAccessLossClearsPerson() = runTest(dispatcher) {
        val delayed = CompletableDeferred<FollowStatus>(); var calls = 0; var revoked = false
        val source = object : PublicProfileSource {
            override suspend fun profile(handle: String, auth: Boolean): PublicPerson { if(revoked) throw ApiException(403, "접근할 수 없어요."); return person }
            override suspend fun followStatus(id: String) = if(++calls == 1) withContext(NonCancellable) { delayed.await() } else FollowStatus(false, true, 0, 3)
        }
        val model = PublicProfileModel(source)
        model.load("cloud", true, "viewer"); runCurrent(); model.retryRelation(); runCurrent()
        delayed.complete(FollowStatus(true, false, 3, 3)); advanceUntilIdle()
        assertTrue(model.state.value.relation.data!!.blocked)
        revoked = true; model.load("cloud", true, "viewer"); advanceUntilIdle()
        assertNull(model.state.value.person.data); assertNull(model.state.value.relation.data); assertNotNull(model.state.value.person.error)
    }
}
