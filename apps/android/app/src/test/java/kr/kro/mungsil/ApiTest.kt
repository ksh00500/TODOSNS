package kr.kro.mungsil

import kr.kro.mungsil.data.*
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.time.*
import java.util.concurrent.TimeUnit

class ApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val memory = object: SessionStore {
        var value: String? = null
        override fun read() = value
        override fun write(value: String?) { this.value = value }
    }
    @Before fun setup() { server = MockWebServer(); server.start(); api = Api(server.url("/api/v1/").toString(), memory) }
    @After fun teardown() { server.shutdown() }
    private fun session(token: String, refresh: String) = MockResponse().setBody("""{"accessToken":"$token","user":{"id":"u"}}""")
        .addHeader("Set-Cookie", "mungsil_refresh=$refresh; HttpOnly; Path=/api/v1/auth")

    @Test fun disconnectedReusedReadConnectionRecoversWithoutLosingTheQuery() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))
        api.request("todos/history",authenticated = false)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setBody("""{"total":55}"""))
        val query = mapOf("fromDate" to "2026-10-17", "toDate" to "2026-10-23", "cursor" to "synthetic-position", "limit" to "20")
        assertEquals(55,api.request("todos/history",query = query,authenticated = false).obj().number("total"))
        server.takeRequest()
        val interrupted = server.takeRequest(); val recovered = server.takeRequest()
        assertEquals("GET",recovered.method); assertEquals(interrupted.requestUrl,recovered.requestUrl)
        assertEquals("synthetic-position",recovered.requestUrl!!.queryParameter("cursor"))
        assertEquals(3,server.requestCount)
    }

    @Test fun disconnectedWriteIsNotAutomaticallyReplayed() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))
        api.request("todos/history",authenticated = false)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setBody("""{"id":"unexpected-replay"}"""))
        val failure = runCatching { api.request("todos","POST",json("title" to "한 번만 전송"),key = "same-request-key") }.exceptionOrNull()
        assertTrue(failure is java.io.IOException)
        assertEquals(2,server.requestCount)
        server.takeRequest(); val sent = server.takeRequest()
        assertEquals("POST",sent.method); assertEquals("same-request-key",sent.getHeader("Idempotency-Key"))
    }

    @Test fun laterWritesUseFreshConnectionsInsteadOfIdlePooledSockets() = runBlocking {
        server.enqueue(MockResponse().setBody("{}")); server.enqueue(MockResponse().setBody("{}"))
        api.request("todos","POST",json("title" to "첫 실천"),key = "first-write")
        api.request("todos","POST",json("title" to "다음 실천"),key = "next-write")
        val first = server.takeRequest(); val next = server.takeRequest()
        assertEquals(0,first.sequenceNumber); assertEquals(0,next.sequenceNumber)
        assertEquals("first-write",first.getHeader("Idempotency-Key")); assertEquals("next-write",next.getHeader("Idempotency-Key"))
        assertEquals(2,server.requestCount)
    }

    @Test fun serverRetryHintCannotReplayAWriteBeforeExplicitResultConfirmation() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After","0").setBody("{}"))
        server.enqueue(MockResponse().setBody("""{"id":"confirmed"}"""))
        val body = json("title" to "결과를 확인할 실천")
        val error = runCatching { api.request("todos","POST",body,key = "unchanged-key") }.exceptionOrNull() as ApiException
        assertEquals(503,error.status); assertEquals(1,server.requestCount)
        val first = server.takeRequest()
        assertEquals("confirmed",api.request("todos","POST",body,key = "unchanged-key").obj().text("id"))
        val confirmed = server.takeRequest()
        assertEquals(first.getHeader("Idempotency-Key"),confirmed.getHeader("Idempotency-Key"))
        assertEquals(first.body.readUtf8(),confirmed.body.readUtf8()); assertEquals(2,server.requestCount)
    }

    @Test fun googleProfileRequiredDoesNotPersistTokenAndCompletionUsesServerSession() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"code":"GOOGLE_PROFILE_REQUIRED","message":"가입 정보를 확인해주세요."}"""))
        val error = runCatching { api.signInGoogle("synthetic-google-token") }.exceptionOrNull() as ApiException
        assertEquals("GOOGLE_PROFILE_REQUIRED", error.code)
        assertNull(memory.value); assertNull(api.accessToken)
        server.enqueue(session("server-access", "server-refresh"))
        assertEquals("u", api.signInGoogle("synthetic-google-token", "cloud.test", "1990-01-01", "invite").text("id"))
        assertEquals("server-refresh", memory.value)
        assertEquals("server-access", api.accessToken)
        val first = server.takeRequest(); val complete = server.takeRequest()
        assertEquals("/api/v1/auth/google", first.path)
        assertNull(complete.getHeader("Authorization"))
        assertTrue(complete.body.readUtf8().contains("1990-01-01"))
    }

    @Test fun invalidGoogleIdentityNeverCreatesALocalSession() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        assertTrue(runCatching { api.signInGoogle("rejected") }.isFailure)
        assertNull(api.accessToken); assertNull(memory.value)
    }

    @Test fun googleRejectionHasStageAndRequestIdRatherThanExpiredSession() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setHeader("x-request-id", "request-123").setBody("{}"))
        val error = runCatching { api.signInGoogle("rejected") }.exceptionOrNull() as ApiException
        assertEquals("auth/google", error.stage)
        assertEquals("request-123", error.requestId)
        assertFalse(error.message.contains("만료"))
        assertTrue(friendlyError(error).contains("request-123"))
        assertNull(memory.value)
    }

    @Test fun malformedSessionNeverWritesRefreshCredential() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"accessToken":"token","user":{}}""").addHeader("Set-Cookie", "mungsil_refresh=refresh; Path=/api/v1/auth"))
        val error = runCatching { api.signInGoogle("identity") }.exceptionOrNull() as ApiException
        assertEquals("SESSION_USER_MISSING", error.code)
        assertNull(api.accessToken); assertNull(memory.value)
    }

    @Test fun emailVerificationAcceptsOnlyCompleteServerSession() = runBlocking {
        server.enqueue(session("verified", "verified-refresh"))
        assertEquals("u", api.verifyEmail("mail-token").text("id"))
        val request = server.takeRequest()
        assertEquals("/api/v1/auth/verify-email", request.path)
        assertEquals("POST", request.method)
        assertNull(request.getHeader("Authorization"))
        assertEquals("verified-refresh", memory.value)
    }

    @Test fun invalidTodoContractDoesNotBecomeAnEmptySchedule() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))
        val error = runCatching { TodoRepository(api).list(LocalDate.of(2026,9,24), ZoneId.of("Asia/Seoul")) }.exceptionOrNull()
        assertTrue(error is ApiException)
    }

    @Test fun linksAllowOnlyOurKnownRoutesAndKeepTokenOutOfDestination() {
        assertEquals("post/abc", parseAppLink("https://mungsil.kro.kr/posts/abc")?.route)
        val verify = parseAppLink("https://mungsil.kro.kr/verify-email?token=mail-token")!!
        assertEquals("verify-email", verify.route); assertEquals("mail-token", verify.token)
        assertNull(parseAppLink("https://mungsil.kro.kr.evil.test/posts/abc"))
        assertNull(parseAppLink("https://evil.test@mungsil.kro.kr/posts/abc"))
        assertNull(parseAppLink("http://mungsil.kro.kr/posts/abc"))
        assertNull(parseAppLink("https://mungsil.kro.kr/admin/reports"))
        assertNull(parseAppLink("https://mungsil.kro.kr/posts/../me"))
        assertNull(parseAppLink("https://mungsil.kro.kr/verify-email?token=one&token=two")?.token)
    }

    @Test fun refreshRotatesCookieAndRetriesWithSameMutationKey() = runBlocking {
        server.enqueue(session("first", "refresh1"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.enqueue(session("second", "refresh2"))
        server.enqueue(MockResponse().setBody("{\"id\":\"todo\"}"))
        api.signIn("test@example.invalid", "synthetic-password")
        val result = api.request("todos", "POST", json("title" to "산책"), key = "stable-key")
        assertEquals("todo", result.obj().text("id"))
        val login = server.takeRequest(); val first = server.takeRequest(); val refresh = server.takeRequest(); val retried = server.takeRequest()
        assertNull(login.getHeader("Authorization"))
        assertEquals("Bearer first", first.getHeader("Authorization"))
        assertNull(first.getHeader("Cookie"))
        assertEquals("mungsil_refresh=refresh1", refresh.getHeader("Cookie"))
        assertEquals("/api/v1/auth/refresh", refresh.path)
        assertEquals("Bearer second", retried.getHeader("Authorization"))
        assertEquals(first.body.readUtf8(), retried.body.readUtf8())
        assertEquals("stable-key", retried.getHeader("Idempotency-Key"))
        assertEquals("refresh2", memory.value)
    }

    @Test fun parallelUnauthorizedRequestsUseOneRefresh() = runBlocking {
        var refreshCount = 0
        server.dispatcher = object: Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when(request.path) {
                "/api/v1/auth/login" -> session("old", "r1")
                "/api/v1/auth/refresh" -> { refreshCount++; session("new", "r2").setBodyDelay(50, TimeUnit.MILLISECONDS) }
                else -> if(request.getHeader("Authorization") == "Bearer new") MockResponse().setBody("[]") else MockResponse().setResponseCode(401).setBody("{}")
            }
        }
        api.signIn("test@example.invalid", "synthetic-password")
        coroutineScope { (1..4).map { async { api.request("todos") } }.awaitAll() }
        assertEquals(1, refreshCount)
    }

    @Test fun lateLoginCannotResurrectClearedSession() = runBlocking {
        server.enqueue(session("late", "secret").setBodyDelay(150, TimeUnit.MILLISECONDS))
        val signIn = async { runCatching { api.signIn("test@example.invalid", "synthetic-password") } }
        withContext(Dispatchers.IO) { server.takeRequest() }
        api.clear()
        assertTrue(signIn.await().isFailure)
        assertNull(api.accessToken); assertNull(memory.value)
    }

    @Test fun unauthorizedRefreshClearsPersistentSession() = runBlocking {
        server.enqueue(session("old", "r1")); server.enqueue(MockResponse().setResponseCode(401)); server.enqueue(MockResponse().setResponseCode(401))
        api.signIn("test@example.invalid", "synthetic-password")
        var expired = false; api.onExpired = { expired = true }
        assertTrue(runCatching { api.request("me") }.isFailure)
        assertNull(memory.value); assertNull(api.accessToken); assertTrue(expired)
    }

    @Test fun networkFailureDoesNotDestroyRefreshCredential() = runBlocking {
        server.enqueue(session("old", "r1")); server.enqueue(MockResponse().setResponseCode(503))
        api.signIn("test@example.invalid", "synthetic-password")
        assertTrue(runCatching { api.restore() }.isFailure)
        assertEquals("r1", memory.value)
    }

    @Test fun serverFailureIsFriendlyAndDoesNotLeakInternalMessage() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"message":"Internal server error secret"}"""))
        val error = runCatching { api.request("public/feed", authenticated = false) }.exceptionOrNull()!!
        assertFalse(friendlyError(error).contains("secret")); assertTrue(friendlyError(error).contains("다시"))
    }

    @Test fun pushDestinationRechecksOwnerAndUsesServerHrefWithoutMarkingRead() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":"owner"}"""))
        server.enqueue(MockResponse().setBody("""{"id":"notice"}"""))
        server.enqueue(MockResponse().setBody("""{"items":[],"nextCursor":"older"}"""))
        server.enqueue(MockResponse().setBody("""{"items":[{"id":"notice","href":"/posts/post-1"}],"nextCursor":null}"""))
        assertEquals("post/post-1", resolvePushDestination(api, "owner", "notice"))
        val requests = (1..4).map { server.takeRequest() }
        assertTrue(requests.all { it.method == "GET" })
        assertEquals("older", requests.last().requestUrl!!.queryParameter("cursor"))
    }

    @Test fun pushForAnotherAccountDoesNotReadNotificationData() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":"other"}"""))
        val failure = runCatching { resolvePushDestination(api, "owner", "notice") }.exceptionOrNull() as ApiException
        assertEquals(403, failure.status)
        assertEquals(1, server.requestCount)
    }

    @Test fun dayBoundsRespectAccountTimezoneAndDst() {
        assertEquals("2026-09-21T15:00:00Z", dayRange(LocalDate.of(2026,9,22), ZoneId.of("Asia/Seoul")).first)
        val spring = dayRange(LocalDate.of(2026,3,8), ZoneId.of("America/New_York"))
        assertEquals(23*60*60*1000L, Duration.between(Instant.parse(spring.first), Instant.parse(spring.second).plusMillis(1)).toMillis())
    }

    @Test fun repeatedEventsReplaceMessageWithoutDuplicatingAndNullClearsRecurrence() {
        val result = mergeRows(listOf(json("id" to "1", "body" to "old")), listOf(json("id" to "1", "body" to "new"), json("id" to "2")))
        assertEquals(2, result.size); assertEquals("new", result.first().text("body"))
        assertTrue(json("repeatRule" to null).get("repeatRule").isJsonNull)
    }
}
