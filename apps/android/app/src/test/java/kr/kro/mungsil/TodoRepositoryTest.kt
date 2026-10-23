package kr.kro.mungsil

import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.util.concurrent.TimeUnit

class TodoRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private lateinit var repository: TodoRepository
    private val original = json("id" to "todo", "title" to "산책", "dueDate" to "2026-10-23T09:00:30.123Z", "completedAt" to null)
    private val serverTime = "2026-10-23T09:32:12.345Z"
    @Before fun setup() {
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object : SessionStore {
            override fun read(): String? = null
            override fun write(value: String?) {}
        })
        repository = TodoRepository(api)
    }
    @After fun cleanup() { server.shutdown() }

    @Test fun completionUsesEnvelopeAndPreservesCanonicalServerFields() = runBlocking {
        val canonical = original.deepCopy().apply { addProperty("completedAt", serverTime); addProperty("title", "서버에서 확인한 제목"); addProperty("seriesId", "series") }
        server.enqueue(MockResponse().setBody(json("todo" to canonical, "post" to null, "sharePrompt" to true).toString()))
        val saved = repository.complete(TodoRecord.parse(original), "complete-key")
        assertEquals(serverTime, saved.completedAt)
        assertEquals("서버에서 확인한 제목", saved.title)
        assertEquals("series", saved.source.text("seriesId"))
        val request = server.takeRequest()
        assertEquals("/api/v1/todos/todo/complete", request.path)
        assertEquals("POST", request.method)
        assertEquals("complete-key", request.getHeader("Idempotency-Key"))
        assertEquals("{\"share\":false}", request.body.readUtf8())
    }
    @Test fun undoUsesFlatResponseAndKeepsExactSchedule() = runBlocking {
        server.enqueue(MockResponse().setBody(original.toString()))
        val completed = original.deepCopy().apply { addProperty("completedAt", serverTime) }
        val saved = repository.complete(TodoRecord.parse(completed), "undo-key")
        assertNull(saved.completedAt)
        assertEquals("2026-10-23T09:00:30.123Z", saved.dueDate)
        val request = server.takeRequest()
        assertEquals("/api/v1/todos/todo/uncomplete", request.path)
        assertEquals("undo-key", request.getHeader("Idempotency-Key"))
        assertEquals("{}", request.body.readUtf8())
    }
    @Test fun malformedCompletionCannotConfirmAnOptimisticRow() = runBlocking {
        val completed = original.deepCopy().apply { addProperty("completedAt", serverTime) }
        val wrongId = completed.deepCopy().apply { addProperty("id", "another") }
        val badTime = completed.deepCopy().apply { addProperty("completedAt", "not-a-time") }
        val missingState = completed.deepCopy().apply { remove("completedAt") }
        val wrongType = completed.deepCopy().apply { addProperty("completedAt", true) }
        val cases = listOf("{}", "[]", json("todo" to wrongId).toString(), json("todo" to badTime).toString(),
            json("todo" to missingState).toString(), json("todo" to wrongType).toString(), json("todo" to original).toString())
        for((index, body) in cases.withIndex()) {
            server.enqueue(MockResponse().setBody(body))
            val error = runCatching { repository.complete(TodoRecord.parse(original), "invalid-$index") }.exceptionOrNull()
            assertTrue("Malformed case $index must fail", error is ApiException)
            assertEquals("TODO_RESPONSE_INVALID", (error as ApiException).code)
        }
    }
    @Test fun undoRejectsEnvelopeOrStillCompletedState() = runBlocking {
        val completed = original.deepCopy().apply { addProperty("completedAt", serverTime) }
        for(body in listOf(json("todo" to original).toString(), completed.toString(), original.deepCopy().apply { remove("completedAt") }.toString())) {
            server.enqueue(MockResponse().setBody(body))
            val error = runCatching { repository.complete(TodoRecord.parse(completed), "invalid-undo") }.exceptionOrNull() as ApiException
            assertEquals("TODO_RESPONSE_INVALID", error.code)
        }
    }
    @Test fun publishedUndoKeepsServerRejectionAndDoesNotDeleteAnything() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"message":"게시물을 먼저 삭제한 뒤 완료를 취소해주세요."}"""))
        val completed = original.deepCopy().apply { addProperty("completedAt", serverTime) }
        val error = runCatching { repository.complete(TodoRecord.parse(completed), "undo") }.exceptionOrNull() as ApiException
        assertEquals(400, error.status)
        assertTrue(error.message.contains("게시물"))
        assertEquals(1, server.requestCount)
        assertEquals("POST", server.takeRequest().method)
    }
    @Test fun lateCompletionCannotCrossAClearedAccountSession() = runBlocking {
        val completed = original.deepCopy().apply { addProperty("completedAt", serverTime) }
        server.enqueue(MockResponse().setBody(json("todo" to completed).toString()).setBodyDelay(150, TimeUnit.MILLISECONDS))
        val pending = async { runCatching { repository.complete(TodoRecord.parse(original), "old-session") } }
        withContext(Dispatchers.IO) { checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)) }
        api.clear()
        val error = pending.await().exceptionOrNull() as ApiException
        assertEquals(401, error.status)
        assertEquals(1, server.requestCount)
    }
}
