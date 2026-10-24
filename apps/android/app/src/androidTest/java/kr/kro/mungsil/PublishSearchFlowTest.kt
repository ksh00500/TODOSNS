package kr.kro.mungsil

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material3.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonParser
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic picker callbacks test drafts and gating, not Android photo selection or S3. */
class PublishSearchFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val received = CopyOnWriteArrayList<RecordedRequest>()
    private fun response(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        context.getSharedPreferences("search", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        server = MockWebServer(); server.start()
        api = Api(server.url("/api/v1/").toString(), object: SessionStore { override fun read(): String? = null; override fun write(value: String?) {} })
    }
    @After fun teardown() { server.shutdown() }
    private fun dispatch(answer: (RecordedRequest) -> MockResponse) { server.dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse { received += request; return answer(request) }
    } }
    private fun waitText(text: String) = compose.waitUntil(15_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    private fun click(text: String) {
        val matcher = hasText(text) and hasClickAction()
        if(compose.onAllNodes(matcher).fetchSemanticsNodes().isEmpty()) compose.onNode(hasScrollToIndexAction()).performScrollToNode(matcher)
        compose.onNode(matcher).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
    }
    private fun screenshot(name: String) {
        compose.waitForIdle(); Thread.sleep(300)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val label = InstrumentationRegistry.getArguments().getString("screenshotLabel") ?: "360"
        val folder = File(context.getExternalFilesDir(null), "native-verification/$label").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(folder, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun publicationKeepsFailedPhotoDraftAndRequestIdentityAcrossRestore() {
        val attempts = AtomicInteger(0); val uploads = AtomicInteger(0)
        dispatch { if(attempts.incrementAndGet() <= 2) response("{}", 503) else response("{\"id\":\"published\"}").setBodyDelay(1, TimeUnit.SECONDS) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            var open by rememberSaveable { mutableStateOf(true) }
            MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "account-a") { if(open) PublishSheet(api, json("id" to "todo", "title" to "산책을 마쳤어요"), { open = false }, {}, photoPicker = { _, media, update, enabled, pending, draft ->
                val selected = draft.selectedUri != null
                if(media == null) {
                    TextButton({ draft.selectedUri = "synthetic-selected-photo"; update(null); pending(true) }, enabled = enabled) { Text("사진 첨부 실패 재현") }
                    if(selected) {
                        Text("사진 업로드에 실패했어요. 다시 시도하거나 제외해주세요.")
                        TextButton({ uploads.incrementAndGet(); update("synthetic-media"); pending(false) }, enabled = enabled) { Text("사진 업로드 다시 시도") }
                    }
                } else Text("사진 첨부 완료")
                if(selected || media != null) TextButton({ draft.selectedUri = null; update(null); pending(false) }, enabled = enabled) { Text("사진 제외") }
            }) else Text("게시 완료") } }
        }
        waitText("실천 게시하기")
        compose.onNodeWithContentDescription("오늘의 한마디").performScrollTo().performTextInput("작은 실천을 오래 이어가요")
        compose.onNodeWithContentDescription("해시태그 입력").performScrollTo().performTextInput("#ＡＢＣ_산책")
        compose.onNodeWithContentDescription("해시태그 입력").performImeAction()
        click("팔로워")
        click("사진 첨부 실패 재현")
        compose.onNodeWithText("피드에 게시하기").performScrollTo().assertIsNotEnabled()
        assertTrue(received.isEmpty())
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("피드에 게시하기").performScrollTo().assertIsNotEnabled()
        screenshot("publish-pending-restored")
        click("사진 업로드 다시 시도")
        click("피드에 게시하기")
        waitText("게시 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("오늘의 한마디").assertTextContains("작은 실천을 오래 이어가요")
        compose.onNodeWithContentDescription("abc_산책 해시태그 삭제").assertExists()
        compose.onNode(hasText("팔로워") and hasClickAction()).assertIsSelected()
        compose.onNodeWithContentDescription("오늘의 한마디").assertIsNotEnabled()
        compose.onNode(hasText("팔로워") and hasClickAction()).assertIsNotEnabled()
        click("게시 결과 확인")
        waitText("게시 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        assertEquals(1, uploads.get())
        val first = received[0]; val second = received[1]
        assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
        assertEquals(first.body.clone().readUtf8(), second.body.clone().readUtf8())
        assertEquals("synthetic-media", JsonParser.parseString(first.body.clone().readUtf8()).asJsonObject.text("mediaId"))
        click("게시 결과 확인")
        waitText("게시 중…")
        compose.onNodeWithContentDescription("오늘의 한마디").assertIsNotEnabled()
        compose.onNodeWithContentDescription("해시태그 입력").assertIsNotEnabled()
        compose.onNode(hasText("팔로워") and hasClickAction()).assertIsNotEnabled()
        waitText("게시 완료")
        assertEquals(3, received.size)
        val confirmed = received[2]
        assertEquals(first.getHeader("Idempotency-Key"), confirmed.getHeader("Idempotency-Key"))
        assertEquals(first.body.clone().readUtf8(), confirmed.body.clone().readUtf8())
        val payload = JsonParser.parseString(confirmed.body.clone().readUtf8()).asJsonObject
        assertEquals("synthetic-media", payload.text("mediaId")); assertEquals(listOf("abc_산책"), payload.strings("hashtags")); assertEquals("FOLLOWERS", payload.text("visibility"))

    }
    @Test fun onlyVisibilityChangeNeedsDiscardConfirmationAndTagErrorsStayInline() {
        dispatch { response("{}") }
        var closed = false
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "account-a") { PublishSheet(api, json("id" to "group", "title" to "작은 루틴"), { closed = true }, {}, group = true) } } }
        waitText("실천 게시하기")
        click("나만 보기")
        compose.onNodeWithContentDescription("닫기").performClick()
        waitText("작성을 그만둘까요?"); assertFalse(closed)
        compose.onAllNodesWithContentDescription("닫기").onLast().performClick()
        compose.onNodeWithContentDescription("해시태그 입력").performScrollTo().performTextInput("두 단어")
        compose.onNodeWithContentDescription("해시태그 입력").performImeAction()
        waitText("해시태그는 글자, 숫자, 밑줄만 사용할 수 있어요.")
        compose.onNodeWithContentDescription("해시태그 입력").assertTextContains("두 단어")
        compose.onNodeWithContentDescription("해시태그 입력").performTextReplacement("#독서,")
        compose.onNodeWithContentDescription("독서 해시태그 삭제").assertExists()
        compose.onNodeWithContentDescription("닫기").performClick()
        waitText("작성을 그만둘까요?")
        click("작성 내용 버리기")
        assertTrue(closed); assertTrue(received.isEmpty())
    }
    @Test fun publicationAccountChangeClearsPreviousCaptionAndVisibility() {
        dispatch { response("{}") }
        var owner by mutableStateOf("account-a")
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides owner) {
            PublishSheet(api, json("id" to "source", "title" to "작은 실천"), {}, {})
        } } }
        compose.onNodeWithContentDescription("오늘의 한마디").performScrollTo().performTextInput("A 계정의 비공개 초안")
        click("팔로워")
        compose.runOnIdle { owner = "account-b" }
        compose.onNodeWithContentDescription("오늘의 한마디").performScrollTo().assert(SemanticsMatcher.expectValue(
            androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
        compose.onNodeWithText("A 계정의 비공개 초안", useUnmergedTree = true).assertDoesNotExist()
        click("전체 공개")
        compose.onNode(hasText("전체 공개") and hasClickAction()).assertIsSelected()
        assertTrue(received.isEmpty())
    }
    @Test fun closingUncertainPublicationWarnsAndNeverUndoesTheCompletedTodo() {
        dispatch { response("{}",503) }
        var closed = false
        val todo = json("id" to "source", "title" to "마친 실천", "completedAt" to "2026-10-23T01:00:00Z", "visibility" to "PRIVATE")
        compose.setContent { MungsilTheme { CompositionLocalProvider(LocalTodoDraftOwner provides "account-a") {
            PublishSheet(api, todo, { closed = true }, {})
        } } }
        click("피드에 게시하기")
        waitText("게시 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요.")
        compose.onNodeWithContentDescription("닫기").performClick()
        waitText("게시 요청이 이미 반영됐을 수 있어요. 닫아도 게시는 취소되지 않아요. 마이의 게시 기록을 확인해주세요.")
        click("작성 내용 버리기")
        assertTrue(closed)
        assertEquals("2026-10-23T01:00:00Z",todo.text("completedAt")); assertEquals("PRIVATE",todo.text("visibility"))
        assertEquals(1,received.size); assertEquals("POST",received.single().method)
        assertEquals("/api/v1/feed/posts",received.single().requestUrl!!.encodedPath)
    }
    @Test fun actualPhotoPickerClearsFailedUploadAfterExclusionAndAllowsNewSelection() {
        dispatch { response("{}", 503) }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "camera").apply { mkdirs() }
        val file = File.createTempFile("synthetic-photo-", ".jpg", directory)
        val bitmap = android.graphics.Bitmap.createBitmap(8, 16, android.graphics.Bitmap.Config.ARGB_8888)
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it) }; bitmap.recycle()
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
        try {
            compose.setContent {
                val draft = rememberPhotoDraft()
                var media by rememberSaveable { mutableStateOf<String?>(null) }
                var pending by rememberSaveable { mutableStateOf(false) }
                MungsilTheme { NativeSheet("사진 선택 검사", {}) {
                    TextButton({ draft.selectedUri = uri.toString() }) { Text("합성 사진 선택") }
                    PhotoPicker(api, media, { media = it }, pending = { pending = it }, draft = draft)
                    Text(if(pending) "사진 미완료" else "사진 준비 요청 없음")
                } }
            }
            click("합성 사진 선택")
            waitText("사진 업로드 다시 시도")
            compose.onNodeWithText("사진 미완료").assertExists()
            assertEquals("/api/v1/me/media/presign", received.single().requestUrl!!.encodedPath)
            val payload = JsonParser.parseString(received.single().body.clone().readUtf8()).asJsonObject
            assertEquals("image/jpeg", payload.text("mimeType")); assertEquals(file.length().toInt(), payload.number("size"))
            click("사진 제외")
            compose.onNodeWithText("사진 업로드 다시 시도").assertDoesNotExist()
            compose.onNodeWithText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.").assertDoesNotExist()
            compose.onNodeWithText("사진 준비 요청 없음").assertExists()
            click("합성 사진 선택"); waitText("사진 업로드 다시 시도")
            assertEquals(2, received.size)
        } finally { file.delete() }
    }
    private fun searchResponse(empty: Boolean = false): String {
        val users = if(empty) emptyList() else listOf(json("id" to "person", "nickname" to "산책 구름", "handle" to "walk.cloud", "cloudRank" to "조각구름"))
        fun post(index: Int, routine: Boolean) = json("id" to "${if(routine) "routine" else "post"}-$index", "caption" to "${if(routine) "검색한 루틴" else "검색한 실천"} $index",
            "author" to json("id" to "person", "nickname" to "산책 구름", "handle" to "walk.cloud", "cloudRank" to "조각구름"),
            "todoList" to if(routine) json("id" to "list-$index", "title" to "루틴 $index", "items" to emptyList<String>()) else null,
            "todos" to listOf(json("id" to "todo-$index", "title" to "실천 $index", "category" to "건강")), "hashtags" to emptyList<String>(), "cheerCount" to 0, "commentCount" to 0)
        return json("counts" to json("all" to if(empty) 0 else 10, "users" to if(empty) 0 else 1, "posts" to if(empty) 0 else 4,
            "routines" to if(empty) 0 else 3, "tags" to if(empty) 0 else 1, "challenges" to if(empty) 0 else 1), "users" to users,
            "posts" to if(empty) emptyList() else (1..4).map { post(it, false) }, "routines" to if(empty) emptyList() else (1..3).map { post(it, true) },
            "tags" to if(empty) emptyList() else listOf(json("id" to "tag", "name" to "산책", "postCount" to 4)),
            "challenges" to if(empty) emptyList() else listOf(json("id" to "challenge", "title" to "검색한 챌린지", "description" to "천천히 걷는 하루", "kind" to "COMMUNITY", "_count" to json("participants" to 2)))).toString()
    }
    @Test fun searchTypesRecentQueriesAndRestoredDraftMatchWebFlows() {
        val suggestions = AtomicInteger(0)
        dispatch { request -> if(request.requestUrl!!.encodedPath.endsWith("suggestions")) {
            if(suggestions.incrementAndGet() == 1) response("{}", 503) else response("{\"trendingTags\":[{\"id\":\"tag\",\"name\":\"산책\",\"postCount\":4}]}")
        } else response(searchResponse()) }
        var target = ""
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { SearchScreen(api, false, "", ZoneId.of("Asia/Seoul"), { target = it }, {}) } }
        waitText("서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.")
        compose.onNodeWithText("아직 인기 태그가 없어요").assertDoesNotExist()
        click("다시 시도"); waitText("#산책 · 4개 게시물"); click("#산책 · 4개 게시물")
        waitText("10개의 공개 결과를 찾았어요")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("실천 더보기"))
        click("실천 더보기")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("검색한 실천 4"))
        compose.onNodeWithText("검색한 실천 4").assertExists()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("통합 검색"))
        compose.onNodeWithContentDescription("통합 검색").performTextReplacement("아직 제출하지 않은 검색어")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("통합 검색").assertTextContains("아직 제출하지 않은 검색어")
        waitText("10개의 공개 결과를 찾았어요")
        compose.onNode(hasText("실천 4") and hasClickAction()).assertIsSelected()
        click("사용자 1")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("산책 구름"))
        click("산책 구름"); assertEquals("profile/walk.cloud", target)
        click("루틴 3")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("검색한 루틴 3"))
        compose.onNodeWithText("검색한 루틴 3").assertExists()
        click("챌린지 1")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("커뮤니티 · 2명 참여"))
        waitText("커뮤니티 · 2명 참여"); click("검색한 챌린지"); assertEquals("challenge/challenge", target)
        click("해시태그 1")
        click("#산책 · 4개 공개 게시물")
        compose.onNode(hasText("통합 10") and hasClickAction()).assertIsSelected()
        screenshot("search-results")
        click("검색어 지우기")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("최근 검색"))
        waitText("최근 검색"); click("#산책")
        waitText("10개의 공개 결과를 찾았어요"); click("검색어 지우기")
        click("모두 지우기")
        compose.onNodeWithText("최근 검색").assertDoesNotExist()
        assertNull(InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("search", android.content.Context.MODE_PRIVATE).getString("recent", null))
        assertTrue(received.filter { it.requestUrl!!.encodedPath.endsWith("/search") }.all { !it.requestUrl!!.queryParameter("query").isNullOrBlank() })
    }
    @Test fun malformedSearchShowsRetryWhileValidEmptyResultShowsEmptyState() {
        val searches = AtomicInteger(0)
        dispatch { request -> if(request.requestUrl!!.encodedPath.endsWith("suggestions")) response("{\"trendingTags\":[]}") else {
            if(searches.incrementAndGet() == 1) response("{\"counts\":{\"all\":0}}") else response(searchResponse(true))
        } }
        compose.setContent { MungsilTheme { SearchScreen(api, false, "찾는 단어", ZoneId.of("Asia/Seoul"), {}, {}) } }
        waitText("검색 응답을 확인하지 못했어요. 다시 불러와주세요.")
        compose.onNodeWithText("검색 결과가 없어요").assertDoesNotExist()
        click("다시 시도")
        waitText("검색 결과가 없어요")
        assertEquals(2, searches.get())
    }
}
