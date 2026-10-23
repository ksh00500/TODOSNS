package kr.kro.mungsil

import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.historySelection
import kr.kro.mungsil.ui.historyScheduleRoute
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.time.*
import java.util.concurrent.TimeUnit

class HistoryRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private lateinit var repository: HistoryRepository
    private val range = HistoryRange(LocalDate.of(2026,10,17),LocalDate.of(2026,10,23))
    private fun item(id: String = "todo", completed: String = "2026-10-23T03:00:30.123Z") = json("id" to id, "title" to "과거 예정 실천", "notes" to "나의 메모",
        "dueDate" to "2026-10-10T03:00:00Z", "completedAt" to completed, "category" to "생활", "visibility" to "PRIVATE", "repeatRule" to "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2")
    private fun body(rows: List<JsonObject> = listOf(item()), total: Long = rows.size.toLong(), cursor: String? = null) = json(
        "items" to rows, "total" to total, "nextCursor" to cursor, "timezone" to "Asia/Seoul", "fromDate" to range.from.toString(), "toDate" to range.to.toString())
    private fun reply(value: JsonObject) = MockResponse().setBody(value.toString())
    @Before fun setup() {
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object : SessionStore { override fun read(): String? = null; override fun write(value: String?) {} })
        repository = HistoryRepository(api)
    }
    @After fun cleanup() { server.shutdown() }

    @Test fun defaultUsesNewEndpointAndServerDatesZoneAndActualCompletion() = runBlocking {
        val record = item().apply { add("categoryRef", json("id" to "category", "name" to "보관한 분류", "archivedAt" to "2026-10-01T00:00:00Z")) }
        server.enqueue(reply(body(listOf(record),total = 55)))
        val page = repository.page(null)
        assertEquals(55L,page.total); assertEquals(range,page.range); assertEquals("Asia/Seoul",page.zone.id)
        assertEquals(Instant.parse("2026-10-23T03:00:30.123Z"),page.rows.single().completedAt)
        assertEquals(Instant.parse("2026-10-10T03:00:00Z"),page.rows.single().dueAt)
        assertEquals("보관한 분류",page.rows.single().category); assertTrue(page.rows.single().repeatRule.contains("BYSETPOS"))
        val request = server.takeRequest()
        assertEquals("GET",request.method); assertEquals("/api/v1/todos/history",request.requestUrl!!.encodedPath)
        assertEquals(setOf("limit"),request.requestUrl!!.queryParameterNames); assertEquals("20",request.requestUrl!!.queryParameter("limit"))
        assertNull(request.getHeader("Idempotency-Key"))
    }
    @Test fun followingPagePinsReturnedDatesAndUsesOpaqueCursorAndLimit() = runBlocking {
        server.enqueue(reply(body(listOf(item("b"),item("a")),55,"next")))
        val first = repository.page(range,limit = 2)
        server.enqueue(reply(body(listOf(item("older","2026-10-22T03:00:00Z")),55)))
        repository.page(first.range,first.nextCursor,2)
        server.takeRequest(); val more = server.takeRequest().requestUrl!!
        assertEquals("2026-10-17",more.queryParameter("fromDate")); assertEquals("2026-10-23",more.queryParameter("toDate"))
        assertEquals("next",more.queryParameter("cursor")); assertEquals("2",more.queryParameter("limit"))
        assertNull(more.queryParameter("timezone")); assertNull(more.queryParameter("userId"))
    }
    @Test fun malformedRequiredMetadataAndItemsNeverBecomeEmptySuccess() = runBlocking {
        val invalid = listOf(
            body().apply { remove("items") }, body().apply { remove("total") }, body().apply { addProperty("total","1") },
            body().apply { addProperty("total",-1) },body().apply { addProperty("total",1.5) },body().apply { addProperty("total",9_007_199_254_740_992L) },
            body().apply { remove("nextCursor") },body().apply { addProperty("timezone","Invalid/Zone") },body().apply { addProperty("fromDate","2026-02-30") },
            body(listOf(item().apply { remove("completedAt") })),body(listOf(item().apply { addProperty("visibility","UNKNOWN") })),
            body(listOf(item().apply { addProperty("notes",false) })),body(emptyList(),total = 3),
        )
        for(value in invalid) {
            server.enqueue(reply(value))
            val error = runCatching { repository.page(range) }.exceptionOrNull() as ApiException
            assertEquals(value.toString(),"HISTORY_RESPONSE_INVALID",error.code)
        }
    }
    @Test fun wrongRangeCompletionOrderDuplicatesAndRepeatingCursorAreRejected() = runBlocking {
        val invalid = listOf(
            body().apply { addProperty("fromDate","2026-10-16") },
            body(listOf(item(completed = "2026-10-23T15:00:00Z"))),body(listOf(item(completed = "2026-10-16T14:59:59.999Z"))),
            body(listOf(item("a"),item("b"))),body(listOf(item(),item())),body(cursor = "next",total = 10),
        )
        for(value in invalid) {
            server.enqueue(reply(value)); assertEquals(502,(runCatching { repository.page(range) }.exceptionOrNull() as ApiException).status)
        }
        server.enqueue(reply(body(cursor = "same",total = 10)))
        assertEquals(502,(runCatching { repository.page(range,"same",1) }.exceptionOrNull() as ApiException).status)
    }
    @Test fun emptyAndDstWindowAreAcceptedWithoutConfusingPlannedDay() = runBlocking {
        server.enqueue(reply(body(emptyList())))
        assertEquals(0L,repository.page(range).total)
        val ny = HistoryRange(LocalDate.of(2026,3,8),LocalDate.of(2026,3,8))
        val dst = body(listOf(item(completed = "2026-03-09T03:59:59.999Z"))).apply {
            addProperty("timezone","America/New_York"); addProperty("fromDate",ny.from.toString()); addProperty("toDate",ny.to.toString())
        }
        server.enqueue(reply(dst)); assertEquals(ny,repository.page(ny).range)
    }
    @Test fun cursorRejectionAndUndeployedEndpointKeepTheirMeaningWithoutFallback() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"code":"TODO_HISTORY_CURSOR_INVALID","message":"처음부터 확인해주세요."}"""))
        assertEquals("TODO_HISTORY_CURSOR_INVALID",(runCatching { repository.page(range,"cursor") }.exceptionOrNull() as ApiException).code)
        server.enqueue(MockResponse().setResponseCode(404).setBody("{}"))
        val missing = runCatching { repository.page(null) }.exceptionOrNull() as ApiException
        assertTrue(missing.message.contains("아직 제공")); assertEquals(2,server.requestCount)
        repeat(2) { assertEquals("/api/v1/todos/history",server.takeRequest().requestUrl!!.encodedPath) }
    }
    @Test fun repositoryCannotSendOrAcceptPreviousSessionsRequests() = runBlocking {
        api.clear()
        assertEquals(401,(runCatching { repository.page(null) }.exceptionOrNull() as ApiException).status)
        assertEquals(0,server.requestCount)
        val current = HistoryRepository(api)
        server.enqueue(reply(body()).setBodyDelay(150,TimeUnit.MILLISECONDS))
        val pending = async { runCatching { current.page(null) } }
        withContext(Dispatchers.IO) { assertNotNull(server.takeRequest(5,TimeUnit.SECONDS)) }
        api.clear()
        assertEquals(401,(pending.await().exceptionOrNull() as ApiException).status)
    }
    @Test fun savedSelectionIsAccountStampedAndCalendarRangeIsBounded() {
        val saved = listOf("account-a","2026-10-17","2026-10-23")
        assertEquals(range,historySelection(saved,"account-a")); assertNull(historySelection(saved,"account-b")); assertNull(historySelection(saved,""))
        assertNull(historySelection(listOf("account-a","2026-02-30","2026-03-01"),"account-a"))
        assertNull(historySelection(listOf("account-a","2026-01-01","2026-04-01"),"account-a"))
        assertNull(historySelection(listOf("account-a","2026-10-24","2026-10-23"),"account-a"))
    }
    @Test fun scheduleTargetCarriesServerZoneAcrossLocalDateBoundary() {
        val record=HistoryRecord("todo","산책","",Instant.parse("2026-10-10T01:00:00Z"),Instant.parse("2026-10-23T03:00:00Z"),"생활","","PRIVATE")
        assertEquals("schedule/2026-10-09?zone=America%2FNew_York",historyScheduleRoute(record,ZoneId.of("America/New_York")))
        assertEquals("schedule/2026-10-10?zone=Asia%2FSeoul",historyScheduleRoute(record,ZoneId.of("Asia/Seoul")))
    }
}
