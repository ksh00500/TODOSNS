package kr.kro.mungsil

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Compile separately from execution: these scenarios require a connected Android device. */
class HistoryFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val received = CopyOnWriteArrayList<RecordedRequest>()
    private val zone = ZoneId.of("Asia/Seoul")
    private fun record(id: String) = json("id" to id, "title" to "마친 실천 $id", "notes" to "실제로 남긴 메모",
        "dueDate" to "2026-10-10T01:00:00Z", "completedAt" to "2026-10-23T03:00:00Z",
        "category" to "생활", "repeatRule" to null, "visibility" to "PRIVATE")
    private fun page(rows: List<JsonObject>, total: Int = rows.size, cursor: String? = null, from: String = "2026-10-17", timezone: String = zone.id) = json(
        "items" to rows, "nextCursor" to cursor, "total" to total, "timezone" to timezone, "fromDate" to from, "toDate" to "2026-10-23")
    private fun response(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun dispatch(handler: (RecordedRequest) -> MockResponse) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse { received += request; return handler(request) }
        }
    }
    private fun waitText(text: String) = compose.waitUntil(10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    private fun scrollTo(text: String) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(text)) }
    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object : SessionStore {
            override fun read(): String? = null
            override fun write(value: String?) {}
        })
    }
    @After fun cleanup() { server.shutdown() }

    @Test fun additionalPageFailureKeepsRowsAndRetriesSamePinnedQuery() {
        val more = AtomicInteger(0)
        val first = (20 downTo 1).map { record("h-${it.toString().padStart(3,'0')}") }
        dispatch { request ->
            if(request.requestUrl!!.queryParameter("cursor") == null) response(page(first,21,"next").toString())
            else if(more.incrementAndGet() == 1) response("{}",503)
            else response(page(listOf(record("h-000")),21).toString())
        }
        var target = ""
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "synthetic-user") {
            HistoryScreen(api,zone,0,{ target = it })
        } } }
        waitText("기간 전체 21개 완료")
        compose.onNodeWithText("20개 표시").assertExists()
        scrollTo("더 보기"); compose.onNodeWithText("더 보기").performClick()
        scrollTo("다시 시도"); compose.onNodeWithText("다시 시도").performClick()
        scrollTo("마친 실천 h-000"); waitText("마친 실천 h-000")
        val retries = received.filter { it.requestUrl!!.queryParameter("cursor") != null }
        assertEquals(2,retries.size)
        assertEquals(retries[0].requestUrl,retries[1].requestUrl)
        assertEquals("2026-10-17",retries[0].requestUrl!!.queryParameter("fromDate"))
        assertEquals("2026-10-23",retries[0].requestUrl!!.queryParameter("toDate"))
        scrollTo("21개 표시")
        scrollTo("마친 실천 h-020"); compose.onNodeWithText("마친 실천 h-020").performClick()
        waitText("완료 기록 상세"); compose.onNodeWithText("실제로 남긴 메모").assertExists()
        compose.onNodeWithText("일정에서 보기").performScrollTo().performClick()
        assertEquals("schedule/2026-10-10?zone=Asia%2FSeoul",target)
        assertTrue(received.all { it.method == "GET" && it.requestUrl!!.encodedPath == "/api/v1/todos/history" })
    }

    @Test fun selectedPeriodSurvivesSavedStateRestoreAndStartsWithoutCursor() {
        dispatch { request -> response(page(emptyList(),from = request.requestUrl!!.queryParameter("fromDate") ?: "2026-10-17").toString()) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "synthetic-user") { HistoryScreen(api,zone,0,{}) } } }
        waitText("이 기간에는 완료한 실천이 없어요")
        compose.onNodeWithText("기간 설정").performClick()
        compose.onNodeWithText("조회 시작일 · 2026-10-17").performScrollTo().performClick()
        compose.onNodeWithContentDescription("10월 16일").performClick()
        compose.onNodeWithText("이 기간 보기").performScrollTo().performClick()
        waitText("조회 기간 · 2026-10-16 ~ 2026-10-23")
        val before = received.size
        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntil(10_000) { received.size > before }
        waitText("이 기간에는 완료한 실천이 없어요")
        assertEquals("2026-10-16",received.last().requestUrl!!.queryParameter("fromDate"))
        assertEquals("2026-10-23",received.last().requestUrl!!.queryParameter("toDate"))
        assertNull(received.last().requestUrl!!.queryParameter("cursor"))
    }

    @Test fun profileHistoryKeepsFiveTabsAndScheduleUsesServerZone() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { JsonParser.parseString(it.readText()).asJsonObject }
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/me" -> response(fixture.child("profile").toString())
            "/api/v1/todos", "/api/v1/todo-lists" -> response("[]")
            "/api/v1/public/users/parity.cloud/posts" -> response("""{"items":[],"nextCursor":null}""")
            "/api/v1/todos/history" -> response(page(listOf(record("h-001")),timezone = "America/New_York").toString())
            else -> response("""{"count":0}""")
        } }
        compose.setContent { MungsilTheme { NativeApp(api,2,fixture.child("user"),null,{},{},{}) } }
        waitText("오늘은 아직 담긴 실천이 없어요")
        compose.onNode(hasText("마이") and hasClickAction()).performClick()
        waitText("테스트 구름")
        scrollTo("완료 기록 보기"); compose.onNodeWithText("완료 기록 보기").performClick()
        waitText("기간 전체 1개 완료")
        listOf("오늘","탐색","TODO","챌린지","마이").forEach { compose.onNode(hasText(it) and hasClickAction()).assertExists() }
        compose.onNode(hasText("마이") and hasClickAction()).assertIsSelected()
        scrollTo("마친 실천 h-001"); compose.onNodeWithText("마친 실천 h-001").performClick()
        waitText("완료 기록 상세")
        compose.onNodeWithText("예정 · 2026년 10월 9일 21:00").assertExists()
        compose.onNodeWithText("일정에서 보기").performScrollTo().performClick()
        waitText("TODO 일정")
        compose.onNode(hasText("TODO") and hasClickAction()).assertIsSelected()
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.encodedPath == "/api/v1/todos" && it.requestUrl!!.queryParameter("from") == "2026-10-09T04:00:00Z" } }
        val schedule = received.last { it.requestUrl!!.encodedPath == "/api/v1/todos" }.requestUrl!!
        assertEquals("2026-10-10T03:59:59.999Z",schedule.queryParameter("to"))
        assertTrue(received.all { it.method == "GET" })
    }
}
