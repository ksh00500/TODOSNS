package kr.kro.mungsil

import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import okio.Buffer
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Real Compose/HTTP, with synthetic records and loopback-only images. */
class ExploreImportFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val received = CopyOnWriteArrayList<RecordedRequest>()
    private val zone = ZoneId.of("Asia/Seoul")
    private val owner = "synthetic-reader"
    private val source get() = json("id" to "source-todo", "title" to "점심 산책 10분", "notes" to "내 호흡에 맞춰 걸어요.",
        "category" to "건강", "dueDate" to "2026-10-25T00:00:00Z", "repeatRule" to "", "completedAt" to "2026-10-25T00:10:00Z", "visibility" to "PUBLIC")
    private fun post(media: String = "", todos: List<JsonObject> = listOf(source), list: JsonObject? = null) = json("id" to "post-1",
        "author" to json("id" to "source-author", "nickname" to "함께 구름", "handle" to "together.cloud"),
        "caption" to "작은 실천을 오늘로 가져와요.", "mediaUrl" to media, "createdAt" to "2026-10-25T00:15:00Z",
        "todos" to todos, "todoList" to list, "cheered" to false, "cheerCount" to 0, "commentCount" to 0)
    private fun response(value: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(value)
    private fun dispatch(handler: (RecordedRequest) -> MockResponse) {
        server.dispatcher = object: Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse { received += request; return handler(request) } }
    }
    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        coil.Coil.setImageLoader(coil.ImageLoader.Builder(context).networkObserverEnabled(false)
            .okHttpClient(okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
                check(chain.request().url.host in listOf("localhost", "127.0.0.1"))
                chain.proceed(chain.request())
            }.build()).build())
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object: SessionStore {
            override fun read(): String? = null
            override fun write(value: String?) {}
        })
    }
    @After fun teardown() { server.shutdown() }
    @Composable private fun Frame(content: @Composable () -> Unit) {
        MungsilTheme { Surface(Modifier.fillMaxSize(), color = Cream) {
            CompositionLocalProvider(LocalTodoDraftOwner provides owner, content = content)
        } }
    }
    private fun waitText(value: String) = compose.waitUntil(15_000) { compose.onAllNodesWithText(value).fetchSemanticsNodes().isNotEmpty() }
    private fun scrollTo(value: String) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(value)) }
    private fun requiresIme() = InstrumentationRegistry.getArguments().getString("requireIme") == "true"
    private fun imeShown(): Boolean {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("dumpsys input_method")
        val state = android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
        return "mInputShown=true" in state || "mIsInputViewShown=true" in state
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        // Let the OS composited window draw the settled scroll/IME frame too.
        Thread.sleep(if(name == "single-save-target") 1000 else 300)
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val label = InstrumentationRegistry.getArguments().getString("screenshotLabel", "explore-import")
        val dir = File(context.getExternalFilesDir(null), "native-verification/$label").apply { mkdirs() }
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
            File(dir, "$name.png").outputStream().use { input.copyTo(it) }
        }
    }
    private fun photo(): ByteArray {
        val bitmap = android.graphics.Bitmap.createBitmap(320, 240, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.rgb(223, 238, 219))
        val paint = android.graphics.Paint().apply { color = android.graphics.Color.rgb(49, 95, 115) }
        canvas.drawRect(24f, 24f, 150f, 150f, paint)
        paint.color = android.graphics.Color.rgb(255, 241, 199); canvas.drawCircle(235f, 85f, 55f, paint)
        paint.color = android.graphics.Color.rgb(37, 52, 59); paint.textSize = 28f; canvas.drawText("LOCAL TEST", 72f, 205f, paint)
        return java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }
    @Test fun feedPhotoShowsLoadingFailureAndExplicitRetryWithoutReloadingTheRecord() {
        val gate = CountDownLatch(1); val photos = AtomicInteger(0); val bytes = photo()
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/feed" -> response(json("items" to listOf(post(server.url("/photo.png").toString())), "nextCursor" to null).toString())
            "/photo.png" -> if(photos.incrementAndGet() == 1) {
                check(gate.await(15, TimeUnit.SECONDS)); response("{}", 503)
            } else MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))
            else -> response("[]")
        } }
        compose.setContent { Frame { FeedScreen(api, true, 0, {}) } }
        try { waitText("사진을 불러오고 있어요."); capture("photo-loading") } finally { gate.countDown() }
        waitText("사진을 불러오지 못했어요.")
        assertEquals(1, photos.get())
        compose.onNodeWithText("사진 다시 불러오기").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(44.dp)
        capture("photo-failed")
        compose.onNodeWithText("사진 다시 불러오기").performClick()
        val ready = hasContentDescription("실천 인증 사진") and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "사진 표시 완료")
        compose.waitUntil(15_000) { compose.onAllNodes(ready, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        scrollTo("작은 실천을 오늘로 가져와요.")
        compose.onNode(ready, useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        capture("photo-loaded")
        scrollTo("나도 할래요"); compose.onNodeWithText("나도 할래요").assertIsEnabled().assertHeightIsAtLeast(44.dp)
        assertEquals(2, photos.get()); assertEquals(1, received.count { it.requestUrl!!.encodedPath == "/api/v1/feed" })
        assertTrue(received.all { it.method == "GET" })
    }
    @Test fun singleImportFromFeedRestoresOpenSheetAndConfirmsTheSameUncertainWrite() {
        val writes = AtomicInteger(0)
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/feed" -> response(json("items" to listOf(post()), "nextCursor" to null).toString())
            "/api/v1/todos/source-todo/clone" -> if(writes.incrementAndGet() == 1) response("{}", 503)
                else response(source.deepCopy().apply { addProperty("id", "owned-todo"); addProperty("userId", owner); addProperty("visibility", "PRIVATE"); add("completedAt", com.google.gson.JsonNull.INSTANCE) }.toString(), 201)
            else -> response("[]")
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Frame { FeedScreen(api, true, 0, {}) } }
        waitText("나도 할래요"); scrollTo("나도 할래요"); compose.onNodeWithText("나도 할래요").performClick()
        waitText("내 TODO로 가져오기"); capture("single-import")
        compose.onNodeWithContentDescription("할 일").performClick().performTextReplacement("내가 정한 산책")
        if(requiresIme()) compose.waitUntil(10_000) { imeShown() }
        compose.onNodeWithContentDescription("할 일").assertIsDisplayed().assertHeightIsAtLeast(44.dp).assertWidthIsAtLeast(44.dp)
        capture("single-edited")
        val submit = compose.onNode(hasText("가져오기") and hasClickAction()).performScrollTo()
        submit.assertIsDisplayed().assertHeightIsAtLeast(44.dp).assertWidthIsAtLeast(44.dp)
        capture("single-save-target")
        if(requiresIme()) assertTrue("IME must remain shown until the coordinate save tap", imeShown())
        submit.performClick()
        waitText("저장 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        waitText("내 TODO로 가져오기")
        compose.onNodeWithContentDescription("할 일").assertTextEquals("내가 정한 산책").assertIsNotEnabled()
        assertEquals(1, writes.get()); capture("single-uncertain-restored")
        compose.onNodeWithText("저장 결과 확인").performScrollTo().performClick()
        waitText("내 TODO로 가져왔어요.")
        val requests = received.filter { it.requestUrl!!.encodedPath.endsWith("/clone") }
        assertEquals(2, requests.size)
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
        assertEquals(requests[0].body.clone().readUtf8(), requests[1].body.clone().readUtf8())
        assertTrue(requests[0].body.clone().readUtf8().contains("내가 정한 산책"))
    }
    @Test fun routineImportFromDetailKeepsBackDraftPreviewAndUncertainReceipt() {
        val writes = AtomicInteger(0)
        val routine = json("id" to "source-list", "title" to "아침의 작은 루틴", "items" to listOf(json("todo" to source),
            json("todo" to source.deepCopy().apply { addProperty("id", "source-two"); addProperty("title", "다음 날 독서"); addProperty("dueDate", "2026-10-26T02:00:00Z") })))
        val record = post(list = routine)
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/feed/posts/post-1" -> response(record.toString())
            "/api/v1/feed/posts/post-1/comments" -> response("{\"items\":[],\"nextCursor\":null}")
            "/api/v1/todo-lists/source-list/clone" -> if(writes.incrementAndGet() == 1) response("{}", 503)
                else response(json("id" to "owned-routine", "userId" to owner, "visibility" to "PRIVATE").toString(), 201)
            else -> response("[]")
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Frame { PostScreen(api, "post-1", true, json("id" to owner), zone, 0, {}, {}, {}) } }
        waitText("루틴 가져오기"); scrollTo("루틴 가져오기"); compose.onNodeWithText("루틴 가져오기").performClick()
        waitText("반복 정책"); capture("routine-open")
        compose.onNodeWithText("반복 없음").performScrollTo().performClick()
        compose.onNodeWithText("반복 없음").assertIsSelected()
        // Target the opened dialog window. A global Back can race a newly
        // attached dialog and reach the test host activity instead.
        Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.isRoot())
            .inRoot(androidx.test.espresso.matcher.RootMatchers.isDialog())
            .perform(androidx.test.espresso.action.ViewActions.closeSoftKeyboard(),
                androidx.test.espresso.action.ViewActions.pressKey(android.view.KeyEvent.KEYCODE_BACK))
        waitText("작성을 그만둘까요?"); compose.onNodeWithText("돌아가기").performClick()
        compose.onNodeWithText("반복 없음").assertIsSelected()
        compose.onNodeWithText("가져올 일정 미리보기").performScrollTo().assertExists()
        val day = java.time.LocalDate.now(zone)
        compose.onNodeWithText("$day · 07:00").performScrollTo().assertExists()
        compose.onNodeWithText("${day.plusDays(1)} · 09:00").performScrollTo().assertExists()
        capture("routine-preview")
        compose.onNodeWithText("내 TODO로 가져오기").performScrollTo().performClick()
        waitText("가져오기 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        waitText("가져오기 결과 확인")
        compose.onNodeWithContentDescription("루틴 이름").assertIsNotEnabled()
        assertEquals(1, writes.get()); capture("routine-uncertain-restored")
        compose.onNodeWithText("가져오기 결과 확인").performScrollTo().performClick()
        waitText("루틴을 내 TODO로 가져왔어요.")
        val requests = received.filter { it.requestUrl!!.encodedPath.endsWith("/clone") }
        assertEquals(2, requests.size)
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
        assertEquals(requests[0].body.clone().readUtf8(), requests[1].body.clone().readUtf8())
        assertTrue(requests[0].body.clone().readUtf8().contains("NONE"))
    }
    @Test fun missingSourceHasNoInventedRoutineBadgeOrNoOpImportButton() {
        val destination = AtomicReference<String>()
        dispatch { response(json("items" to listOf(post(todos = emptyList())), "nextCursor" to null).toString()) }
        compose.setContent { Frame { FeedScreen(api, true, 0, { destination.set(it) }) } }
        waitText("가져올 실천 정보를 확인하지 못했어요.")
        compose.onNodeWithText("나도 할래요").assertDoesNotExist()
        compose.onNodeWithText("루틴").assertDoesNotExist()
        compose.onNodeWithText("단일 TODO").assertDoesNotExist()
        scrollTo("원본 정보 확인"); compose.onNodeWithText("원본 정보 확인").performClick()
        assertEquals("post/post-1", destination.get()); assertTrue(received.all { it.method == "GET" })
    }
}
