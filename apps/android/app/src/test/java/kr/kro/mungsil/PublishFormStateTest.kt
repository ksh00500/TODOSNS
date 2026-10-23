package kr.kro.mungsil

import androidx.compose.runtime.saveable.SaverScope
import kotlinx.coroutines.runBlocking
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.Test
import org.junit.Assert.*
import java.io.IOException
import java.util.concurrent.TimeUnit

class PublishFormStateTest {
    private fun state(group: Boolean = false) = PublishFormState("account-a", "source", group)
    private fun restore(form: PublishFormState) = PublishFormState.restoreState(form.saveState(), form.owner, form.targetId, form.group)!!
    private fun api(server: MockWebServer) = Api(server.url("/api/v1/").toString(), object : SessionStore {
        override fun read(): String? = null
        override fun write(value: String?) {}
    })

    @Test fun saverKeepsDraftMediaAndPendingPhotoTogetherWithoutSourceOrCredentials() {
        val form = state(true)
        form.update { it.copy(caption = "오늘의 작은 실천", tagInput = "#ＡＢＣ_산책", visibility = "FOLLOWERS", mediaId = "uploaded") }
        form.addTag(); form.photo.selectedUri = "content://synthetic/selected"; form.photo.cameraUri = "content://synthetic/camera"
        form.photoPending(true)
        val saver = PublishFormState.saver("account-a", "source", true)
        val serialized = with(saver) { object : SaverScope { override fun canBeSaved(value: Any) = true }.save(form) }!!
        val restored = saver.restore(serialized)!!
        assertEquals(form.draft, restored.draft); assertTrue(restored.incompletePhoto)
        assertEquals(form.photo.selectedUri, restored.photo.selectedUri); assertEquals(form.photo.cameraUri, restored.photo.cameraUri)
        assertNull(restored.begin()); restored.photoPending(false)
        val request = restored.begin()!!
        assertEquals("source", com.google.gson.JsonParser.parseString(request.body).asJsonObject.text("todoListId"))
        assertFalse(serialized.contains("accessToken")); assertFalse(serialized.contains("refreshToken"))
    }
    @Test fun anotherOwnerTargetOrModeCannotRestoreTheDraft() {
        val form = state(); form.update { it.copy(caption = "A private caption") }
        val saved = form.saveState()
        assertNull(PublishFormState.restoreState(saved, "account-b", "source", false))
        assertNull(PublishFormState.restoreState(saved, "account-a", "other", false))
        assertNull(PublishFormState.restoreState(saved, "account-a", "source", true))
        assertNull(PublishFormState.restoreState(saved, "", "source", false))
        assertNull(PublishFormState("", "source", false).begin())
    }
    @Test fun inFlightRestoreFreezesBodyKeyAndUploadedPhotoUntilExplicitConfirmation() {
        val form = state(); form.update { it.copy(caption = "제출한 내용", visibility = "PRIVATE", mediaId = "ready-photo") }
        val first = form.begin(1000)!!
        assertNull(form.begin(1001))
        val restored = restore(form)
        assertFalse(restored.busy); assertTrue(restored.uncertain); assertFalse(restored.editable)
        restored.update { it.copy(caption = "다른 내용", mediaId = null) }; restored.addTag("새태그")
        assertEquals("제출한 내용", restored.draft.caption); assertEquals("ready-photo", restored.draft.mediaId)
        val replay = restored.begin(2000)!!
        assertEquals(first.body, replay.body); assertEquals(first.key, replay.key)
        assertTrue(restored.succeeded(replay)); assertTrue(restored.editable)
        assertFalse(restored.succeeded(first))
    }
    @Test fun ambiguousFailureAndCancellationNeverUnlockOrAutomaticallyReplay() {
        for(failure in listOf(IOException(), ApiException(503,"unavailable"), ApiException(409,"processing"))) {
            val form = state(); val request = form.begin(1000)!!
            form.failed(request, failure)
            assertFalse(form.busy); assertTrue(form.uncertain); assertFalse(form.editable)
            val next = form.begin(2000)!!
            assertEquals(request.body, next.body); assertEquals(request.key, next.key)
            form.cancelled(next); assertTrue(restore(form).uncertain)
        }
    }
    @Test fun expiredOrBackwardClockNeverCreatesAnotherPost() {
        for(now in listOf(999L, 301000L)) {
            val form = state(); val request = form.begin(1000)!!; form.failed(request, IOException())
            val restored = restore(form)
            assertNull(restored.begin(now)); assertFalse(restored.editable)
            assertTrue(restored.error!!.contains("마이의 게시 기록"))
        }
    }
    @Test fun confirmedRejectionAllowsEditingAndOnlyChangedPayloadRotatesKey() {
        val form = state(); val first = form.begin(1000)!!; form.failed(first, ApiException(400,"내용 확인"))
        assertTrue(form.editable)
        val same = form.begin(2000)!!; assertEquals(first.key, same.key)
        form.failed(same, ApiException(422,"사진 확인"))
        form.update { it.copy(caption = "수정한 내용", visibility = "FOLLOWERS") }
        val changed = form.begin(3000)!!
        assertNotEquals(first.key, changed.key); assertNotEquals(first.body, changed.body)
        form.failed(first, IOException()); assertTrue(form.busy)
        assertTrue(form.succeeded(changed))
        assertNotEquals(changed.key, form.begin(4000)!!.key)
    }
    @Test fun deniedSessionCannotResumeSubmissionAfterRestore() {
        for(status in listOf(401,403)) {
            val form = state(); form.failed(form.begin()!!, ApiException(status,"다시 로그인해주세요."))
            val restored = restore(form)
            assertTrue(restored.denied); assertFalse(restored.editable); assertNull(restored.begin())
        }
    }
    @Test fun unfinishedPhotoAndInvalidTagBlockPostingWithoutDroppingInput() {
        val form = state(); form.photo.selectedUri = "content://synthetic/unfinished"
        assertNull(form.begin()); form.photo.selectedUri = null
        form.update { it.copy(tagInput = "두 단어") }; assertNull(form.begin())
        assertEquals("두 단어", form.draft.tagInput); assertNotNull(form.tagError)
        form.update { it.copy(tagInput = "#ＡＢＣ_산책") }
        val request = form.begin()!!
        assertEquals(listOf("abc_산책"), com.google.gson.JsonParser.parseString(request.body).asJsonObject.strings("hashtags"))
    }
    @Test fun captionBoundaryUsesUnicodeCodePoints() {
        val form = state(); form.update { it.copy(caption = "😊".repeat(181)) }; assertNull(form.begin())
        form.update { it.copy(caption = "😊".repeat(180)) }; assertNotNull(form.begin())
    }
    @Test fun actualHttpReplayKeepsExactBodyAndKeyAfterConflictAndRestore() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server)
            server.enqueue(MockResponse().setResponseCode(409).setBody("{}")); server.enqueue(MockResponse().setBody("{\"id\":\"post\"}"))
            val form = state(); form.update { it.copy(visibility = "FOLLOWERS", mediaId = "ready-photo") }
            val first = form.begin()!!
            form.failed(first, runCatching { sendPublication(api, first, api.sessionVersion) }.exceptionOrNull()!!)
            val restored = restore(form); val replay = restored.begin()!!
            sendPublication(api, replay, api.sessionVersion); assertTrue(restored.succeeded(replay))
            val a = server.takeRequest(); val b = server.takeRequest()
            assertEquals("/api/v1/feed/posts", a.path); assertEquals("POST", a.method)
            assertEquals(a.body.readUtf8(), b.body.readUtf8()); assertEquals(a.getHeader("Idempotency-Key"), b.getHeader("Idempotency-Key"))
            assertEquals(2,server.requestCount)
        }
    }
    @Test fun oldSessionCannotSendPublicationAfterAccountSwitch() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server); val version = api.sessionVersion
            val form = state(); val request = form.begin()!!; api.clear()
            val failure = runCatching { sendPublication(api, request, version) }.exceptionOrNull() as ApiException
            assertEquals(401,failure.status); assertNull(server.takeRequest(100,TimeUnit.MILLISECONDS))
            form.failed(request,failure); assertTrue(form.denied)
        }
    }
    @Test fun malformedSuccessRemainsUncertainRatherThanClearingDraft() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server)
            for(response in listOf("{}", "[]", "{\"id\":null}", "{\"id\":123}", "{\"id\":\" \"}")) {
                server.enqueue(MockResponse().setBody(response))
                val form = state(); val request = form.begin()!!
                val failure = runCatching { sendPublication(api, request, api.sessionVersion) }.exceptionOrNull() as ApiException
                assertEquals(502,failure.status); form.failed(request,failure)
                assertTrue(form.uncertain); assertEquals(request.key,restore(form).begin()!!.key)
            }
        }
    }
}
