package kr.kro.mungsil

import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.platform.app.InstrumentationRegistry
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import com.google.gson.JsonObject
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Device tests use loopback synthetic HTTP only; no production account or records. */
class NativeFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val received = CopyOnWriteArrayList<RecordedRequest>()
    private val me = json("id" to "synthetic-user", "nickname" to "테스트 구름", "timezone" to "Asia/Seoul")
    private val todo = """{"id":"todo-1","title":"점심 산책 10분","dueDate":"2026-09-22T03:00:00Z","category":"생활","visibility":"PRIVATE","completedAt":null} """.trim()
    private fun response(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    @Before fun setup() {
        // Never schedule real registration against production from a synthetic test.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        // The emulator has no Internet. Coil's connectivity observer would
        // reject loopback before HTTP; permit only test-local image requests.
        coil.Coil.setImageLoader(coil.ImageLoader.Builder(context).networkObserverEnabled(false)
            .okHttpClient(okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
                check(chain.request().url.host in listOf("localhost", "127.0.0.1")) { "Tests allow only loopback images" }
                chain.proceed(chain.request())
            }.build()).build())
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object: SessionStore { override fun read(): String? = null; override fun write(value: String?) {} })
    }
    @After fun teardown() { server.shutdown() }

    @Test fun chatPhotosOpenOriginalAndLinksUseOnlyAllowedSchemes() {
        val bitmap = android.graphics.Bitmap.createBitmap(8, 16, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(195, 236, 233)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        val photo = json("id" to "photo-1", "url" to server.url("photo.png").toString(), "width" to 8, "height" to 16)
        val message = json("id" to "photo-message", "body" to "사진과 주소예요", "sender" to json("nickname" to "사진 구름"), "createdAt" to "2026-09-28T01:00:00Z", "media" to listOf(photo),
            "links" to listOf(json("url" to "https://example.test/walk", "domain" to "example.test"), json("url" to "javascript:alert(1)", "domain" to "unsafe"), json("url" to "intent://open", "domain" to "unsafe")))
        dispatch { request -> when {
            request.requestUrl!!.encodedPath == "/photo.png" -> MockResponse().setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(bytes))
            request.method == "GET" -> response(json("room" to json("canSend" to true, "otherUser" to json("nickname" to "사진 구름")), "items" to listOf(message), "nextCursor" to null).toString())
            else -> response("{}")
        } }
        var opened = ""
        val handler = object : androidx.compose.ui.platform.UriHandler { override fun openUri(uri: String) { opened = uri } }
        compose.setContent { CompositionLocalProvider(androidx.compose.ui.platform.LocalUriHandler provides handler) { MungsilTheme { ChatScreen(api, "direct/links-room") } } }
        waitText("사진과 주소예요")
        compose.onNodeWithText("javascript:alert(1)").assertDoesNotExist()
        compose.onNodeWithText("intent://open").assertDoesNotExist()
        compose.onNodeWithText("example.test").performScrollTo().performClick()
        assertEquals("https://example.test/walk", opened)
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.encodedPath == "/photo.png" } }
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("대화 사진 1", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("대화 사진 1", useUnmergedTree = true).performScrollTo().performClick()
        waitText("대화 사진")
        compose.onNodeWithContentDescription("대화 사진 원본").assertExists()
        screenshot("chat-photo-original", composeFrame = true, sheetTitle = "대화 사진")
    }

    @Test fun fourChatPhotosSurviveRestoreAndFailedSendWithoutReupload() {
        val attempts = AtomicInteger(0); val pickerSlots = AtomicInteger(0)
        dispatch { request -> when {
            request.method == "POST" && request.requestUrl!!.encodedPath.endsWith("/messages") -> if(attempts.incrementAndGet() == 1) response("{}", 503) else response("{}")
            request.method == "GET" -> response("""{"room":{"canSend":true,"otherUser":{"nickname":"사진 구름"}},"items":[],"nextCursor":null}""")
            else -> response("{}")
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { ChatScreen(api, "direct/photo-room", photoPicker = { _, _, update, pending, _ ->
            val slot by androidx.compose.runtime.saveable.rememberSaveable { mutableIntStateOf(pickerSlots.incrementAndGet()) }
            androidx.compose.material3.TextButton({ update(null); pending(false) }) { androidx.compose.material3.Text("업로드 실패 $slot") }
            androidx.compose.material3.TextButton({ update("synthetic-media-$slot"); pending(false) }) { androidx.compose.material3.Text("사진 $slot 업로드 완료") }
        }) } }
        waitText("사진 구름")
        compose.onNodeWithContentDescription("메시지").performTextInput("사진 네 장과 함께 보내요")
        compose.onNodeWithText("사진").performClick()
        waitText("사진 첨부")
        compose.onNodeWithText("업로드 실패 1").performScrollTo().performClick()
        compose.onNodeWithText("대화로 돌아가기").performScrollTo().assertIsNotEnabled()
        repeat(4) { index ->
            if(index > 0) compose.onNodeWithText("첨부할 사진 추가").performScrollTo().performClick()
            compose.onNodeWithText("사진 ${index + 1} 업로드 완료").performScrollTo().performClick()
        }
        compose.onNodeWithText("첨부할 사진 추가").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("대화로 돌아가기").performScrollTo().performClick()
        restoration.emulateSavedInstanceStateRestore()
        waitText("사진 4장 · 첨부 관리")
        compose.onNodeWithText("전송").performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("사진 네 장과 함께 보내요").assertExists()
        compose.onNodeWithText("사진 4장 · 첨부 관리").assertExists()
        compose.onNodeWithText("전송").performClick()
        compose.waitUntil(10_000) { received.count { it.method == "POST" && it.requestUrl!!.encodedPath.endsWith("/messages") } == 2 }
        val sends = received.filter { it.method == "POST" && it.requestUrl!!.encodedPath.endsWith("/messages") }
        assertEquals(sends[0].getHeader("Idempotency-Key"), sends[1].getHeader("Idempotency-Key"))
        val first = sends[0].body.readUtf8(); val second = sends[1].body.readUtf8()
        assertEquals(first, second)
        assertEquals(listOf("synthetic-media-1", "synthetic-media-2", "synthetic-media-3", "synthetic-media-4"), com.google.gson.JsonParser.parseString(first).asJsonObject.strings("mediaIds"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("사진 4장 · 첨부 관리").fetchSemanticsNodes().isEmpty() }
    }

    @Test fun challengeEditorUsesAccountDateWithoutChangingOriginalInstants() {
        val source = json("id" to "zone-challenge", "title" to "산책 챌린지", "description" to "매일 천천히 바깥을 걸어요.",
            "startsAt" to "2026-09-28T00:00:00Z", "endsAt" to "2026-10-03T00:00:00Z", "verificationMode" to "CHECK", "completionThreshold" to 80)
        dispatch { response("{}") }
        compose.setContent { MungsilTheme { ChallengeComposer(api, source, {}, {}, ZoneId.of("America/Los_Angeles")) } }
        waitText("시작일 · 2026-09-27")
        compose.onNodeWithText("종료일 · 2026-10-02").assertExists()
        compose.onNodeWithText("변경 내용 저장").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.method == "PATCH" } }
        val payload = com.google.gson.JsonParser.parseString(received.first { it.method == "PATCH" }.body.readUtf8()).asJsonObject
        assertFalse(payload.has("startsAt")); assertFalse(payload.has("endsAt"))
    }

    @Test fun profileDelayedPreviewsAndBadgeStoryUseServerRecords() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { com.google.gson.JsonParser.parseString(it.readText()).asJsonObject }
        var target = ""
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/me" -> response(fixture.child("profile").toString())
            "/api/v1/todo-lists" -> response(fixture.get("groups").toString()).setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS)
            "/api/v1/public/users/parity.cloud/posts" -> response(json("items" to listOf(fixture.child("post")), "nextCursor" to null).toString()).setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS)
            else -> response("{}", 404)
        } }
        compose.setContent { MungsilTheme { ProfileScreen(api, 0, {}, { target = it }) } }
        waitText("테스트 구름")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("가벼운 하루"))
        compose.onNodeWithText("가벼운 하루").assertIsDisplayed()
        screenshot("profile-groups", composeFrame = true)
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("게시한 실천"))
        waitText("1개의 최근 기록")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("점심 산책 10분"))
        compose.onNodeWithText("점심 산책 10분").assertIsDisplayed()
        screenshot("profile-posts", composeFrame = true)
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("루틴 메이커 배지 상세 보기, 획득"))
        compose.onNodeWithContentDescription("루틴 메이커 배지 상세 보기, 획득").performClick()
        waitText("배지 이야기")
        compose.onNodeWithText("획득 기록 · 첫 번째 TODO 그룹 만들기").assertExists()
        compose.onNodeWithContentDescription("닫기").performClick()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("산책 친구 배지 상세 보기, 획득"))
        compose.onNodeWithContentDescription("산책 친구 배지 상세 보기, 획득").performClick()
        waitText("배지 이야기")
        compose.onNodeWithText("획득 기록 · 함께 걷는 일주일 최종 1위").assertExists()
        compose.onNodeWithText("챌린지 내용 보기").performScrollTo().performClick()
        assertEquals("challenge/parity-challenge", target)
        assertTrue(received.first { it.requestUrl!!.encodedPath.endsWith("/posts") }.requestUrl!!.queryParameter("limit") == "6")
    }

    @Test fun profileGroupFailureDoesNotPretendToBeEmptyOrLocked() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { com.google.gson.JsonParser.parseString(it.readText()).asJsonObject }
        val groupCalls = AtomicInteger(0)
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/me" -> response(fixture.child("profile").toString())
            "/api/v1/todo-lists" -> if(groupCalls.incrementAndGet() == 1) response("{}", 503) else response("[]")
            "/api/v1/public/users/parity.cloud/posts" -> response("""{"items":[],"nextCursor":null}""")
            else -> response("{}", 404)
        } }
        compose.setContent { MungsilTheme { ProfileScreen(api, 0, {}, {}) } }
        waitText("테스트 구름")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("나의 TODO 그룹"))
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("아직 만든 TODO 그룹이 없어요.").assertDoesNotExist()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("루틴 메이커 배지 상세 보기, 확인 필요"))
        compose.onNodeWithContentDescription("루틴 메이커 배지 상세 보기, 확인 필요").assertExists()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("다시 시도"))
        compose.onNodeWithText("다시 시도").performClick()
        waitText("아직 만든 TODO 그룹이 없어요.")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("루틴 메이커 배지 상세 보기, 도전 중"))
        compose.onNodeWithContentDescription("루틴 메이커 배지 상세 보기, 도전 중").assertExists()
    }

    @Test fun defaultCategoryArchiveSendsOnlyAllowedFields() {
        dispatch { request -> when(request.method) {
            "GET" -> response("""[{"id":"default-health","name":"건강","baseCategory":"건강","icon":"heart","color":"blush","isDefault":true,"todoCount":1}]""")
            "PATCH" -> response("{}")
            else -> response("{}", 404)
        } }
        compose.setContent { MungsilTheme { CategoriesScreen(api, 0, {}, {}) } }
        waitText("건강")
        compose.onNodeWithText("편집").performClick()
        waitText("목록에서 숨기기")
        compose.onAllNodes(isToggleable()).onFirst().performClick()
        compose.onNodeWithText("저장").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.method == "PATCH" } }
        val payload = com.google.gson.JsonParser.parseString(received.single { it.method == "PATCH" }.body.readUtf8()).asJsonObject
        assertEquals(setOf("archived"), payload.keySet())
        assertTrue(payload.get("archived").asBoolean)
    }

    @Test fun customCategorySavesColorAndPreservesExistingIcon() {
        dispatch { request -> when(request.method) {
            "GET" -> response("""[{"id":"custom-walk","name":"산책","baseCategory":"건강","icon":"activity","color":"blush","isDefault":false,"todoCount":1}]""")
            "PATCH" -> response("{}")
            else -> response("{}", 404)
        } }
        compose.setContent { MungsilTheme { CategoriesScreen(api, 0, {}, {}) } }
        waitText("산책")
        compose.onNodeWithText("편집").performClick()
        compose.onNodeWithText("색상").assertExists()
        compose.onNodeWithText("핑크").performScrollTo().performClick()
        waitText("색상 선택")
        compose.onNodeWithText("민트").performClick()
        compose.onNodeWithText("저장").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.method == "PATCH" } }
        val payload = com.google.gson.JsonParser.parseString(received.single { it.method == "PATCH" }.body.readUtf8()).asJsonObject
        assertEquals("aqua", payload.get("color").asString)
        assertEquals("activity", payload.get("icon").asString)
        assertEquals("산책", payload.get("name").asString)
    }

    @Test fun routineModesPreserveOffsetsAndCustomDraftAcrossSavedState() {
        val attempts = AtomicInteger(0)
        dispatch { request -> if(request.method == "POST") {
            when(attempts.incrementAndGet()) {
                1,2 -> response("{\"message\":\"설정을 확인해주세요.\"}",400)
                3 -> response("{}",503)
                else -> response(json("id" to "copied-list","userId" to me.text("id"),"visibility" to "PRIVATE").toString())
            }
        } else response("{}") }
        val source = com.google.gson.JsonParser.parseString("""{"id":"source-list","title":"작은 루틴","items":[{"todo":{"id":"r1","title":"첫 산책","category":"건강","dueDate":"2026-09-22T03:00:00Z","repeatRule":"FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2"}},{"todo":{"id":"r2","title":"다음 독서","category":"독서","dueDate":"2026-09-23T05:00:00Z","repeatRule":null}}]}""").asJsonObject
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides me.text("id")) { RoutineImportSheet(api, ZoneId.of("Asia/Seoul"), source, {}, {}) } } }
        compose.onNodeWithText("항목별 설정").performScrollTo().performClick()
        compose.onAllNodesWithContentDescription("할 일").onFirst().performScrollTo().performTextClearance()
        compose.onAllNodesWithContentDescription("할 일").onFirst().performTextInput("편집한 산책")
        compose.onAllNodes(hasText("반복 없음") and hasClickAction()).onFirst().performScrollTo().performClick()
        compose.onNodeWithText("내 TODO로 가져오기").performScrollTo().performClick()
        compose.waitUntil(10_000) { attempts.get() >= 1 }; waitText("설정을 확인해주세요.")
        compose.onNodeWithText("원본 유지").performScrollTo().performClick()
        compose.onNodeWithText("내 TODO로 가져오기").performScrollTo().performClick()
        compose.waitUntil(10_000) { attempts.get() >= 2 }; waitText("설정을 확인해주세요.")
        compose.onNodeWithText("항목별 설정").performScrollTo().performClick()
        restoration.emulateSavedInstanceStateRestore()
        compose.onAllNodesWithContentDescription("할 일").onFirst().assertTextEquals("편집한 산책")
        compose.onNodeWithText("내 TODO로 가져오기").performScrollTo().performClick()
        compose.waitUntil(10_000) { attempts.get() >= 3 }
        waitText("가져오기 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.onAllNodesWithContentDescription("할 일").onFirst().assertIsNotEnabled()
        compose.onNodeWithText("가져오기 결과 확인").performScrollTo().performClick()
        compose.waitUntil(10_000) { attempts.get() >= 4 }
        val requests = received.filter { it.method == "POST" }
        val payloads = requests.map { com.google.gson.JsonParser.parseString(it.body.clone().readUtf8()).asJsonObject }
        assertEquals("NONE", payloads[0].get("repeatMode").asString); assertFalse(payloads[0].has("items"))
        assertEquals("KEEP", payloads[1].get("repeatMode").asString); assertFalse(payloads[1].has("items"))
        val rows = payloads[2].getAsJsonArray("items")
        assertEquals("편집한 산책", rows[0].asJsonObject.get("title").asString)
        assertEquals("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2", rows[0].asJsonObject.get("repeatRule").asString)
        val first = java.time.Instant.parse(rows[0].asJsonObject.get("dueDate").asString)
        val second = java.time.Instant.parse(rows[1].asJsonObject.get("dueDate").asString)
        assertEquals(26L, java.time.Duration.between(first, second).toHours())
        assertEquals(requests[2].getHeader("Idempotency-Key"), requests[3].getHeader("Idempotency-Key"))
    }
    private fun dispatch(handler: (RecordedRequest) -> MockResponse) {
        server.dispatcher = object: Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse { received += request; return handler(request) } }
    }
    private fun waitText(text: String) {
        try {
            compose.waitUntil(15_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        } catch (error: Throwable) {
            screenshot("failure")
            throw AssertionError("Requests: ${received.map { it.path }}\n${compose.onAllNodes(isRoot()).onFirst().printToString()}", error)
        }
    }
    private fun screenshot(name: String, composeFrame: Boolean = false, sheetTitle: String? = null) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val label = InstrumentationRegistry.getArguments().getString("screenshotLabel", "default")
        val dir = File(context.getExternalFilesDir(null), "native-verification/$label").apply { mkdirs() }
        compose.waitForIdle()
        if(sheetTitle != null) {
            compose.onNodeWithText(sheetTitle).assertExists()
            compose.mainClock.advanceTimeBy(500)
            compose.waitForIdle()
            // Dialog semantics and its separate window can settle at different
            // frames. Capture the composited screen, not the activity window.
            Thread.sleep(300)
        }
        // PixelCopy waits for the Compose frame, unlike a system screenshot taken
        // immediately after a lazy-list response changes its semantics.
        // Select a sheet's own window by its title, rather than assuming root order.
        val bitmap = if(composeFrame && sheetTitle == null && android.os.Build.VERSION.SDK_INT >= 26) {
            val root = compose.onAllNodes(isRoot()).onFirst()
            root.captureToImage().asAndroidBitmap()
        } else InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(dir, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun googleSignupCollectsProfileBeforeCreatingServerSession() {
        val attempts = AtomicInteger(0)
        val pickerCalls = AtomicInteger(0)
        dispatch { request ->
            if (request.path == "/api/v1/auth/google") {
                if (attempts.incrementAndGet() == 1) response("""{"code":"GOOGLE_PROFILE_REQUIRED","message":"가입 정보가 필요해요."}""", 400)
                else response("""{"accessToken":"synthetic-session","user":{"id":"synthetic-user"}}""")
                    .addHeader("Set-Cookie", "mungsil_refresh=synthetic-refresh; HttpOnly; Path=/api/v1/auth")
            } else response("{}")
        }
        compose.setContent { MungsilTheme {
            var signedIn by remember { mutableStateOf(false) }
            val action = rememberAction()
            androidx.compose.foundation.layout.Column {
                if (signedIn) androidx.compose.material3.Text("Google 로그인 완료")
                else GoogleLogin(api, json("googleAuthEnabled" to true, "googleClientId" to "synthetic.apps.googleusercontent.com", "inviteRequired" to true), { signedIn = true }, action) { _, _ -> pickerCalls.incrementAndGet(); "synthetic-google-token" }
            }
        } }
        compose.onNodeWithText("Google로 계속하기").performClick()
        waitText("Google 가입 마무리")
        assertNull(api.accessToken)
        compose.onNodeWithContentDescription("사용자 아이디").performTextInput("cloud.test")
        compose.onNodeWithContentDescription("생년월일").performTextInput("1990-01-01")
        compose.onNodeWithContentDescription("초대 코드").performTextInput("test-invite")
        compose.onAllNodes(isToggleable()).onFirst().performScrollTo().performClick()
        compose.onNodeWithText("Google 계정으로 가입 완료").performScrollTo()
        screenshot("google-profile")
        // Check a stable viewport too: Gboard can display a font-change banner
        // while the IME animates after the test changes the system font scale.
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.onNode(hasText("Google 계정으로 가입 완료") and hasClickAction()).performScrollTo().assertIsDisplayed()
        screenshot("google-profile-ready")
        compose.onNodeWithText("Google 계정으로 가입 완료").performScrollTo().performClick()
        waitText("Google 로그인 완료")
        assertEquals("synthetic-session", api.accessToken)
        assertEquals(2, attempts.get())
        assertEquals(1, pickerCalls.get())
        val body = received.last().body.readUtf8()
        assertTrue(body.contains("1990-01-01")); assertTrue(body.contains("test-invite"))
    }

    @Test fun googleDismissalIsVisibleAndDoesNotContactServer() {
        dispatch { response("{}", 500) }
        compose.setContent { MungsilTheme { androidx.compose.foundation.layout.Column {
            GoogleLogin(api, json("googleAuthEnabled" to true, "googleClientId" to "synthetic.apps.googleusercontent.com"), {}, rememberAction()) { _, _ -> null }
        } } }
        compose.onNodeWithText("Google로 계속하기").performClick()
        waitText("다른 방식으로 Google 계정 선택")
        compose.onNodeWithText("Google에서 로그인 결과를 받지 못했어요.", substring = true).assertIsDisplayed()
        assertTrue(received.isEmpty())
        assertNull(api.accessToken)
    }

    @Test fun existingGoogleAccountEntersAppOnlyAfterServerSession() {
        dispatch { response("""{"accessToken":"own-session","user":{"id":"existing"}}""").addHeader("Set-Cookie", "mungsil_refresh=own-refresh; Path=/api/v1/auth") }
        compose.setContent { MungsilTheme { androidx.compose.foundation.layout.Column {
            var account by remember { mutableStateOf("") }
            if(account.isBlank()) GoogleLogin(api, json("googleAuthEnabled" to true, "googleClientId" to "synthetic.apps.googleusercontent.com"), { account = it.text("id") }, rememberAction()) { _, _ -> "identity" }
            else androidx.compose.material3.Text("기존 계정 로그인 완료")
        } } }
        compose.onNodeWithText("Google로 계속하기").performClick()
        waitText("기존 계정 로그인 완료")
        assertEquals("own-session", api.accessToken)
        assertEquals("/api/v1/auth/google", received.single().path)
    }

    @Test fun nestedProfileBackReturnsToPostRatherThanRootTab() {
        dispatch { request -> when {
            request.path?.contains("posts/post-navigation") == true -> response("""{"id":"post-navigation","author":{"id":"author","handle":"writer","nickname":"기록 작성자"},"todos":[],"hashtags":[],"caption":"돌아올 기록","items":[]}""")
            request.requestUrl!!.encodedPath.endsWith("users/writer/posts") -> response("""{"items":[],"nextCursor":null}""")
            request.requestUrl!!.encodedPath.endsWith("follow-state/author") -> response("""{"following":false,"blocked":false,"followerCount":0,"followingCount":0}""")
            request.path?.contains("users/writer") == true -> response("""{"id":"author","nickname":"작성자 프로필","handle":"writer","rank":"구름씨앗","lifetimePower":0,"_count":{"posts":0,"followers":0,"following":0}}""")
            else -> response("[]")
        } }
        compose.setContent { MungsilTheme { NativeApp(api, 2, me, null, {}, {}, {}, appLink = AppLink("post/post-navigation")) } }
        waitText("돌아올 기록")
        compose.onNodeWithText("기록 작성자").performClick()
        waitText("작성자 프로필")
        compose.onNodeWithContentDescription("뒤로").performClick()
        waitText("돌아올 기록")
        compose.onNodeWithText("실천 기록").assertExists()
    }

    @Test fun googleResultSurvivesLoginCompositionRecreation() {
        val result = kotlinx.coroutines.CompletableDeferred<String?>()
        var mounted by mutableStateOf(true)
        var completed by mutableStateOf(false)
        val calls = AtomicInteger(0)
        dispatch { response("""{"accessToken":"own-session","user":{"id":"existing"}}""").addHeader("Set-Cookie", "mungsil_refresh=own-refresh; Path=/api/v1/auth") }
        compose.setContent { MungsilTheme { androidx.compose.foundation.layout.Column {
            if(completed) androidx.compose.material3.Text("재생성 후 로그인 완료")
            else if(mounted) GoogleLogin(api, json("googleAuthEnabled" to true, "googleClientId" to "synthetic.apps.googleusercontent.com"), { completed = true }, rememberAction()) { _, _ -> calls.incrementAndGet(); result.await() }
        } } }
        compose.onNodeWithText("Google로 계속하기").performClick()
        compose.runOnIdle { mounted = false }
        compose.waitForIdle()
        compose.runOnIdle { mounted = true }
        compose.waitForIdle()
        result.complete("synthetic-identity")
        waitText("재생성 후 로그인 완료")
        assertEquals(1, calls.get())
        assertEquals(1, received.size)
    }

    @Test fun parityScreensUseSharedSyntheticFixture() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { com.google.gson.JsonParser.parseString(it.readText()).asJsonObject }
        // Match the web capture's date projection; keep the fixture's local times.
        val captureDay = java.time.LocalDate.now(ZoneId.of("Asia/Seoul")).toString()
        val captureTodos = fixture.list("todos").map { it.deepCopy().apply { addProperty("dueDate", captureDay + text("dueDate").substring(10)) } }
        val profilePreview = java.util.concurrent.atomic.AtomicBoolean(false)
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/todos" -> response(com.google.gson.Gson().toJson(captureTodos))
            "/api/v1/todo-lists" -> response(if(profilePreview.get()) fixture.get("groups").toString() else "[]")
            "/api/v1/public/users/parity.cloud" -> response(fixture.child("profile").toString())
            "/api/v1/social/followers/parity-user", "/api/v1/social/following/parity-user" -> response(json("items" to fixture.list("connections"), "nextCursor" to null).toString())
            "/api/v1/challenges" -> response("[]")
            "/api/v1/me/todo-categories" -> response(fixture.get("categories").toString())
            "/api/v1/me" -> response(fixture.child("profile").toString())
            "/api/v1/public/users/parity.cloud/posts" -> response(json("items" to listOf(fixture.child("post")), "nextCursor" to null).toString())
            "/api/v1/feed" -> response(json("items" to listOf(fixture.child("post")), "nextCursor" to null).toString())
            "/api/v1/feed/posts/parity-post" -> response(fixture.child("post").toString())
            "/api/v1/feed/posts/parity-post/comments" -> response("""{"items":[],"nextCursor":null}""")
            "/api/v1/public/search" -> response(fixture.child("searchResults").toString())
            "/api/v1/public/search/suggestions" -> response(fixture.child("searchSuggestions").toString())
            else -> response("""{"count":0}""")
        } }
        compose.setContent { MungsilTheme { NativeApp(api, 2, fixture.child("user"), null, {}, {}, {}) } }
        waitText("이 실천 완료하기")
        waitText("1 / 2 완료")
        screenshot("parity-today", composeFrame = true)
        compose.onNode(hasText("TODO") and hasClickAction()).performClick()
        waitText("내 TODO")
        compose.onNode(hasText("월") and hasClickAction()).assertWidthIsAtLeast(44.dp).assertHeightIsAtLeast(44.dp)
        compose.waitUntil(10_000) { compose.onAllNodesWithText("점심 산책 10분").fetchSemanticsNodes().isNotEmpty() }
        screenshot("parity-todos", composeFrame = true)
        compose.onNode(hasText("탐색") and hasClickAction()).performClick()
        waitText("잠깐의 산책으로 오후를 가볍게 시작했어요.")
        screenshot("parity-explore", composeFrame = true)
        compose.onNodeWithText("댓글 0").performScrollTo().performClick()
        waitText("실천 기록")
        waitText("잠깐의 산책으로 오후를 가볍게 시작했어요.")
        screenshot("parity-post", composeFrame = true)
        profilePreview.set(true)
        compose.onNode(hasText("마이") and hasClickAction()).performClick()
        waitText("테스트 구름")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("1개의 최근 기록"))
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        screenshot("parity-me", composeFrame = true)
        compose.onNode(hasText("TODO") and hasClickAction()).performClick()
        waitText("내 TODO")
        compose.onNode(hasText("그룹") and hasClickAction()).performClick()
        waitText("가벼운 하루")
        screenshot("parity-groups", composeFrame = true)
        compose.onNodeWithText("루틴으로 게시").performScrollTo().performClick()
        waitText("실천 게시하기")
        screenshot("parity-publish", sheetTitle = "실천 게시하기")
        compose.onNodeWithContentDescription("닫기").performClick()
        compose.onNode(hasText("카테고리") and hasClickAction()).performClick()
        waitText("건강")
        screenshot("parity-categories", composeFrame = true)
        compose.onNode(hasText("탐색") and hasClickAction()).performClick()
        waitText("잠깐의 산책으로 오후를 가볍게 시작했어요.")
        compose.onNodeWithText("테스트 구름").performScrollTo().performClick()
        waitText("내 프로필 관리")
        waitText("게시한 실천")
        screenshot("parity-person", composeFrame = true)
        compose.onNode(hasText("팔로워") and hasClickAction()).performScrollTo().performClick()
        waitText("산책 구름")
        screenshot("parity-connections", composeFrame = true)
        compose.onNodeWithContentDescription("뒤로").performClick()
        waitText("내 프로필 관리")
        compose.onNodeWithContentDescription("뒤로").performClick()
        waitText("잠깐의 산책으로 오후를 가볍게 시작했어요.")
        compose.onNodeWithContentDescription("뒤로").performClick()
        waitText("좋은 실천을 가볍게 둘러보세요")
        compose.waitForIdle()
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        compose.onNodeWithContentDescription("실천 · 사람 · 해시태그 검색").performClick()
        compose.onNodeWithContentDescription("통합 검색").performTextInput("실천")
        compose.onNode(hasText("검색") and hasClickAction()).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        waitText("5개의 공개 결과를 찾았어요")
        compose.waitForIdle()
        screenshot("parity-search", composeFrame = true)
    }

    @Test fun groupSearchPagingKeepsSelectionAndPublicScopeAfterRestoreAndFailedSave() {
        val attempts = AtomicInteger(0); val pages = AtomicInteger(0)
        val a = com.google.gson.JsonParser.parseString(todo).asJsonObject
        val b = a.deepCopy().apply { addProperty("id", "todo-2"); addProperty("title", "저녁 독서") }
        val c = a.deepCopy().apply { addProperty("id", "todo-3"); addProperty("title", "다른 그룹 반복"); addProperty("seriesId", "other-series") }
        val group = json("id" to "group", "title" to "공개 루틴", "description" to "작은 실천", "visibility" to "PUBLIC", "items" to listOf(json("todo" to a)))
        val other = json("id" to "other", "title" to "저녁", "items" to listOf(json("todo" to c.deepCopy().apply { addProperty("id", "old-occurrence") })))
        dispatch { request -> when {
            request.method == "PATCH" -> if(attempts.incrementAndGet() == 1) response("{}", 503) else response("{}")
            request.requestUrl!!.queryParameter("cursor") != null -> if(pages.incrementAndGet() == 1) response("{}", 503) else response(json("items" to listOf(b, c), "nextCursor" to null).toString())
            request.requestUrl!!.queryParameter("query") == "없는 검색" -> response("""{"items":[],"nextCursor":null}""")
            else -> response(json("items" to listOf(b), "nextCursor" to "next").toString()).setBodyDelay(150, java.util.concurrent.TimeUnit.MILLISECONDS)
        } }
        val restoration = StateRestorationTester(compose)
        var saved = 0
        restoration.setContent { MungsilTheme { GroupForm(api, ZoneId.of("Asia/Seoul"), group, listOf(group, other), {}, { saved++ }) } }
        waitText("저녁 독서")
        compose.onNodeWithContentDescription("저녁 독서 선택").performScrollTo().performClick()
        compose.onNodeWithText("선택한 TODO · 2/30개").assertExists()
        compose.onNodeWithText("더 보기").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("다시 시도").performScrollTo().performClick()
        waitText("다른 그룹 반복")
        compose.onNodeWithContentDescription("다른 그룹 반복 선택").performScrollTo().assertIsNotEnabled()
        assertEquals(1, compose.onAllNodesWithContentDescription("저녁 독서 선택").fetchSemanticsNodes().size)
        compose.onNodeWithContentDescription("TODO 제목 검색").performScrollTo().performTextInput("없는 검색")
        waitText("검색 결과 · 0개 표시")
        compose.onNodeWithText("선택한 TODO · 2/30개").assertExists()
        compose.onNodeWithContentDescription("닫기").performClick()
        waitText("작성을 그만둘까요?")
        compose.onNodeWithText("돌아가기").performClick()
        compose.onNodeWithText("그룹 변경사항 저장").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        waitText("선택한 TODO · 2/30개")
        compose.onNodeWithContentDescription("TODO 제목 검색").assertTextEquals("없는 검색")
        screenshot("group-editor", sheetTitle = "TODO 그룹 편집")
        compose.onNodeWithText("그룹 변경사항 저장").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(10_000) { saved == 1 }
        val writes = received.filter { it.method == "PATCH" }
        assertEquals(2, writes.size)
        assertEquals(writes[0].getHeader("Idempotency-Key"), writes[1].getHeader("Idempotency-Key"))
        val body = writes[0].body.readUtf8()
        assertEquals(body, writes[1].body.readUtf8())
        val payload = com.google.gson.JsonParser.parseString(body).asJsonObject
        assertEquals(listOf("todo-1", "todo-2"), payload.strings("todoIds"))
        assertFalse(payload.has("visibility"))
        assertTrue(received.filter { it.method == "GET" }.all { it.requestUrl!!.queryParameter("from") != null && it.requestUrl!!.queryParameter("to") != null })
    }

    @Test fun repeatingTodoKeepsExactScheduleAndUnavailableRelationsOnRetryAfterRestore() {
        val source = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply {
            addProperty("dueDate", "2026-09-28T00:00:30.123Z"); addProperty("seriesId", "series")
            addProperty("repeatRule", "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2"); addProperty("visibility", "FOLLOWERS")
        }
        val attempts = AtomicInteger(0); var saved = 0
        dispatch { request -> if(request.method == "PATCH" && attempts.incrementAndGet() == 2) response("{}") else response("{}", 503) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "synthetic-user") { TodoForm(api, ZoneId.of("Asia/Seoul"), source, "2026-09-28", false, {}, { saved++ }) } } }
        waitText("원본 반복 유지")
        compose.onNodeWithContentDescription("할 일").performScrollTo().performTextClearance()
        compose.onNodeWithContentDescription("할 일").performTextInput("편집한 반복 일정")
        compose.onNodeWithText("이후 일정도").performScrollTo().performClick()
        compose.onNodeWithText("저장").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(10_000) { attempts.get() == 1 }
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("저장 결과 확인") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        restoration.emulateSavedInstanceStateRestore()
        waitText("편집한 반복 일정")
        screenshot("todo-repeat-editor", sheetTitle = "TODO 편집")
        compose.onNodeWithText("저장 결과 확인").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(10_000) { saved == 1 }
        val writes = received.filter { it.method == "PATCH" }
        assertEquals(2, writes.size)
        assertEquals(writes[0].getHeader("Idempotency-Key"), writes[1].getHeader("Idempotency-Key"))
        val body = writes[0].body.readUtf8(); assertEquals(body, writes[1].body.readUtf8())
        val payload = com.google.gson.JsonParser.parseString(body).asJsonObject
        assertEquals(source.text("dueDate"), payload.text("dueDate")); assertEquals(source.text("repeatRule"), payload.text("repeatRule"))
        assertEquals("FUTURE", payload.text("recurrenceScope")); assertEquals("FOLLOWERS", payload.text("visibility"))
        assertFalse(payload.has("categoryId")); assertFalse(payload.has("category")); assertFalse(payload.has("todoListId"))
    }

    @Test fun groupCreationPublishingAndDeletionUseExistingContractsAndKeepTodos() {
        val candidate = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply { addProperty("completedAt", "2026-09-28T01:00:00Z") }
        val group = json("id" to "created-group", "title" to "작은 실천 루틴", "visibility" to "PRIVATE", "items" to listOf(json("todo" to candidate)))
        val exists = java.util.concurrent.atomic.AtomicBoolean(false)
        dispatch { request -> when {
            request.method == "POST" && request.requestUrl!!.encodedPath.endsWith("/todo-lists") -> { exists.set(true); response(group.toString()) }
            request.method == "POST" -> response("{}")
            request.method == "DELETE" -> { exists.set(false); response("{}") }
            request.requestUrl!!.encodedPath.endsWith("/search") -> response(json("items" to listOf(candidate), "nextCursor" to null).toString())
            else -> response(if(exists.get()) "[$group]" else "[]")
        } }
        compose.setContent { MungsilTheme { var revision by remember { mutableIntStateOf(0) }; GroupsScreen(api, ZoneId.of("Asia/Seoul"), revision, { revision++ }) } }
        waitText("아직 만든 그룹이 없어요")
        compose.onNodeWithContentDescription("새 TODO 그룹 만들기").performClick()
        compose.onNodeWithContentDescription("그룹 이름").performTextInput("작은 실천 루틴")
        compose.onNodeWithText("TODO 그룹 만들기").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        waitText("TODO를 하나 이상 선택해주세요.")
        assertFalse(received.any { it.method == "POST" })
        compose.onNodeWithContentDescription("점심 산책 10분 선택").performScrollTo().performClick()
        compose.onNodeWithText("TODO 그룹 만들기").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        waitText("루틴으로 게시")
        compose.onNodeWithText("루틴으로 게시").performScrollTo().performClick()
        waitText("실천 게시하기")
        compose.onNodeWithContentDescription("오늘의 한마디").performTextInput("작은 실천을 모았어요")
        for(tag in listOf("#산책", "산책", "독서")) {
            compose.onNodeWithContentDescription("해시태그 입력").performScrollTo().performTextInput(tag)
            compose.onNodeWithContentDescription("해시태그 입력").performImeAction()
        }
        compose.onNodeWithText("팔로워").performScrollTo().performClick()
        compose.onNodeWithText("피드에 게시하기").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(10_000) { received.any { it.method == "POST" && it.requestUrl!!.encodedPath.endsWith("/feed/posts") } }
        waitText("관리")
        compose.onNodeWithText("관리").performClick()
        compose.onNodeWithText("그룹 삭제").performScrollTo().performClick()
        waitText("그룹을 삭제할까요?")
        compose.onNodeWithText("안에 있던 할 일은 유지돼요. 이 그룹으로 게시한 루틴 기록과 사진은 삭제되며 복구되지 않아요.").assertExists()
        compose.onAllNodesWithText("그룹 삭제").onLast().performScrollTo().performClick()
        waitText("아직 만든 그룹이 없어요")
        val create = com.google.gson.JsonParser.parseString(received.single { it.method == "POST" && it.requestUrl!!.encodedPath.endsWith("/todo-lists") }.body.readUtf8()).asJsonObject
        assertEquals(listOf("todo-1"), create.strings("todoIds")); assertEquals("PRIVATE", create.text("visibility"))
        val publish = com.google.gson.JsonParser.parseString(received.single { it.method == "POST" && it.requestUrl!!.encodedPath.endsWith("/feed/posts") }.body.readUtf8()).asJsonObject
        assertEquals("created-group", publish.text("todoListId")); assertEquals("FOLLOWERS", publish.text("visibility")); assertEquals(listOf("산책", "독서"), publish.strings("hashtags"))
        assertEquals(listOf("/api/v1/todo-lists/created-group"), received.filter { it.method == "DELETE" }.map { it.requestUrl!!.encodedPath })
    }

    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test fun categoryOrderAccessibleMovesAndFailedSaveKeepDraftAndRequestIdentity() {
        val categories = listOf(json("id" to "a", "name" to "생활"), json("id" to "b", "name" to "건강"), json("id" to "c", "name" to "독서"), json("id" to "hidden", "name" to "숨긴 분류", "archivedAt" to "2026-09-28T00:00:00Z"))
        val attempts = AtomicInteger(0); var saved = 0
        dispatch { if(attempts.incrementAndGet() == 1) response("{}", 503) else response("{}") }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { CategoryOrderSheet(api, categories, {}, { saved++ }) } }
        compose.onNodeWithText("숨긴 분류").assertDoesNotExist()
        compose.onNodeWithContentDescription("생활 맨 아래로").performScrollTo().performClick()
        compose.onNodeWithText("3. 생활").assertExists()
        // Exercise the accessibility action used by TalkBack, without claiming a real TalkBack session.
        val accessibleRow = compose.onNode(androidx.compose.ui.test.SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.CustomActions) and hasAnyDescendant(hasText("독서", substring = true)), useUnmergedTree = true).fetchSemanticsNode()
        compose.runOnIdle { assertTrue(accessibleRow.config[androidx.compose.ui.semantics.SemanticsActions.CustomActions].first { it.label == "맨 위로 이동" }.action()) }
        compose.onNodeWithText("1. 독서").assertExists()
        compose.onNodeWithContentDescription("생활 순서 이동").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus) { assertTrue(it()) }
        compose.onNodeWithContentDescription("생활 순서 이동").assertIsFocused().performKeyInput { pressKey(androidx.compose.ui.input.key.Key.MoveHome) }
        compose.onNodeWithText("1. 생활").assertExists()
        compose.onNodeWithContentDescription("생활 순서 이동").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.MoveEnd) }
        compose.onNodeWithText("3. 생활").assertExists()
        compose.onNodeWithText("순서 저장").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("1. 독서").assertExists(); compose.onNodeWithText("3. 생활").assertExists()
        screenshot("category-order", sheetTitle = "카테고리 순서")
        compose.onNodeWithText("순서 저장").performScrollTo().performClick()
        compose.waitUntil(10_000) { saved == 1 }
        val writes = received.filter { it.method == "PATCH" }
        assertEquals(2, writes.size); assertEquals(writes[0].getHeader("Idempotency-Key"), writes[1].getHeader("Idempotency-Key"))
        val body = writes[0].body.readUtf8(); assertEquals(body, writes[1].body.readUtf8())
        assertEquals(listOf("c", "b", "a"), com.google.gson.JsonParser.parseString(body).asJsonObject.strings("ids"))
    }

    @Test fun categoryTodoPagingDedupeStatusAndScheduleUseAccountDate() {
        val a = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply { addProperty("dueDate", "2026-09-28T16:30:00Z") }
        val b = a.deepCopy().apply { addProperty("id", "completed"); addProperty("title", "완료한 산책"); addProperty("completedAt", "2026-09-28T17:00:00Z") }
        var target = ""
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/todo-categories") -> response("""[{"id":"health","name":"건강","todoCount":2}]""")
            request.requestUrl!!.queryParameter("status") == "DONE" -> response(json("items" to listOf(b), "nextCursor" to null).toString())
            request.requestUrl!!.queryParameter("cursor") != null -> response(json("items" to listOf(a, b), "nextCursor" to null).toString())
            else -> response(json("items" to listOf(a), "nextCursor" to "next").toString())
        } }
        compose.setContent { MungsilTheme { CategoriesScreen(api, 0, {}, { target = it }, ZoneId.of("Asia/Seoul")) } }
        waitText("건강"); compose.onNodeWithText("건강").performClick()
        waitText("예정 · 점심 산책 10분")
        compose.onNodeWithText("더 보기").performScrollTo().performClick()
        waitText("완료 · 완료한 산책")
        assertEquals(1, compose.onAllNodesWithText("예정 · 점심 산책 10분").fetchSemanticsNodes().size)
        compose.onNodeWithText("완료", substring = false).performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("예정 · 점심 산책 10분").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("2026-09-29 · 일정 보기").performScrollTo().performClick()
        assertEquals("schedule/2026-09-29", target)
        assertTrue(received.any { it.requestUrl!!.queryParameter("status") == "DONE" })
    }

    @Test fun todoDeleteRestoreAndSeriesEndKeepOtherDatesAndExplainRecordLoss() {
        val source = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply { addProperty("seriesId", "series") }
        val deleted = java.util.concurrent.atomic.AtomicBoolean(false)
        val restoreAttempts = AtomicInteger(0)
        dispatch { request -> when {
            request.method == "DELETE" -> { if(!request.requestUrl!!.encodedPath.endsWith("/series")) deleted.set(true); response("{}") }
            request.method == "POST" -> if(restoreAttempts.incrementAndGet() == 1) response("{}", 503) else { deleted.set(false); response(source.toString()) }
            request.requestUrl!!.encodedPath.endsWith("/todo-lists") -> response("[]")
            else -> response(if(deleted.get()) "[]" else "[$source]")
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme {
            var revision by androidx.compose.runtime.saveable.rememberSaveable { mutableIntStateOf(0) }
            TodosScreen(api, ZoneId.of("Asia/Seoul"), false, revision, { revision++ }, {}, "2026-09-22")
        } }
        waitText("점심 산책 10분")
        compose.onNodeWithContentDescription("점심 산책 10분 메뉴").performScrollTo().performClick()
        compose.onNodeWithText("삭제").performClick()
        waitText("TODO를 삭제할까요?")
        compose.onNodeWithText("선택한 할 일과 연결된 게시물·사진이 삭제돼요. 반복 일정의 다른 날짜는 유지돼요. TODO를 되돌려도 게시물과 사진은 복구되지 않아요.").assertExists()
        compose.onNodeWithText("삭제").performScrollTo().performClick()
        waitText("삭제한 TODO 되돌리기")
        compose.onNodeWithText("삭제한 TODO 되돌리기").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        waitText("삭제한 TODO 되돌리기")
        compose.onNodeWithText("삭제한 TODO 되돌리기").performScrollTo().performClick()
        compose.waitUntil(10_000) { !deleted.get() && restoreAttempts.get() == 2 }
        waitText("점심 산책 10분")
        compose.onNodeWithContentDescription("점심 산책 10분 메뉴").performScrollTo().performClick()
        compose.onNodeWithText("반복 종료").performClick()
        waitText("반복을 종료할까요?")
        compose.onNodeWithText("이 일정 이후의 반복을 종료해요. 이미 완료한 기록은 유지돼요.").assertExists()
        compose.onNodeWithText("반복 종료").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.method == "DELETE" && it.requestUrl!!.encodedPath.endsWith("/series") } }
        assertEquals(listOf("/api/v1/todos/todo-1", "/api/v1/todos/todo-1/series"), received.filter { it.method == "DELETE" }.map { it.requestUrl!!.encodedPath })
        val restores = received.filter { it.method == "POST" }
        assertEquals(2, restores.size); assertTrue(restores.all { it.requestUrl!!.encodedPath == "/api/v1/todos/todo-1/restore" })
        assertEquals(restores[0].getHeader("Idempotency-Key"), restores[1].getHeader("Idempotency-Key"))
        assertFalse(deleted.get())
    }

    @Test fun profileLongContentAndEmptyRecordsRemainUsable() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { com.google.gson.JsonParser.parseString(it.readText()).asJsonObject }
        val profile = fixture.child("profile").deepCopy().apply {
            addProperty("nickname", "작은실천을꾸준하게이어가는구름")
            addProperty("bio", "오늘도 나의 속도로 작은 실천을 이어가고 있어요. ".repeat(5))
            child("_count").addProperty("posts", 0)
            add("earnedTitles", com.google.gson.JsonArray())
        }
        dispatch { request -> when(request.requestUrl!!.encodedPath) {
            "/api/v1/me" -> response(profile.toString())
            "/api/v1/todo-lists" -> response("[]")
            "/api/v1/public/users/parity.cloud/posts" -> response("""{"items":[],"nextCursor":null}""")
            else -> response("{}", 404)
        } }
        compose.setContent { MungsilTheme { ProfileScreen(api, 0, {}, {}) } }
        waitText(profile.text("nickname"))
        screenshot("profile-long", composeFrame = true)
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("아직 만든 TODO 그룹이 없어요."))
        compose.onNodeWithText("아직 만든 TODO 그룹이 없어요.").assertIsDisplayed()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("첫 게시 배지 상세 보기, 도전 중"))
        compose.onNodeWithContentDescription("첫 게시 배지 상세 보기, 도전 중").performClick()
        waitText("배지 이야기")
        compose.onNodeWithText("획득 조건 · 첫 번째 실천 게시").assertExists()
        screenshot("profile-empty-badge", composeFrame = true, sheetTitle = "배지 이야기")
    }

    @Test fun publicRelationshipFailureRetryAndNewActionUseDistinctKeys() {
        val person = json("id" to "other", "handle" to "other.cloud", "nickname" to "함께하는 구름", "rank" to "조각구름", "lifetimePower" to 120,
            "_count" to json("posts" to 0, "followers" to 3, "following" to 2))
        val relationCalls = AtomicInteger(0); val followCalls = AtomicInteger(0); val requests = AtomicInteger(0)
        val following = java.util.concurrent.atomic.AtomicBoolean(false)
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/follow-state/other") -> if(relationCalls.incrementAndGet() == 1) response("{}", 503) else response(json("following" to following.get(), "blocked" to false, "followerCount" to if(following.get()) 4 else 3, "followingCount" to 2).toString())
            request.requestUrl!!.encodedPath.endsWith("/social/follow") -> if(followCalls.incrementAndGet() == 1) response("{}", 503) else { following.set(!following.get()); response(json("following" to following.get()).toString()) }
            request.requestUrl!!.encodedPath.endsWith("/messages/requests") -> if(requests.incrementAndGet() == 1) response("{}", 503) else response("""{"kind":"REQUEST","requestId":"synthetic-request"}""")
            request.requestUrl!!.encodedPath.endsWith("/posts") -> response("""{"items":[],"nextCursor":null}""")
            else -> response(person.toString())
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme {
            var revision by androidx.compose.runtime.saveable.rememberSaveable { mutableIntStateOf(0) }
            PublicProfileScreen(api, "other.cloud", true, me, revision, { revision++ }, {}, {})
        } }
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("메시지").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("팔로우").assertIsNotEnabled()
        compose.onNodeWithText("다시 시도").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("팔로우") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("팔로우").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("팔로우") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("팔로우").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("팔로잉") and hasContentDescription("팔로우 상태 변경") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("팔로우 상태 변경").performScrollTo().performClick()
        compose.waitUntil(10_000) { followCalls.get() == 3 && compose.onAllNodes(hasText("팔로우") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("메시지").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("메시지") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("메시지").performScrollTo().performClick()
        waitText("메시지 요청을 보냈어요. 상대방이 수락하면 대화를 시작할 수 있어요.")
        val follows = received.filter { it.requestUrl!!.encodedPath.endsWith("/social/follow") }
        assertEquals(follows[0].getHeader("Idempotency-Key"), follows[1].getHeader("Idempotency-Key"))
        assertNotEquals(follows[1].getHeader("Idempotency-Key"), follows[2].getHeader("Idempotency-Key"))
        val messages = received.filter { it.requestUrl!!.encodedPath.endsWith("/messages/requests") }
        assertEquals(messages[0].getHeader("Idempotency-Key"), messages[1].getHeader("Idempotency-Key"))
        assertTrue(messages.all { com.google.gson.JsonParser.parseString(it.body.readUtf8()).asJsonObject.text("receiverId") == "other" })
    }

    @Test fun publicSelfAndBlockedAccessNeverOfferInvalidRelationshipActions() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("android-parity.json").bufferedReader().use { com.google.gson.JsonParser.parseString(it.readText()).asJsonObject }
        var revision by mutableIntStateOf(0)
        val revoked = java.util.concurrent.atomic.AtomicBoolean(false)
        dispatch { request -> if(revoked.get()) response("""{"message":"사용자 정보를 볼 수 없어요."}""", 403)
            else if(request.requestUrl!!.encodedPath.endsWith("/posts")) response(json("items" to listOf(fixture.child("post")), "nextCursor" to null).toString())
            else response(fixture.child("profile").toString()) }
        compose.setContent { MungsilTheme { PublicProfileScreen(api, "parity.cloud", true, fixture.child("user"), revision, {}, {}, {}) } }
        waitText("내 프로필 관리")
        compose.onNodeWithText("팔로우").assertDoesNotExist(); compose.onNodeWithText("메시지").assertDoesNotExist(); compose.onNodeWithText("차단").assertDoesNotExist()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("점심 산책 10분"))
        compose.onAllNodesWithText("점심 산책 10분").onFirst().assertIsDisplayed()
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        screenshot("public-profile", composeFrame = true)
        revoked.set(true); compose.runOnIdle { revision++ }
        waitText("사용자 정보를 볼 수 없어요.")
        compose.onNodeWithText("점심 산책 10분").assertDoesNotExist(); compose.onNodeWithText("내 프로필 관리").assertDoesNotExist()
        assertFalse(received.any { it.requestUrl!!.encodedPath.contains("follow-state") })
    }

    @Test fun connectionsPagingRetryDedupeAndDirectionKeepUnavailableUsersSafe() {
        val a = json("id" to "a", "handle" to "walk.cloud", "nickname" to "산책 구름", "cloudRank" to "조각구름")
        val gone = json("id" to "gone", "handle" to null, "nickname" to null)
        val attempts = AtomicInteger(0); var target = ""
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.contains("/following/") -> response("""{"items":[],"nextCursor":null}""")
            request.requestUrl!!.queryParameter("cursor") != null -> if(attempts.incrementAndGet() == 1) response("{}", 503) else response(json("items" to listOf(a, gone), "nextCursor" to null).toString())
            else -> response(json("items" to listOf(a), "nextCursor" to "next").toString()).setBodyDelay(150, java.util.concurrent.TimeUnit.MILLISECONDS)
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { ConnectionsScreen(api, "user", "followers", 0, { target = it }) } }
        waitText("산책 구름")
        compose.onNodeWithContentDescription("산책 구름님의 프로필 보기").performScrollTo().performClick()
        assertEquals("profile/walk.cloud", target)
        compose.onNodeWithText("더 보기").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("산책 구름").assertExists()
        compose.onNodeWithText("다시 시도").performScrollTo().performClick()
        waitText("탈퇴 또는 접근할 수 없는 사용자")
        compose.onNodeWithContentDescription("탈퇴 또는 접근할 수 없는 사용자").assertIsNotEnabled()
        assertEquals(1, compose.onAllNodesWithText("산책 구름").fetchSemanticsNodes().size)
        compose.onNodeWithText("팔로잉").performScrollTo().performClick()
        waitText("아직 함께하는 구름이 없어요")
        restoration.emulateSavedInstanceStateRestore()
        waitText("아직 함께하는 구름이 없어요")
        compose.onNode(hasText("팔로잉") and isSelectable()).assertIsSelected()
    }

    @Test fun blockAndUnblockFailuresKeepConfirmationAndDoNotRestoreFollowOrDeleteHistory() {
        val person = json("id" to "other", "handle" to "other.cloud", "nickname" to "관계 구름", "rank" to "조각구름", "lifetimePower" to 120, "_count" to json("posts" to 0, "followers" to 3, "following" to 2))
        val blocked = java.util.concurrent.atomic.AtomicBoolean(false)
        val blocks = AtomicInteger(0); val unblocks = AtomicInteger(0)
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/social/block") -> if(blocks.incrementAndGet() == 1) response("{}", 503) else { blocked.set(true); response("{\"blocked\":true}") }
            request.requestUrl!!.encodedPath.endsWith("/social/blocks/other") -> if(unblocks.incrementAndGet() == 1) response("{}", 503) else { blocked.set(false); response("{}") }
            request.requestUrl!!.encodedPath.endsWith("/social/blocks") -> response(json("items" to if(blocked.get()) listOf(json("userId" to "other", "user" to person)) else emptyList<JsonObject>(), "nextCursor" to null).toString())
            request.requestUrl!!.encodedPath.contains("follow-state") -> response("""{"following":false,"blocked":false,"followerCount":3,"followingCount":2}""")
            request.requestUrl!!.encodedPath.endsWith("/posts") -> response("""{"items":[],"nextCursor":null}""")
            else -> response(person.toString())
        } }
        compose.setContent { MungsilTheme {
            var revision by remember { mutableIntStateOf(0) }; var page by remember { mutableStateOf("profile") }
            if(page == "profile") PublicProfileScreen(api, "other.cloud", true, me, revision, { revision++ }, { page = "blocks" }, {})
            else BlocksScreen(api, revision, { revision++ })
        } }
        waitText("관계 구름")
        compose.onNodeWithText("차단").performScrollTo().performClick()
        waitText("이 사용자를 차단할까요?")
        compose.onAllNodesWithText("차단").onLast().performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("이 사용자를 차단할까요?").assertExists()
        compose.onAllNodesWithText("차단").onLast().performScrollTo().performClick()
        waitText("차단한 사용자")
        compose.onNodeWithText("차단 해제").performScrollTo().performClick()
        waitText("차단을 해제할까요?")
        compose.onNodeWithText("팔로우 관계는 자동으로 복원되지 않으며 대화 기록은 유지돼요.").assertExists()
        compose.onAllNodesWithText("차단 해제").onLast().performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onAllNodesWithText("차단 해제").onLast().performScrollTo().performClick()
        waitText("아직 기록이 없어요.")
        assertFalse(blocked.get()); assertEquals(2, unblocks.get())
        assertFalse(received.any { it.requestUrl!!.encodedPath.endsWith("/social/follow") || it.requestUrl!!.encodedPath.contains("/messages") || it.requestUrl!!.encodedPath.contains("/conversations") })
        assertEquals(2, received.count { it.method == "DELETE" && it.requestUrl!!.encodedPath == "/api/v1/social/blocks/other" })
    }

    @Test fun pushTapOpensNativeInboxWithoutReadingNotifications() {
        dispatch { request -> if (request.path?.startsWith("/api/v1/me/notifications") == true) response("[]") else response("{}") }
        compose.setContent { MungsilTheme { NativeApp(api, 2, me, null, {}, {}, {}, pushUser = "synthetic-user") } }
        waitText("알림")
        compose.waitUntil(15_000) { received.any { it.path?.startsWith("/api/v1/me/notifications") == true } }
        assertFalse(received.any { it.method == "POST" })
    }

    @Test fun changingPushAccountClearsConsentAndOldNotifications() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        kr.kro.mungsil.push.Push.clear(context)
        kr.kro.mungsil.push.Push.bind(context, "first-account")
        context.getSharedPreferences("push", android.content.Context.MODE_PRIVATE).edit().putBoolean("enabled", true).commit()
        kr.kro.mungsil.push.Push.bind(context, "second-account")
        assertEquals("second-account", kr.kro.mungsil.push.Push.user(context))
        assertFalse(kr.kro.mungsil.push.Push.enabled(context))
        kr.kro.mungsil.push.Push.show(context, "first-account", "old-event")
        assertTrue(context.getSystemService(android.app.NotificationManager::class.java).activeNotifications.isEmpty())
        kr.kro.mungsil.push.Push.clear(context)
    }

    @Test fun todoFailurePreservesDraftAndRetryIdentityThenCompletesAndPublishes() {
        val creates = AtomicInteger(0)
        var created = false
        var completed = false
        dispatch { request ->
            val path = request.requestUrl!!.encodedPath
            when {
                path == "/api/v1/todos" && request.method == "POST" -> if(creates.incrementAndGet() == 1) response("{}", 503) else { created = true; response(todo) }
                path.endsWith("/complete") -> { completed = true; response("{\"todo\":${todo.replace("\"completedAt\":null", "\"completedAt\":\"2026-09-22T04:00:00Z\"")}}") }
                path == "/api/v1/todos" -> response(if(created) "[${if(completed) todo.replace("\"completedAt\":null", "\"completedAt\":\"2026-09-22T04:00:00Z\"") else todo}]" else "[]")
                path == "/api/v1/feed/posts" -> response("{\"id\":\"post-1\"}")
                else -> response("[]")
            }
        }
        compose.setContent { MungsilTheme { NativeApp(api, 2, me, null, {}, {}, {}) } }
        waitText("오늘은 아직 담긴 실천이 없어요")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("TODO 추가"))
        compose.onNodeWithText("TODO 추가").performScrollTo().performClick()
        compose.onNodeWithContentDescription("할 일").performTextInput("점심 산책 10분")
        // Invoke the same accessibility action after scrolling: IME inset animation can
        // move a coordinate tap outside the sheet between scroll and injection.
        compose.onNode(hasText("저장") and hasClickAction()).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        waitText("저장 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        compose.onNodeWithText("점심 산책 10분", useUnmergedTree = true).assertExists()
        screenshot("todo-failure-draft")
        compose.onNode(hasText("저장 결과 확인") and hasClickAction()).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(15_000) { received.count { it.method == "POST" && it.requestUrl!!.encodedPath == "/api/v1/todos" } == 2 }
        val writes = received.filter { it.method == "POST" && it.requestUrl!!.encodedPath == "/api/v1/todos" }
        assertEquals(writes[0].getHeader("Idempotency-Key"), writes[1].getHeader("Idempotency-Key"))
        waitText("점심 산책 10분")
        compose.onNodeWithText("이 실천 완료하기").performScrollTo().performClick()
        waitText("실천 게시하기")
        compose.onNodeWithContentDescription("오늘의 한마디").performTextInput("작은 실천을 마쳤어요")
        // Submit through the accessibility action after scrolling: hiding Gboard
        // can move the button while a coordinate tap is being injected.
        compose.onNode(hasText("피드에 게시하기") and hasClickAction()).performScrollTo().assertIsEnabled().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(15_000) { received.any { it.method == "POST" && it.requestUrl!!.encodedPath == "/api/v1/feed/posts" } }
        assertTrue(received.first { it.method == "POST" && it.requestUrl!!.encodedPath == "/api/v1/feed/posts" }.body.readUtf8().contains("작은 실천을 마쳤어요"))
        screenshot("today-native")
    }

    @Test fun todayDistinguishesFirstFailureFromEmptyAndKeepsSummaryAfterRefreshFailure() {
        val gate = java.util.concurrent.CountDownLatch(1)
        val reads = AtomicInteger(0)
        val a = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply { addProperty("id","a"); addProperty("title","먼저 할 일") }
        val b = a.deepCopy().apply { addProperty("id","b"); addProperty("title","다음 할 일"); addProperty("dueDate","2026-09-22T04:00:00Z") }
        val done = a.deepCopy().apply { addProperty("id","done"); addProperty("title","마친 할 일"); addProperty("completedAt","2026-09-22T02:00:00Z") }
        dispatch { request -> if(request.requestUrl!!.encodedPath == "/api/v1/todos") when(reads.incrementAndGet()) {
            1 -> { check(gate.await(10, java.util.concurrent.TimeUnit.SECONDS)); response("{}",503) }
            2 -> response("[$b,$done,$a]")
            else -> response("{}",503)
        } else response("[]") }
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides me.text("id")) {
            TodosScreen(api,ZoneId.of("Asia/Seoul"),true,0,{}, {},clock = java.time.Clock.fixed(java.time.Instant.parse("2026-09-22T00:00:00Z"),java.time.ZoneOffset.UTC))
        } } }
        try {
            waitText("할 일을 불러오고 있어요.")
            compose.onNodeWithText("0 / 0 완료").assertDoesNotExist()
            compose.onNodeWithText("오늘은 아직 담긴 실천이 없어요").assertDoesNotExist()
        } finally { gate.countDown() }
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("오늘 담은 실천을 모두 마쳤어요.").assertDoesNotExist()
        compose.onNodeWithText("다시 시도").performScrollTo().performClick()
        waitText("1 / 3 완료")
        compose.onNodeWithText("먼저 할 일").performScrollTo().assertExists()
        assertEquals(1,compose.onAllNodesWithText("먼저 할 일").fetchSemanticsNodes().size)
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("새로고침"))
        compose.onNodeWithText("새로고침").performScrollTo().performClick()
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        compose.waitUntil(10_000) { compose.onAllNodesWithText("마지막으로 확인한 목록이에요.", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("1 / 3 완료"))
        compose.onNodeWithText("1 / 3 완료").assertExists()
        compose.onNodeWithText("오늘은 아직 담긴 실천이 없어요").assertDoesNotExist()
        compose.onNodeWithText("이 실천 완료하기").performScrollTo().assertIsNotEnabled()
        assertFalse(received.any { it.method != "GET" })
    }

    @Test fun accountContextChangeDoesNotDisplayPreviousAccountsTodayRows() {
        val gate = java.util.concurrent.CountDownLatch(1)
        val reads = AtomicInteger(0)
        val a = com.google.gson.JsonParser.parseString(todo).asJsonObject.apply { addProperty("title","A 계정의 비공개 실천") }
        val b = a.deepCopy().apply { addProperty("id","b"); addProperty("title","B 계정의 실천") }
        dispatch { request -> if(request.requestUrl!!.encodedPath == "/api/v1/todos") {
            if(reads.incrementAndGet() == 1) response("[$a]")
            else { check(gate.await(10,java.util.concurrent.TimeUnit.SECONDS)); response("[$b]") }
        } else response("[]") }
        var owner by mutableStateOf("account-a")
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides owner) {
            TodosScreen(api,ZoneId.of("Asia/Seoul"),true,0,{}, {})
        } } }
        waitText("A 계정의 비공개 실천")
        compose.runOnIdle { owner = "account-b" }
        try {
            waitText("할 일을 불러오고 있어요.")
            compose.onNodeWithText("A 계정의 비공개 실천").assertDoesNotExist()
        } finally { gate.countDown() }
        waitText("B 계정의 실천")
        compose.onNodeWithText("A 계정의 비공개 실천").assertDoesNotExist()
    }

    @Test fun todayDateChangeKeepsOpenDraftsOriginalDateAndText() {
        dispatch { response("[]") }
        var clock by mutableStateOf<java.time.Clock>(java.time.Clock.fixed(java.time.Instant.parse("2026-09-22T14:59:59Z"),java.time.ZoneOffset.UTC))
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides me.text("id")) {
            TodosScreen(api,ZoneId.of("Asia/Seoul"),true,0,{}, {},clock = clock)
        } } }
        waitText("오늘은 아직 담긴 실천이 없어요")
        compose.onNodeWithText("TODO 추가").performScrollTo().performClick()
        compose.onNodeWithContentDescription("할 일").performTextInput("자정을 넘어도 남을 초안")
        compose.runOnIdle { clock = java.time.Clock.fixed(java.time.Instant.parse("2026-09-22T15:00:01Z"),java.time.ZoneOffset.UTC) }
        compose.onNodeWithContentDescription("할 일").assertTextEquals("자정을 넘어도 남을 초안")
        compose.onNodeWithText("날짜 · 2026-09-22").assertExists()
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.queryParameter("from") == "2026-09-22T15:00:00Z" } }
        assertFalse(received.any { it.method != "GET" })
    }

    @Test fun completionRollbackKeepsRetryKeyButNewCompletionUsesNewKey() {
        val completions = AtomicInteger(0)
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/complete") -> if(completions.incrementAndGet() == 1) response("{}", 503) else response("{\"todo\":${todo.replace("\"completedAt\":null", "\"completedAt\":\"2026-09-22T04:00:00Z\"")}}")
            request.requestUrl!!.encodedPath.endsWith("/uncomplete") -> response(todo)
            request.requestUrl!!.encodedPath == "/api/v1/todos" -> response("[$todo]")
            else -> response("[]")
        } }
        compose.setContent { MungsilTheme { TodosScreen(api, ZoneId.of("Asia/Seoul"), false, 0, {}, {}) } }
        waitText("점심 산책 10분")
        fun toggle() { compose.onAllNodes(isToggleable()).onFirst().performScrollTo().performClick() }
        toggle()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onAllNodes(isToggleable()).onFirst().assertIsOff()
        toggle()
        waitText("실천 게시하기")
        compose.onNodeWithContentDescription("닫기").performClick()
        toggle()
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.encodedPath.endsWith("/uncomplete") } }
        compose.waitUntil(10_000) { compose.onAllNodes(isToggleable() and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        toggle()
        waitText("실천 게시하기")
        val writes = received.filter { it.requestUrl!!.encodedPath.endsWith("/complete") }
        assertEquals(3, writes.size)
        assertEquals(writes[0].getHeader("Idempotency-Key"), writes[1].getHeader("Idempotency-Key"))
        assertNotEquals(writes[1].getHeader("Idempotency-Key"), writes[2].getHeader("Idempotency-Key"))
    }

    @Test fun commentFailureKeepsDraftAndOlderPagesDoNotDuplicate() {
        val writes = AtomicInteger(0)
        val post = """{"id":"post-1","author":{"id":"other","nickname":"함께 구름","handle":"cloud"},"caption":"산책 기록","todos":[$todo],"cheerCount":2,"commentCount":2,"cheered":false}"""
        val comment = """{"id":"comment-1","author":{"id":"other","nickname":"응원 구름"},"body":"함께해요"}"""
        dispatch { request -> when {
            request.method == "POST" -> if(writes.incrementAndGet()==1) response("{}",503) else response("{}")
            request.requestUrl!!.encodedPath.endsWith("/comments") -> response("""{"items":[$comment],"nextCursor":${if(request.requestUrl!!.queryParameter("cursor") == null) "\"next\"" else "null"}}""")
            else -> response(post)
        } }
        compose.setContent { var revision by remember { mutableIntStateOf(0) }; MungsilTheme { PostScreen(api, "post-1", true, me, ZoneId.of("Asia/Seoul"), revision, { revision++ }, {}, {}) } }
        waitText("산책 기록")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("더 보기"))
        compose.onNodeWithText("더 보기").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.queryParameter("cursor") == "next" } }
        compose.onAllNodesWithText("함께해요").assertCountEquals(1)
        compose.onNodeWithContentDescription("응원 댓글").performScrollTo().performTextInput("좋은 실천이에요")
        compose.onNodeWithText("댓글 남기기").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("좋은 실천이에요").assertExists()
        compose.onNodeWithText("댓글 남기기").performScrollTo().performClick()
        compose.waitUntil(10_000) { writes.get()==2 }
        val requests = received.filter { it.method == "POST" }
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
    }

    @Test fun cheerRetryKeepsKeyAndNextSuccessfulActionUsesNewKey() {
        val writes = AtomicInteger(0)
        dispatch { request -> when {
            request.method == "POST" -> when(writes.incrementAndGet()) { 1 -> response("{}", 503); 2 -> response("""{"cheered":true}"""); else -> response("""{"cheered":false}""") }
            request.requestUrl!!.encodedPath.endsWith("/comments") -> response("""{"items":[],"nextCursor":null}""")
            else -> response("""{"id":"post-1","author":{"id":"other","handle":"cloud","nickname":"함께 구름"},"caption":"응원할 기록","todos":[],"cheerCount":2,"cheered":false}""")
        } }
        compose.setContent { MungsilTheme { PostScreen(api, "post-1", true, me, ZoneId.of("Asia/Seoul"), 0, {}, {}, {}) } }
        waitText("응원할 기록")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("♡ 응원 2"))
        compose.onNodeWithText("♡ 응원 2").performClick()
        waitText("응원 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        compose.onNodeWithText("응원 결과 확인").performScrollTo().performClick()
        waitText("♥ 응원 취소 3")
        compose.onNodeWithText("♥ 응원 취소 3").performScrollTo().performClick()
        waitText("♡ 응원 2")
        val requests = received.filter { it.method == "POST" }
        assertEquals(3, requests.size)
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
        assertNotEquals(requests[1].getHeader("Idempotency-Key"), requests[2].getHeader("Idempotency-Key"))
    }

    @Test fun feedAndDetailConfirmTheSameUncertainCheerRequest() {
        val writes = AtomicInteger(0)
        val post = json("id" to "post-1","author" to json("id" to "other","nickname" to "함께 구름","handle" to "cloud"),
            "caption" to "이어 확인할 응원","todos" to emptyList<String>(),"cheered" to false,"cheerCount" to 2,"commentCount" to 0)
        dispatch { request -> when {
            request.method == "POST" -> if(writes.incrementAndGet() == 1) response("{}",503) else response("{\"cheered\":true}")
            request.requestUrl!!.encodedPath.endsWith("/comments") -> response("{\"items\":[],\"nextCursor\":null}")
            else -> response(post.toString())
        } }
        compose.setContent {
            var detail by remember { mutableStateOf(false) }
            val store = rememberCheerStore(me.text("id"),api.sessionVersion)
            MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides me.text("id"),LocalCheerStore provides store) {
                if(detail) PostScreen(api,"post-1",true,me,ZoneId.of("Asia/Seoul"),0,{},{},{})
                else PageList { item { InteractiveFeedCard(api,post,true,ZoneId.of("Asia/Seoul"),{ detail = true },{}) } }
            } }
        }
        compose.onNodeWithText("♡ 응원 2").performScrollTo().performClick()
        waitText("응원 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        compose.onNodeWithText("댓글 0").performScrollTo().performClick()
        waitText("응원 결과 확인")
        assertEquals(1,writes.get())
        compose.onNodeWithText("응원 결과 확인").performScrollTo().performClick()
        waitText("♥ 응원 취소 3")
        val requests = received.filter { it.method == "POST" }
        assertEquals(2,requests.size)
        assertEquals(requests[0].getHeader("Idempotency-Key"),requests[1].getHeader("Idempotency-Key"))
    }

    @Test fun routineAccountChangeCannotRestorePreviousOwnersEdits() {
        dispatch { response("{}") }
        val source = json("id" to "public-routine","title" to "원본 루틴","items" to listOf(json("todo" to json(
            "id" to "item","title" to "원본 산책","category" to "건강","dueDate" to "2026-10-23T01:00:00Z"))))
        var owner by mutableStateOf("account-a")
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides owner) {
            RoutineImportSheet(api,ZoneId.of("Asia/Seoul"),source,{},{})
        } } }
        compose.onNodeWithContentDescription("루틴 이름").performScrollTo().performTextReplacement("A 계정의 초안")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("루틴 이름").assertTextEquals("A 계정의 초안")
        compose.runOnIdle { owner = "account-b" }
        compose.onNodeWithContentDescription("루틴 이름").assertTextEquals("원본 루틴")
        assertTrue(received.isEmpty())
    }

    @Test fun challengeTextEditPreservesOriginalScheduleAndRewardFields() {
        dispatch { response("{}") }
        val source = json("id" to "challenge-edit", "title" to "점심 산책", "description" to "점심마다 가까운 공원을 함께 걸어요.", "startsAt" to "2026-09-22T04:34:56Z", "endsAt" to "2026-10-22T06:23:45Z", "verificationMode" to "CHECK", "completionThreshold" to 80, "rewardLabel" to "기존 보상", "rewardTerms" to "기존 조건")
        var closed by mutableStateOf(false)
        compose.setContent { MungsilTheme { if(!closed) ChallengeComposer(api, source, { closed = true }, {}) else androidx.compose.material3.Text("챌린지 저장 완료") } }
        compose.onNodeWithContentDescription("함께할 약속").performTextClearance()
        compose.onNodeWithContentDescription("함께할 약속").performTextInput("점심마다 가까운 공원을 10분 함께 걸어요.")
        compose.onNodeWithText("변경 내용 저장").performScrollTo().performClick()
        waitText("챌린지 저장 완료")
        val request = received.single()
        assertEquals("PATCH", request.method)
        val payload = com.google.gson.JsonParser.parseString(request.body.readUtf8()).asJsonObject
        assertFalse(payload.has("startsAt")); assertFalse(payload.has("endsAt"))
        assertFalse(payload.has("rewardLabel")); assertFalse(payload.has("rewardTerms"))
        assertEquals("점심마다 가까운 공원을 10분 함께 걸어요.", payload.text("description"))
    }

    @Test fun verificationMovesOneCriterionAtATimeAndPreservesFailedVote() {
        val votes = AtomicInteger(0)
        val bitmap = android.graphics.Bitmap.createBitmap(8, 6, android.graphics.Bitmap.Config.ARGB_8888)
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val imageUrl = server.url("/verification.png").toString()
        dispatch { request -> if(request.requestUrl!!.encodedPath == "/verification.png") MockResponse().setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(bytes)) else if(request.method == "POST") {
            if(votes.incrementAndGet() == 1) response("{}", 503) else response("{}")
        } else response(if(votes.get() < 2) """{"contributionCount":2,"items":[{"checkInId":"check-1","attempt":1,"challenge":{"id":"challenge-1","title":"산책 챌린지"},"criteria":["걸음을 기록했나요?","주제에 맞는 실천인가요?"],"mediaUrl":"$imageUrl"}]}""" else """{"contributionCount":3,"items":[]}""") }
        compose.setContent { MungsilTheme { VerificationSheet(api, "challenge-1", {}) } }
        waitText("1/2 · 걸음을 기록했나요?")
        compose.onNodeWithText("2/2 · 주제에 맞는 실천인가요?").assertDoesNotExist()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("확인돼요").fetchSemanticsNodes().any { !it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled) } }
        compose.onNodeWithText("확인돼요").performScrollTo().performClick()
        compose.onNodeWithText("다음 기준").performScrollTo().performClick()
        waitText("2/2 · 주제에 맞는 실천인가요?")
        compose.onNodeWithText("확인되지 않아요").performScrollTo().performClick()
        compose.onNodeWithText("익명으로 의견 보내기").performScrollTo().performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("선택 · 확인되지 않아요").assertExists()
        compose.onNodeWithText("익명으로 의견 보내기").performScrollTo().performClick()
        waitText("지금 확인할 사진이 없어요")
        val requests = received.filter { it.method == "POST" }
        assertEquals(2, requests.size)
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
        val payload = requests[1].body.readUtf8()
        assertTrue(payload.contains("MET")); assertTrue(payload.contains("NOT_MET"))
        screenshot("challenge-verification")
    }

    @Test fun loginStaysNativeAndAllFiveTabsRenderAtDeviceWidth() {
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/config") -> response("{\"inviteRequired\":false}")
            request.requestUrl!!.encodedPath.endsWith("/feed") -> response("{\"items\":[],\"nextCursor\":null}")
            else -> response("[]")
        } }
        compose.setContent { MungsilTheme { NativeApp(api, 1, json(), null, {}, {}, {}) } }
        compose.onNodeWithText("무료로 시작하기").performScrollTo().performClick()
        compose.onNodeWithText("오늘의 뭉실을\n이어가 볼까요?").assertExists()
        screenshot("login-native")
        compose.onNodeWithText("먼저 둘러보기").performScrollTo().performClick()
        listOf("오늘", "탐색", "TODO", "챌린지", "마이").forEach { label -> compose.onNode(hasText(label) and hasClickAction()).assertExists().performClick() }
        compose.onNodeWithText("나의 실천을 시작해볼까요?").assertExists()
        screenshot("five-tabs-native")
    }

    @Test fun chatSendFailureKeepsDraftAndReadDoesNotRunBeforeRoomLoaded() {
        val writes = AtomicInteger(0)
        val message = """{"id":"m1","kind":"USER","sender":{"nickname":"구름"},"body":"함께 실천해요","createdAt":"2026-09-22T01:00:00Z","media":[],"reactions":[],"isMine":false,"canDelete":false}"""
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/messages") && request.method == "POST" -> { writes.incrementAndGet(); response("{}",503) }
            request.method == "POST" -> response("{}")
            else -> response("""{"room":{"conversationId":"room-1","canSend":true,"otherUser":{"nickname":"친구 구름"}},"items":[$message],"nextCursor":null}""")
        } }
        compose.setContent { MungsilTheme { ChatScreen(api, "direct/room-1") } }
        compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("메시지").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("메시지").performTextInput("실패해도 남는 초안")
        compose.onNodeWithText("전송").performClick()
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("실패해도 남는 초안").assertExists()
        assertEquals(1, writes.get())
        screenshot("chat-failure-native")
    }

    @Test fun importingPreservesComplexRepeatUntilUserExplicitlyChangesIt() {
        val source = todo.replace("\"completedAt\":null", "\"completedAt\":null,\"repeatRule\":\"FREQ=WEEKLY;BYDAY=MO,WE,FR\"")
        dispatch { request -> when {
            request.method == "POST" -> response(source)
            request.requestUrl!!.encodedPath.endsWith("/todo-categories") -> response("[]")
            request.requestUrl!!.encodedPath.endsWith("/comments") -> response("{\"items\":[],\"nextCursor\":null}")
            else -> response("""{"id":"post-1","author":{"id":"other","nickname":"함께 구름","handle":"cloud"},"caption":"좋은 습관을 나눠요","todos":[$source],"cheerCount":0,"commentCount":0}""")
        } }
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides me.text("id")) { PostScreen(api, "post-1", true, me, ZoneId.of("Asia/Seoul"), 0, {}, {}, {}) } } }
        waitText("점심 산책 10분 · 나도 할래요")
        screenshot("post-native")
        compose.onNodeWithText("점심 산책 10분 · 나도 할래요").performScrollTo().performClick()
        compose.onNodeWithText("원본 반복 유지").performScrollTo().assertExists()
        compose.onNodeWithText("가져오기", useUnmergedTree = true).performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.requestUrl!!.encodedPath.endsWith("/clone") } }
        val body = received.first { it.requestUrl!!.encodedPath.endsWith("/clone") }.body.readUtf8()
        assertTrue(body.contains("FREQ=WEEKLY;BYDAY=MO,WE,FR")); assertTrue(body.contains("\"visibility\":\"PRIVATE\""))
    }

    @Test fun notificationsAreReadOnlyUntilExplicitAction() {
        dispatch { request -> if(request.method == "POST") response("{}") else response("""{"items":[{"id":"n1","title":"새 응원이 도착했어요","body":"좋아요","readAt":null}],"nextCursor":null}""").setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS) }
        compose.setContent { MungsilTheme { NotificationsScreen(api, 0, {}, {}) } }
        waitText("새 소식 · 새 응원이 도착했어요")
        assertFalse(received.any { it.method == "POST" })
        compose.onNodeWithText("읽음 표시").performScrollTo().performClick()
        compose.waitUntil(10_000) { received.any { it.method == "POST" } }
        assertEquals("/api/v1/me/notifications/n1/read", received.first { it.method == "POST" }.requestUrl!!.encodedPath)
    }

    @Test fun blockedConversationRetainsHistoryAndDisablesComposer() {
        dispatch { request -> if(request.method == "POST") response("{}") else response("""{"room":{"canSend":false,"blocked":true,"otherUser":{"nickname":"구름"}},"items":[{"id":"m1","body":"보존된 이전 대화","kind":"USER","createdAt":"2026-09-22T01:00:00Z"}],"nextCursor":null}""").setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS) }
        compose.setContent { MungsilTheme { ChatScreen(api, "direct/room-1") } }
        waitText("보존된 이전 대화")
        compose.onNodeWithText("전송").assertDoesNotExist()
        compose.onNodeWithContentDescription("메시지").assertDoesNotExist()
        screenshot("blocked-chat-native")
    }
}
