package kr.kro.mungsil

import androidx.compose.runtime.saveable.SaverScope
import com.google.gson.JsonParser
import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.Test
import org.junit.Assert.*
import java.time.ZoneId
import java.util.concurrent.TimeUnit

class TodoFormStateTest {
    private val zone = ZoneId.of("Asia/Seoul")
    private val source = json("id" to "todo", "title" to "원본 제목", "notes" to "원본 메모", "dueDate" to "2026-09-28T00:00:30.123Z",
        "seriesId" to "series", "repeatRule" to "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2", "category" to "생활", "categoryId" to "custom", "visibility" to "FOLLOWERS")
    private fun state() = TodoFormState.create("account-a", source, false, "2026-09-28", zone)
    private fun restore(state: TodoFormState) = TodoFormState.restoreState(state.saveState(), "account-a", "todo", false)!!
    private fun payload(state: TodoFormState) = todoWritePayload(state.draft, state.source(), false, ZoneId.of(state.zoneId), false, false)

    @Test fun allFieldsBaselineGroupAndScopeSurviveSaverRoundTrip() {
        val state = state(); state.observeGroup("original-group")
        state.update { it.copy(title = "수정한 제목", notes = "수정한 메모", date = "2026-10-01", time = "18:35", category = "건강", categoryId = "health", repeatRule = "WEEKDAYS", visibility = "PRIVATE", recurrenceScope = "FUTURE") }
        state.selectGroup("chosen-group")
        val saver = TodoFormState.saver("account-a", "todo", false)
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val saved = with(saver) { scope.save(state) }!!
        val restored = saver.restore(saved)!!
        assertEquals(state.draft, restored.draft)
        assertEquals("original-group", restored.originalGroup); assertTrue(restored.chosenGroup)
        assertTrue(restored.dirty); assertFalse(restored.busy)
    }
    @Test fun titleOnlyEditKeepsExactOriginalInstantAfterRestoreWithUnavailableRelations() {
        val state = state(); state.update { it.copy(title = "제목만 수정") }
        val restored = restore(state)
        val body = payload(restored)
        assertEquals("2026-09-28T00:00:30.123Z", body.text("dueDate"))
        assertEquals(source.text("repeatRule"), body.text("repeatRule"))
        assertEquals("FOLLOWERS", body.text("visibility"))
        assertFalse(body.has("categoryId")); assertFalse(body.has("todoListId"))
        assertTrue(restored.dirty)
    }
    @Test fun unmodifiedFormAndReselectingOriginalGroupAreNotDirty() {
        val state = state(); state.observeGroup("group")
        assertFalse(state.dirty)
        state.selectGroup("group"); assertFalse(state.dirty)
        state.selectGroup(""); assertTrue(state.dirty)
        state.selectGroup("group"); assertFalse(state.dirty)
        state.update { it.copy(recurrenceScope = "FUTURE") }; assertTrue(state.dirty)
        state.update { it.copy(recurrenceScope = "THIS") }; assertFalse(state.dirty)
        assertFalse(restore(state).dirty)
    }
    @Test fun anotherAccountTargetOrModeNeverRestoresPrivateDraft() {
        val state = state(); state.update { it.copy(notes = "account-a private note") }
        val saved = state.saveState()
        assertNull(TodoFormState.restoreState(saved, "account-b", "todo", false))
        assertNull(TodoFormState.restoreState(saved, "account-a", "other", false))
        assertNull(TodoFormState.restoreState(saved, "account-a", "todo", true))
        assertNull(TodoFormState.restoreState(saved, "", "todo", false))
        assertFalse(TodoFormState.create("account-b", source, false, "2026-09-28", zone).draft.notes.contains("private"))
    }
    @Test fun sourceIsFrozenAndOnlyTodoFieldsAreSaved() {
        val input = source.deepCopy().apply { addProperty("unexpectedCredential", "must-not-persist") }
        val state = TodoFormState.create("account-a", input, false, "2026-09-28", zone)
        input.addProperty("dueDate", "2030-01-01T00:00:00Z")
        assertEquals(source.text("dueDate"), state.source()!!.text("dueDate"))
        assertFalse(state.saveState().contains("must-not-persist"))
        state.source()!!.addProperty("title", "outside mutation")
        assertEquals("원본 제목", state.source()!!.text("title"))
    }
    @Test fun inFlightRestoreNeedsExplicitReplayWithExactBodyAndKey() {
        val state = state(); state.update { it.copy(title = "제출한 제목") }
        val request = state.begin(payload(state))!!
        assertTrue(state.busy); assertNull(state.begin(payload(state)))
        val restored = restore(state)
        assertFalse(restored.busy); assertTrue(restored.uncertain); assertFalse(restored.editable)
        restored.update { it.copy(title = "다른 내용") }
        assertEquals("제출한 제목", restored.draft.title)
        restored.observeGroup("newly-loaded-group")
        val differentOptionsBody = payload(restored).apply { addProperty("todoListId", "newly-loaded-group") }
        val replay = restored.begin(differentOptionsBody)!!
        assertEquals(request.key, replay.key); assertEquals(request.body, replay.body)
        assertTrue(replay.attempt > request.attempt)
        assertTrue(restored.succeeded(replay)); assertFalse(restored.uncertain)
    }
    @Test fun knownRejectionAllowsEditingButNewBodyGetsANewKey() {
        val state = state(); val first = state.begin(payload(state))!!
        state.failed(first, ApiException(400, "입력 내용을 확인해주세요."))
        assertTrue(state.editable); assertFalse(state.uncertain)
        val restored = restore(state)
        val same = restored.begin(payload(restored))!!
        assertEquals(first.key, same.key)
        restored.failed(same, ApiException(400, "다시 확인해주세요."))
        restored.update { it.copy(title = "새로운 내용") }
        val changed = restored.begin(payload(restored))!!
        assertNotEquals(first.key, changed.key)
        assertFalse(restored.succeeded(first)); assertTrue(restored.busy)
        assertTrue(restored.succeeded(changed))
    }
    @Test fun cancellationAndConflictKeepUncertainSubmissionInsteadOfCreatingAnother() {
        for(error in listOf(java.io.IOException(), ApiException(503, "서버 오류"), ApiException(409, "처리 중"))) {
            val state = state(); val first = state.begin(payload(state))!!
            state.failed(first, error)
            assertTrue(state.uncertain)
            val replay = restore(state).begin()!!
            assertEquals(first.key, replay.key); assertEquals(first.body, replay.body)
        }
        val state = state(); val first = state.begin(payload(state))!!
        state.cancelled(first)
        assertTrue(restore(state).uncertain)
    }
    @Test fun successStartsANewActionAndLateOldCallbacksCannotClearIt() {
        val state = state(); val first = state.begin(payload(state))!!
        assertTrue(state.succeeded(first))
        val second = state.begin(payload(state))!!
        assertNotEquals(first.key, second.key)
        state.failed(first, ApiException(400, "이전 오류"))
        assertTrue(state.busy); assertNull(state.error)
        assertFalse(state.succeeded(first)); assertTrue(state.succeeded(second))
    }
    @Test fun corruptStateIsDiscardedAndGuestCannotSubmit() {
        assertNull(TodoFormState.restoreState("broken", "account-a", "todo", false))
        val data = JsonParser.parseString(state().saveState()).asJsonObject
        data.getAsJsonObject("draft").remove("title")
        assertNull(TodoFormState.restoreState(data.toString(), "account-a", "todo", false))
        val guest = TodoFormState.create("", source, false, "2026-09-28", zone)
        assertNull(guest.begin(payload(guest)))
    }
    @Test fun createAndCloneRestoreHaveDifferentContextsAndRoutes() {
        val created = TodoFormState.create("account-a", null, false, "2026-10-01", zone)
        created.update { it.copy(title = "새 실천") }
        val createBody = todoWritePayload(created.draft, null, false, zone, true, true)
        val request = created.begin(createBody)!!
        val restored = TodoFormState.restoreState(created.saveState(), "account-a", null, false)!!
        assertEquals("todos", request.path); assertEquals("POST", request.method)
        assertEquals(request.key, restored.begin()!!.key)
        val cloned = TodoFormState.create("account-a", source, true, "2026-10-01", zone)
        assertEquals("PRIVATE", cloned.draft.visibility); assertEquals("", cloned.draft.categoryId)
        val cloneRequest = cloned.begin(todoWritePayload(cloned.draft, cloned.source(), true, zone, true, true))!!
        assertEquals("todos/todo/clone", cloneRequest.path); assertEquals("POST", cloneRequest.method)
    }
    @Test fun localHttpFailureRestoreAndReplayKeepsExactWireRequest() = runBlocking {
        val server = MockWebServer(); server.start()
        try {
            val api = Api(server.url("/api/v1/").toString(), object : SessionStore {
                override fun read(): String? = null
                override fun write(value: String?) {}
            })
            val state = state(); val request = state.begin(payload(state))!!
            server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
            val error = runCatching { sendTodoForm(api, request, api.sessionVersion) }.exceptionOrNull()!!
            state.failed(request, error)
            val restored = restore(state); val retry = restored.begin(json("different" to "must-not-send"))!!
            server.enqueue(MockResponse().setBody(source.toString()))
            sendTodoForm(api, retry, api.sessionVersion)
            assertTrue(restored.succeeded(retry))
            val a = server.takeRequest(); val b = server.takeRequest()
            assertEquals("PATCH", a.method); assertEquals(a.path, b.path)
            assertEquals(a.body.readUtf8(), b.body.readUtf8())
            assertEquals(a.getHeader("Idempotency-Key"), b.getHeader("Idempotency-Key"))
            assertEquals(2, server.requestCount)
        } finally { server.shutdown() }
    }
    @Test fun expiredOrBackwardsClockSnapshotIsNotRepostedAfterRestore() {
        for(now in listOf(1_000L + 5 * 60_000, 999L)) {
            val state = state(); state.begin(payload(state), nowMillis = 1_000L)
            val restored = restore(state)
            assertNull(restored.begin(nowMillis = now))
            assertTrue(restored.uncertain); assertFalse(restored.busy)
            assertTrue(restored.error!!.contains("목록"))
        }
    }
    @Test fun accountChangeBeforeLaunchSendsNoPreviousUsersDraft() = runBlocking {
        val server = MockWebServer(); server.start()
        try {
            val api = Api(server.url("/api/v1/").toString(), object : SessionStore {
                override fun read(): String? = null
                override fun write(value: String?) {}
            })
            val version = api.sessionVersion
            val request = state().let { it.begin(payload(it))!! }
            api.clear()
            val error = runCatching { sendTodoForm(api, request, version) }.exceptionOrNull() as ApiException
            assertEquals(401, error.status); assertEquals(0, server.requestCount)
        } finally { server.shutdown() }
    }
    @Test fun accountChangeDuringHttpCannotConfirmPreviousSubmission() = runBlocking {
        val server = MockWebServer(); server.start()
        try {
            val api = Api(server.url("/api/v1/").toString(), object : SessionStore {
                override fun read(): String? = null
                override fun write(value: String?) {}
            })
            val state = state(); val request = state.begin(payload(state))!!
            val version = api.sessionVersion
            server.enqueue(MockResponse().setBody(source.toString()).setBodyDelay(150, TimeUnit.MILLISECONDS))
            val pending = async { runCatching { sendTodoForm(api, request, version) } }
            withContext(Dispatchers.IO) { checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)) }
            api.clear()
            assertEquals(401, (pending.await().exceptionOrNull() as ApiException).status)
        } finally { server.shutdown() }
    }
}
