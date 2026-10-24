package kr.kro.mungsil

import com.google.gson.JsonParser
import kotlinx.coroutines.runBlocking
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.Test
import org.junit.Assert.*
import java.io.IOException
import java.util.concurrent.TimeUnit

class CheerResolutionTest {
    private fun api(server: MockWebServer) = Api(server.url("/api/v1/").toString(),object : SessionStore {
        override fun read(): String? = null
        override fun write(value: String?) {}
    })
    @Test fun expiredReceiptCanBeReconciledWithoutAnotherToggleAndThenAcceptANewGesture() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server)
            val state = CheerState("a","post",false,2)
            val original = state.begin(1000)!!; state.failed(original,IOException())
            assertNull(state.begin(301000))
            val restored = CheerState.restore("a",state.save())
            val receipt = restored.beginResolution()!!
            server.enqueue(MockResponse().setBody("{\"status\":\"RECONCILED\",\"postId\":\"post\",\"cheered\":true,\"cheerCount\":5}"))
            val (value,count) = resolveCheer(api,"post",receipt,api.sessionVersion)
            assertTrue(restored.resolved(receipt,value,count)); assertFalse(restored.submission.uncertain)
            assertTrue(restored.cheered); assertEquals(5,restored.count)
            assertFalse(restored.succeeded(original,false))
            val request = server.takeRequest()
            assertEquals("POST",request.method); assertEquals("/api/v1/feed/posts/post/cheer/result",request.path)
            assertEquals(original.key,JsonParser.parseString(request.body.readUtf8()).asJsonObject.text("requestKey"))
            assertNotEquals(original.key,request.getHeader("Idempotency-Key")); assertEquals(1,server.requestCount)
            assertNotEquals(original.key,restored.begin(302000)!!.key)
        }
    }
    @Test fun malformedResolutionCannotDiscardTheOldReceipt() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server)
            for(body in listOf("{}","{\"status\":\"RECONCILED\",\"postId\":\"other\",\"cheered\":true,\"cheerCount\":1}",
                "{\"status\":\"RECONCILED\",\"postId\":\"post\",\"cheered\":\"true\",\"cheerCount\":1}")) {
                val state = CheerState("a","post",false,2); val write = state.begin()!!; state.failed(write,IOException())
                val receipt = state.beginResolution()!!; server.enqueue(MockResponse().setBody(body))
                val failure = runCatching { resolveCheer(api,"post",receipt,api.sessionVersion) }.exceptionOrNull() as ApiException
                assertEquals(502,failure.status); state.inspectionFailed(failure)
                assertTrue(state.submission.uncertain); assertEquals(write.key,state.submission.receiptKey)
            }
        }
    }
    @Test fun anotherReceiptCannotSettleTheCurrentState() {
        val state = CheerState("a","post",false,2); val original = state.begin()!!; state.failed(original,IOException())
        val receipt = state.beginResolution()!!
        assertNull(state.begin()); assertNull(state.beginResolution())
        assertFalse(state.resolved("another",true,20)); assertTrue(state.submission.uncertain)
        assertTrue(state.resolved(receipt,false,2)); assertFalse(state.submission.hasReceipt)
        assertNotEquals(original.key,state.begin()!!.key)
    }
    @Test fun oldSessionCannotResolveAnotherAccountsPendingState() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server); val session = api.sessionVersion; api.clear()
            val failure = runCatching { resolveCheer(api,"post","old-key",session) }.exceptionOrNull() as ApiException
            assertEquals(401,failure.status); assertNull(server.takeRequest(100,TimeUnit.MILLISECONDS))
        }
    }
}
