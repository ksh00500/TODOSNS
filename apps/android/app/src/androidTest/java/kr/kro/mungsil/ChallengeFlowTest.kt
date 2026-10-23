package kr.kro.mungsil

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Loopback accounts, photos and picker callbacks only; never a live challenge. */
class ChallengeFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val received = CopyOnWriteArrayList<RecordedRequest>()
    private val failure = "서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요."
    private fun response(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        androidx.work.WorkManager.getInstance(context).cancelAllWork().result.get()
        com.google.firebase.FirebaseApp.getApps(context).forEach { it.delete() }
        coil.Coil.setImageLoader(coil.ImageLoader.Builder(context).networkObserverEnabled(false).okHttpClient(okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            check(chain.request().url.host in listOf("localhost", "127.0.0.1")) { "Only loopback images in tests" }; chain.proceed(chain.request())
        }.build()).build())
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
    private fun waitEnabled(text: String) {
        compose.onNodeWithText(text).performScrollTo()
        compose.waitUntil(15_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().any { !it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled) } }
    }
    private fun photoBytes(): ByteArray {
        val bitmap = android.graphics.Bitmap.createBitmap(16, 9, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(195, 236, 233)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle(); return bytes
    }
    private fun queue(attempt: Int = 1, criteria: List<String> = listOf("걸음이 확인되나요?", "주제에 맞는 실천인가요?")) = json("contributionCount" to 2,
        "items" to listOf(json("checkInId" to "check", "attempt" to attempt, "challenge" to json("id" to "challenge", "title" to "산책 챌린지"),
            "criteria" to criteria, "mediaUrl" to server.url("/photo.png").toString()))).toString()
    private fun screenshot(name: String) {
        compose.waitForIdle(); Thread.sleep(250)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val label = InstrumentationRegistry.getArguments().getString("screenshotLabel") ?: "challenge"
        val folder = File(context.getExternalFilesDir(null), "native-verification/$label").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("No screenshot")
        File(folder, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    }
    @Test fun resubmissionNeedsPhotoAndRestoresDraftAndFailedRequestKey() {
        val attempts = AtomicInteger(0)
        dispatch { if(attempts.incrementAndGet() <= 2) response("{}", 503) else response("{}").setBodyDelay(1, TimeUnit.SECONDS) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            var open by rememberSaveable { mutableStateOf(true) }
            MungsilTheme { if(open) ChallengeCheckInSheet(api, "challenge", false, "rejected-check", { open = false }, {}, photoPicker = { _, media, update, enabled, pending, draft ->
                TextButton({ draft.selectedUri = "synthetic-photo"; update(null); pending(true) }, enabled = enabled) { Text("합성 사진 실패") }
                if(draft.selectedUri != null && media == null) TextButton({ update("photo-media"); pending(false) }, enabled = enabled) { Text("합성 사진 완료") }
                if(media != null) Text("사진 첨부 완료")
                TextButton({ draft.selectedUri = null; update(null); pending(false) }, enabled = enabled) { Text("사진 제외") }
            }) else Text("인증 요청 완료") }
        }
        waitText("새 사진으로 다시 인증")
        compose.onNodeWithText("새 사진으로 다시 요청").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithContentDescription("오늘의 한마디 (선택)").performScrollTo().performTextInput("  다시 찍은 실천 사진이에요  ")
        click("합성 사진 실패")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("새 사진으로 다시 요청").performScrollTo().assertIsNotEnabled(); assertTrue(received.isEmpty())
        click("합성 사진 완료"); click("새 사진으로 다시 요청"); waitText(failure)
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("오늘의 한마디 (선택)").assertTextContains("  다시 찍은 실천 사진이에요  ")
        click("새 사진으로 다시 요청"); waitText(failure)
        val first = received[0]; val second = received[1]
        assertEquals("/api/v1/challenge-verifications/check-ins/rejected-check/resubmit", first.requestUrl!!.encodedPath)
        assertEquals(first.body.clone().readUtf8(), second.body.clone().readUtf8())
        assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
        assertEquals("다시 찍은 실천 사진이에요", JsonParser.parseString(first.body.clone().readUtf8()).asJsonObject.text("note"))
        compose.onNodeWithContentDescription("오늘의 한마디 (선택)").performScrollTo().performTextReplacement("새 설명을 덧붙였어요")
        click("새 사진으로 다시 요청"); waitText("인증하는 중…")
        compose.onNodeWithContentDescription("오늘의 한마디 (선택)").assertIsNotEnabled()
        waitText("인증 요청 완료")
        assertNotEquals(second.getHeader("Idempotency-Key"), received[2].getHeader("Idempotency-Key"))
    }
    @Test fun composerRestoresFailedCreationAndBlocksEditsDuringSave() {
        val attempts = AtomicInteger(0)
        dispatch { if(attempts.incrementAndGet() <= 2) response("{\"message\":\"커뮤니티 챌린지 생성에는 500 포인트가 필요해요.\"}", 400) else response("{}").setBodyDelay(1, TimeUnit.SECONDS) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { var open by rememberSaveable { mutableStateOf(true) }; MungsilTheme {
            if(open) ChallengeComposer(api, null, { open = false }, {}) else Text("개설 완료")
        } }
        compose.onNodeWithContentDescription("챌린지 이름").performScrollTo().performTextInput("작은 실천")
        compose.onNodeWithContentDescription("함께할 약속").performScrollTo().performTextInput("매일 작은 실천을 함께 이어가요.")
        click("500 포인트로 만들기"); waitText("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("챌린지 이름").assertTextContains("작은 실천")
        click("500 포인트로 만들기"); waitText("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.")
        assertEquals(received[0].getHeader("Idempotency-Key"), received[1].getHeader("Idempotency-Key"))
        compose.onNodeWithContentDescription("함께할 약속").performScrollTo().performTextReplacement("저녁마다 작은 실천을 함께 이어가요.")
        click("500 포인트로 만들기"); waitText("저장하는 중…")
        compose.onNodeWithContentDescription("함께할 약속").assertIsNotEnabled()
        waitText("개설 완료")
        assertNotEquals(received[1].getHeader("Idempotency-Key"), received[2].getHeader("Idempotency-Key"))
        val body = JsonParser.parseString(received[2].body.clone().readUtf8()).asJsonObject
        assertEquals("COMMUNITY", body.text("kind")); assertFalse(body.has("rewardLabel")); assertFalse(body.has("rewardTerms"))
    }
    @Test fun reviewPhotoFailureRetryAndSavedVoteDoNotLeakIntoNewAttempt() {
        val photos = AtomicInteger(0); val votes = AtomicInteger(0); val bytes = photoBytes()
        dispatch { request -> when {
            request.requestUrl!!.encodedPath == "/photo.png" -> if(photos.incrementAndGet() == 1) response("{}", 503) else MockResponse().setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(bytes))
            request.method == "POST" -> if(votes.incrementAndGet() <= 2) response("{}", 503) else response("{}")
            else -> response(if(votes.get() < 3) queue() else queue(2, listOf("새 인증의 기준인가요?"))).setBodyDelay(200, TimeUnit.MILLISECONDS)
        } }
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MungsilTheme { VerificationSheet(api, "challenge", {}) } }
        waitText("인증 사진을 불러오지 못했어요. 사진을 확인한 뒤 판정해주세요.")
        compose.onNodeWithText("확인돼요").performScrollTo().assertIsNotEnabled()
        click("다시 시도"); waitEnabled("확인돼요"); click("확인돼요"); click("다음 기준")
        waitText("2/2 · 주제에 맞는 실천인가요?"); click("확인되지 않아요"); click("익명으로 의견 보내기"); waitText(failure)
        restoration.emulateSavedInstanceStateRestore()
        waitText("2/2 · 주제에 맞는 실천인가요?"); waitEnabled("익명으로 의견 보내기")
        compose.onNodeWithText("선택 · 확인되지 않아요").assertIsSelected()
        click("익명으로 의견 보내기"); waitText(failure)
        val submitted = received.filter { it.method == "POST" }
        assertEquals(submitted[0].getHeader("Idempotency-Key"), submitted[1].getHeader("Idempotency-Key"))
        assertEquals(submitted[0].body.clone().readUtf8(), submitted[1].body.clone().readUtf8())
        click("이전 기준"); waitText("1/2 · 걸음이 확인되나요?"); click("판단하기 어려워요"); click("다음 기준"); click("익명으로 의견 보내기")
        waitText("1/1 · 새 인증의 기준인가요?")
        compose.onNodeWithText("익명으로 의견 보내기").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("선택 · 확인되지 않아요").assertDoesNotExist()
        assertNotEquals(submitted[1].getHeader("Idempotency-Key"), received.filter { it.method == "POST" }[2].getHeader("Idempotency-Key"))
        screenshot("challenge-new-review-attempt")
    }
    @Test fun malformedQueueShowsErrorAndRetryCanProduceARealEmptyState() {
        val loads = AtomicInteger(0)
        dispatch { if(loads.incrementAndGet() == 1) response("{\"items\":[]}") else response("{\"contributionCount\":4,\"items\":[]}") }
        compose.setContent { MungsilTheme { VerificationSheet(api, "challenge", {}) } }
        waitText("확인할 인증의 정보를 읽지 못했어요. 다시 불러와주세요.")
        compose.onNodeWithText("지금 확인할 사진이 없어요").assertDoesNotExist()
        click("다시 시도"); waitText("지금 확인할 사진이 없어요")
        compose.onNodeWithText("참여 가능한 새 인증이 생기면 다시 보여드릴게요. 지금까지 4회 도왔어요.").assertExists()
    }
    @Test fun verificationPhotoExpansionAndReportKeepTheCorrectTargetOnFailure() {
        val reports = AtomicInteger(0); val bytes = photoBytes()
        dispatch { request -> when {
            request.requestUrl!!.encodedPath == "/photo.png" -> MockResponse().setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(bytes))
            request.method == "POST" -> if(reports.incrementAndGet() == 1) response("{}", 503) else response("{}")
            else -> response(queue())
        } }
        var closed by mutableStateOf(false)
        compose.setContent { MungsilTheme { if(!closed) VerificationSheet(api, "challenge", { closed = true }) else Text("검수 닫힘") } }
        waitText("1/2 · 걸음이 확인되나요?"); waitEnabled("인증 사진 크게 보기"); click("인증 사진 크게 보기")
        compose.onNodeWithContentDescription("참여자 인증 사진 원본").assertExists()
        compose.waitUntil(10_000) {
            val bounds = compose.onNodeWithContentDescription("참여자 인증 사진 원본").fetchSemanticsNode().boundsInRoot
            bounds.width >= 300 && kotlin.math.abs(bounds.width / bounds.height - 16f/9f) < .05f
        }
        screenshot("challenge-review-photo-expanded")
        compose.onAllNodesWithContentDescription("닫기").onLast().performClick()
        waitText("사진 인증 함께 확인하기"); click("이 사진 신고")
        compose.onNodeWithContentDescription("신고 사유").performScrollTo().performTextInput("다른 사람의 사진으로 보여요.")
        click("신고 접수"); waitText(failure)
        compose.onNodeWithContentDescription("신고 사유").assertTextContains("다른 사람의 사진으로 보여요.")
        click("신고 접수"); waitText("검수 닫힘")
        val requests = received.filter { it.method == "POST" }
        val body = JsonParser.parseString(requests[0].body.clone().readUtf8()).asJsonObject
        assertEquals("CHALLENGE_CHECK_IN", body.text("targetType")); assertEquals("check", body.text("targetId"))
        assertEquals(requests[0].getHeader("Idempotency-Key"), requests[1].getHeader("Idempotency-Key"))
    }
    @Test fun detailRejectsClosedUnknownAndUnavailableMembershipActions() {
        var stage by mutableIntStateOf(0)
        val source = json("id" to "challenge", "title" to "산책 챌린지", "description" to "매일 함께 걸어요", "startsAt" to "2000-01-01T00:00:00Z", "endsAt" to "2100-01-01T00:00:00Z",
            "joined" to true, "todayCheckedIn" to true, "verificationMode" to "PEER_PHOTO", "minimumParticipants" to 8, "completionThreshold" to 80,
            "creator" to json("id" to "me"), "_count" to json("participants" to 8), "checkIns" to listOf(json("id" to "rejected", "checkInDate" to "2026-09-28T00:00:00Z",
                "status" to "REJECTED", "attempt" to 1, "retryUntil" to "2100-01-01T00:00:00Z", "reviewNote" to "실천 내용이 보이지 않아요.", "reverifyUsed" to false)))
        dispatch { request -> when {
            request.requestUrl!!.encodedPath.endsWith("/auth/me") -> response("{\"id\":\"me\"}")
            request.requestUrl!!.encodedPath.endsWith("/leaderboard") -> response("{\"items\":[]}")
            else -> when(stage) { 4 -> response("{\"message\":\"접근할 수 없어요.\"}", 403); else -> response(source.deepCopy().apply {
                when(stage) { 1 -> addProperty("endedAt", "2026-09-28T00:00:00Z"); 2 -> { addProperty("joined", false); add("checkIns", com.google.gson.JsonArray()) }; 3 -> addProperty("startsAt", "잘못된 날짜") }
            }.toString()) }
        } }
        compose.setContent { MungsilTheme { ChallengeDetailScreen(api, "challenge", true, stage, {}, {}, {}) } }
        waitText("산책 챌린지")
        click("새 사진 올리기"); waitText("새 사진으로 다시 인증")
        compose.onNodeWithText("새 사진으로 다시 요청").performScrollTo().assertIsNotEnabled()
        compose.onAllNodesWithContentDescription("닫기").onLast().performClick()
        click("챌린지 종료"); waitText("챌린지를 종료할까요?"); click("돌아가기")
        screenshot("challenge-rejection")
        compose.runOnIdle { stage = 1 }; waitText("종료된 챌린지예요.")
        compose.onNodeWithText("새 사진 올리기").assertDoesNotExist(); compose.onNodeWithText("챌린지 종료").assertDoesNotExist(); compose.onNodeWithText("참여 취소").assertDoesNotExist()
        compose.runOnIdle { stage = 2 }; waitText("챌린지 시작하기"); click("챌린지 시작하기")
        // No real join is performed: the synthetic response merely accepts the test request.
        compose.runOnIdle { stage = 3 }; waitText("챌린지 일정을 확인하지 못했어요. 다시 불러와주세요.")
        compose.onNodeWithText("챌린지 시작하기").assertDoesNotExist(); compose.onNodeWithText("새 사진 올리기").assertDoesNotExist()
        compose.runOnIdle { stage = 4 }; waitText("접근할 수 없어요.")
        compose.onNodeWithText("산책 챌린지").assertDoesNotExist(); compose.onNodeWithText("새 사진 올리기").assertDoesNotExist()
    }
}
