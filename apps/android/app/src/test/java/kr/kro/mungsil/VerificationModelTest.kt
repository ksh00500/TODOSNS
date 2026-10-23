package kr.kro.mungsil

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.VerificationModel
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class VerificationModelTest {
    private val dispatcher = StandardTestDispatcher()
    private fun item() = json("checkInId" to "check", "attempt" to 1, "challenge" to json("id" to "challenge", "title" to "산책"),
        "criteria" to listOf("실천이 확인되나요?"), "mediaUrl" to "https://media.example.test/photo")
    private fun queue() = json("contributionCount" to 2, "items" to listOf(item()))
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun malformedQueueDoesNotBecomeNoPhotos() {
        for(bad in listOf(queue().apply { remove("items") }, queue().apply { addProperty("contributionCount", "2") },
            queue().apply { list("items").first().remove("challenge") }, queue().apply { list("items").first().add("criteria", json()) },
            queue().apply { list("items").first().add("criteria", com.google.gson.Gson().toJsonTree(emptyList<String>())) },
            queue().apply { list("items").first().addProperty("attempt", 0) })) assertThrows(ApiException::class.java) { parseVerificationQueue(bad) }
        val empty = parseVerificationQueue(json("contributionCount" to 0, "items" to emptyList<String>()))
        assertTrue(empty.items.isEmpty()); assertEquals(0, empty.contributions)
    }
    @Test fun identitySeparatesNewAttemptsAndChangedCriteriaButNotRepeatedRows() {
        val data = queue(); data.getAsJsonArray("items").add(item())
        assertEquals(1, parseVerificationQueue(data).items.size)
        val original = parseVerificationQueue(queue()).items.single()
        val changed = item().apply { addProperty("attempt", 2) }
        assertNotEquals(original.identity, parseVerificationQueue(json("contributionCount" to 2, "items" to listOf(changed))).items.single().identity)
        assertNotEquals(original.identity, original.copy(criteria = listOf("다른 기준인가요?")).identity)
    }
    @Test fun staleNonCancellableQueueCannotReplaceCurrentChallenge() = runTest(dispatcher) {
        val first = CompletableDeferred<VerificationQueue>(); val next = CompletableDeferred<VerificationQueue>()
        val source = object : VerificationSource { override suspend fun queue(challengeId: String) = withContext(NonCancellable) { if(challengeId == "old") first.await() else next.await() } }
        val model = VerificationModel(source); model.load("old"); runCurrent(); model.load("new"); runCurrent()
        first.complete(parseVerificationQueue(queue())); runCurrent()
        assertNull(model.state.value.data); assertTrue(model.state.value.loading)
        next.complete(VerificationQueue(4, emptyList())); advanceUntilIdle()
        assertEquals(4, model.state.value.data!!.contributions); assertFalse(model.state.value.loading)
    }
    @Test fun retryKeepsFailureSeparateFromAValidEmptyQueue() = runTest(dispatcher) {
        var fail = true
        val source = object : VerificationSource { override suspend fun queue(challengeId: String): VerificationQueue {
            if(fail) throw ApiException(503, "다시 불러와주세요."); return VerificationQueue(3, emptyList())
        } }
        val model = VerificationModel(source); model.load("challenge"); advanceUntilIdle()
        assertNotNull(model.state.value.error); assertNull(model.state.value.data)
        fail = false; model.load("challenge"); advanceUntilIdle()
        assertNull(model.state.value.error); assertTrue(model.state.value.data!!.items.isEmpty())
    }
}
