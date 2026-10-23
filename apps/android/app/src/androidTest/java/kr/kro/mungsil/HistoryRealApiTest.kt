package kr.kro.mungsil

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonParser
import kotlinx.coroutines.runBlocking
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.net.URI
import java.time.ZoneId

/** Explicit opt-in: real isolated AppModule + PostgreSQL/Redis/MinIO, never production. */
class HistoryRealApiTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var api: Api

    @After fun cleanup() {
        if(::api.isInitialized) runBlocking { runCatching { api.logout() }; api.clear() }
    }

    @Test fun actualHistoryPagesRefreshAfterMutationsAndIsolateTwoAccounts() {
        Assume.assumeTrue("Requires isolated M-06 services", InstrumentationRegistry.getArguments().getString("m06RealApi") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        val fixtureFile = File(context.filesDir,"m06-fixture.json")
        check(fixtureFile.isFile) { "M-06 synthetic fixture file is required" }
        val fixture = JsonParser.parseString(fixtureFile.readText()).asJsonObject
        val url = fixture.text("baseUrl")
        check(URI(url).host == "127.0.0.1" && URI(url).port == 19106) { "Only the isolated reverse-forwarded API is allowed" }
        val accounts = fixture.list("accounts")
        api = Api(url,object : SessionStore {
            private var refresh: String? = null
            override fun read() = refresh
            override fun write(value: String?) { refresh = value }
        })
        val a = runBlocking { api.signIn(accounts[0].text("email"),accounts[0].text("password")) }
        val tokenA = checkNotNull(api.accessToken)
        val previous = HistoryRepository(api)
        val first = runBlocking { previous.page(null) }
        assertEquals(55L,first.total); assertEquals(20,first.rows.size)
        assertEquals("America/New_York",first.zone.id)
        val oldCursor = checkNotNull(first.nextCursor)
        val second = runBlocking { previous.page(first.range,oldCursor) }
        assertEquals(20,second.rows.size)
        val third = runBlocking { previous.page(first.range,checkNotNull(second.nextCursor)) }
        assertEquals(15,third.rows.size)
        assertEquals(55,(first.rows+second.rows+third.rows).distinctBy { it.id }.size)
        var owner by mutableStateOf(a.text("id"))
        var revision by mutableIntStateOf(0)
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides owner) {
            // Deliberately stale profile zone: the response must remain authoritative.
            HistoryScreen(api,ZoneId.of("Asia/Seoul"),revision,{})
        } } }
        waitText("기간 전체 55개 완료")
        compose.onNodeWithText("20개 표시").assertExists()
        capture("history-first-page")
        repeat(2) { index ->
            scrollTo("더 보기")
            compose.onNodeWithText("더 보기").performScrollTo().assertIsDisplayed().assertIsEnabled()
                .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            // Real HTTP completes after the tap. Inspect the summary at the top
            // rather than searching the old page before its response arrives.
            compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
            waitText(if(index == 0) "40개 표시" else "55개 표시")
        }
        scrollTo("실제 API 완료 001"); compose.onNodeWithText("실제 API 완료 001").assertIsDisplayed()
        scrollTo("실제 API 완료 055"); compose.onNodeWithText("실제 API 완료 055").performClick()
        waitText("완료 기록 상세"); compose.onNodeWithText("실제 API 메모 055").assertExists()
        capture("history-detail")
        runBlocking {
            api.request("todos/${fixture.text("cancelId")}/uncomplete","POST",json())
            api.request("todos/${fixture.text("deleteId")}","DELETE")
        }
        compose.runOnIdle { revision++ }
        waitText("기간 전체 53개 완료")
        compose.onNodeWithText("완료 기록 상세").assertDoesNotExist()
        compose.onNodeWithText("실제 API 메모 055").assertDoesNotExist()
        compose.onNodeWithText("실제 API 완료 055").assertDoesNotExist()
        compose.onNodeWithText("실제 API 완료 054").assertDoesNotExist()
        val b = runBlocking {
            api.logout()
            api.signIn(accounts[1].text("email"),accounts[1].text("password"))
        }
        compose.runOnIdle { owner = b.text("id") }
        waitText("기간 전체 1개 완료")
        scrollTo("B 계정의 완료 기록"); compose.onNodeWithText("B 계정의 완료 기록").assertIsDisplayed()
        compose.onNodeWithText("실제 API 완료 053").assertDoesNotExist()
        assertEquals(401,(runBlocking { runCatching { previous.page(null) } }.exceptionOrNull() as ApiException).status)
        val crossAccount = runBlocking { runCatching { HistoryRepository(api).page(first.range,oldCursor) } }.exceptionOrNull() as ApiException
        assertEquals(400,crossAccount.status); assertEquals("TODO_HISTORY_CURSOR_INVALID",crossAccount.code)
        OkHttpClient().newCall(Request.Builder().url(url+"todos/history").header("Authorization","Bearer $tokenA").build()).execute().use {
            assertEquals("The logged-out session must be revoked by the actual server",401,it.code)
        }
    }
    private fun waitText(text: String) {
        try { compose.waitUntil(30_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }
        catch(error: Throwable) {
            capture("failure")
            val top = compose.onAllNodes(isRoot()).onFirst().printToString()
            scrollTo("새로고침")
            capture("failure-bottom")
            throw AssertionError("Awaited $text\n"+top+"\nBottom:\n"+compose.onAllNodes(isRoot()).onFirst().printToString(),error)
        }
    }
    private fun scrollTo(text: String) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(text)) }
    private fun capture(name: String) {
        compose.mainClock.advanceTimeByFrame(); compose.waitForIdle()
        Thread.sleep(300)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null),"native-verification/m06-real").apply { mkdirs() }
        File(directory,"$name.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        image.recycle()
    }
}
