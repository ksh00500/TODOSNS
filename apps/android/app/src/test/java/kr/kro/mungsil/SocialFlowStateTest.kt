package kr.kro.mungsil

import com.google.gson.JsonParser
import kotlinx.coroutines.runBlocking
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import okhttp3.mockwebserver.*
import org.junit.Test
import org.junit.Assert.*
import java.io.IOException
import java.time.*
import java.util.concurrent.TimeUnit

class SocialFlowStateTest {
    private val owner = "account-a"
    private fun api(server: MockWebServer) = Api(server.url("/api/v1/").toString(),object : SessionStore {
        override fun read(): String? = null
        override fun write(value: String?) {}
    })
    private fun cheer() = CheerState(owner,"post",false,2)
    private val source get() = json("id" to "routine", "title" to "작은 루틴", "unexpectedSecret" to "never-copy-this-field", "items" to listOf(
        json("todo" to json("id" to "one","title" to "산책","category" to "건강","dueDate" to "2026-09-28T00:00:30.123Z","repeatRule" to "FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2")),
        json("todo" to json("id" to "two","title" to "독서","category" to "학습","dueDate" to "2026-09-29T02:00:30.123Z","repeatRule" to ""))))
    private val zone = ZoneId.of("America/New_York")
    private fun routine() = RoutineImportState.create(owner,source,zone,"2026-10-31")
    private fun restore(form: RoutineImportState) = RoutineImportState.restore(form.save(),owner,"routine")!!

    @Test fun cheerFailureRollsBackCountAndSharedViewsUseOnlyOnePendingToggle() {
        val store = CheerStore(owner)
        val card = store.get("post",false,2); val detail = store.get("post",false,2)
        assertSame(card,detail)
        val first = card.begin(1000)!!
        assertTrue(card.cheered); assertEquals(3,detail.count); assertNull(detail.begin(1001))
        card.failed(first,IOException())
        assertFalse(detail.cheered); assertEquals(2,detail.count)
        detail.observe(true,99) // An unrelated refresh cannot replace an unresolved receipt.
        assertEquals(2,detail.count)
        val replay = detail.begin(2000)!!
        assertEquals(first.key,replay.key); assertEquals(first.body,replay.body)
        assertTrue(detail.succeeded(replay,true)); assertTrue(card.cheered); assertEquals(3,card.count)
        val next = card.begin(3000)!!
        assertNotEquals(first.key,next.key)
        assertFalse(detail.succeeded(first,false)); assertTrue(detail.submission.busy)
        assertTrue(card.succeeded(next,false)); assertEquals(2,card.count)
    }
    @Test fun cheerInFlightReceiptSurvivesStoreRestoreButNotAnotherAccount() {
        val store = CheerStore(owner); val state = store.get("post",false,2); val first = state.begin(1000)!!
        val saved = store.save()
        val restored = CheerStore.saver(owner).restore(saved)!!.get("post",true,50)
        assertFalse(restored.cheered); assertFalse(restored.submission.busy); assertTrue(restored.submission.uncertain)
        val replay = restored.begin(2000)!!; assertEquals(first.key,replay.key)
        assertNull(CheerStore.saver("account-b").restore(saved))
        assertFalse(saved.contains("caption")); assertFalse(saved.contains("accessToken"))
    }
    @Test fun expiredAndBackwardClockCannotToggleAgain() {
        for(now in listOf(999L,301000L)) {
            val state = cheer(); state.failed(state.begin(1000)!!,IOException())
            assertNull(state.begin(now)); assertEquals(2,state.count); assertFalse(state.cheered)
            val form = routine(); val request = form.begin(1000)!!; form.submission.failed(request,IOException())
            assertNull(restore(form).begin(now))
        }
    }
    @Test fun deniedCheerCannotSendAgainAndDefiniteRejectionCanRetry() {
        for(status in listOf(401,403,404)) {
            val state = cheer(); state.failed(state.begin()!!,ApiException(status,"권한을 확인해주세요."))
            assertTrue(state.submission.denied); assertNull(state.begin()); assertEquals(2,state.count)
        }
        val state = cheer(); val write = state.begin()!!; state.failed(write,ApiException(400,"입력 확인"))
        assertEquals(write.key,state.begin()!!.key)
    }
    @Test fun actualCheerHttpConfirmsSameKeyAfterConflictAndValidatesBoolean() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server); val state = cheer()
            server.enqueue(MockResponse().setResponseCode(409).setBody("{}"))
            server.enqueue(MockResponse().setBody("{\"cheered\":true}"))
            val first = state.begin()!!
            state.failed(first,runCatching { sendCheer(api,"post",first,api.sessionVersion) }.exceptionOrNull()!!)
            val replay = state.begin()!!; assertTrue(state.succeeded(replay,sendCheer(api,"post",replay,api.sessionVersion)))
            val a = server.takeRequest(); val b = server.takeRequest()
            assertEquals("/api/v1/feed/posts/post/cheer",a.path); assertEquals(a.getHeader("Idempotency-Key"),b.getHeader("Idempotency-Key"))
            assertEquals(a.body.readUtf8(),b.body.readUtf8()); assertEquals(2,server.requestCount)
            for(body in listOf("{}","{\"cheered\":\"true\"}","[]")) {
                server.enqueue(MockResponse().setBody(body)); val request = state.begin()!!
                val failure = runCatching { sendCheer(api,"post",request,api.sessionVersion) }.exceptionOrNull() as ApiException
                assertEquals(502,failure.status); state.failed(request,failure)
                assertTrue(state.submission.uncertain)
            }
        }
    }
    @Test fun oldSessionSendsNeitherCheerNorRoutineClone() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server); val session = api.sessionVersion
            val cheer = cheer().begin()!!; val clone = routine().begin()!!; api.clear()
            assertEquals(401,(runCatching { sendCheer(api,"post",cheer,session) }.exceptionOrNull() as ApiException).status)
            assertEquals(401,(runCatching { sendRoutineImport(api,"routine",owner,clone,session) }.exceptionOrNull() as ApiException).status)
            assertNull(server.takeRequest(100,TimeUnit.MILLISECONDS))
        }
    }
    @Test fun currentCheerInspectionUsesOnlyGetAndCannotDiscardAnUncertainToggle() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server); val state = cheer()
            val original = state.begin(1000)!!; state.failed(original,IOException())
            server.enqueue(MockResponse().setBody("{\"id\":\"post\",\"cheered\":true,\"cheerCount\":7}"))
            assertTrue(state.beginInspection()); assertNull(state.begin(2000))
            val (value,count) = inspectCheer(api,"post",api.sessionVersion); state.inspected(value,count)
            assertTrue(state.cheered); assertEquals(7,state.count); assertTrue(state.submission.uncertain)
            val replay = state.begin(2000)!!; assertEquals(original.key,replay.key)
            state.failed(replay,IOException()); assertNull(state.begin(301000))
            assertEquals("GET",server.takeRequest().method); assertEquals(1,server.requestCount)
        }
    }
    @Test fun failedReceiptKeepsItsKeyAcrossStoreRestoreEvenForDefiniteRejection() {
        val store = CheerStore(owner); val state = store.get("post",false,2)
        val request = state.begin()!!; state.failed(request,ApiException(400,"입력 확인"))
        val restored = CheerStore.saver(owner).restore(store.save())!!.get("post",false,2)
        assertEquals(request.key,restored.begin()!!.key)
    }
    @Test fun inspectionCanClearKnownDenialButFailedInspectionPreservesReceipt() {
        val state = cheer(); val request = state.begin()!!; state.failed(request,ApiException(403,"권한 없음"))
        assertTrue(state.beginInspection()); state.inspectionFailed(IOException())
        assertTrue(state.submission.denied); assertNull(state.begin())
        assertTrue(state.beginInspection()); state.inspected(false,2)
        assertFalse(state.submission.denied); assertNotEquals(request.key,state.begin()!!.key)
    }
    @Test fun routineModesPreserveOffsetsAndCustomDraftAcrossRestore() {
        val form = routine()
        form.update { it.copy(mode = "NONE") }; assertFalse(form.payload().has("items"))
        form.update { it.copy(mode = "KEEP") }; assertFalse(form.payload().has("items"))
        form.update { it.copy(mode = "CUSTOM") }; form.updateItem("one") { it.copy(title = "편집한 산책") }
        val expected = form.payload().toString()
        form.update { it.copy(mode = "NONE") }; form.update { it.copy(mode = "KEEP") }; form.update { it.copy(mode = "CUSTOM") }
        val restored = restore(form); assertEquals(expected,restored.payload().toString())
        val items = restored.payload().list("items")
        assertEquals("편집한 산책",items[0].text("title")); assertEquals("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2",items[0].text("repeatRule"))
        assertEquals(26,Duration.between(Instant.parse(items[0].text("dueDate")),Instant.parse(items[1].text("dueDate"))).toHours().toInt())
        assertEquals(zone.id,restored.zoneId)
    }
    @Test fun routinePreviewTracksStartAndDstWithoutDiscardingCustomEdits() {
        val form = routine()
        val initial = form.previewItems()!!
        assertEquals("2026-10-31", initial[0].date); assertEquals("07:00", initial[0].time)
        assertEquals("2026-11-01", initial[1].date); assertEquals("08:00", initial[1].time)
        form.update { it.copy(mode = "CUSTOM") }
        form.updateItem("one") { it.copy(title = "내가 편집한 산책", date = "2026-11-10", time = "18:20", repeatRule = "") }
        val edited = form.draft.items
        form.update { it.copy(mode = "KEEP", date = "2026-11-03", time = "09:00") }
        val kept = form.previewItems()!!
        assertEquals("산책", kept[0].title); assertEquals("2026-11-03", kept[0].date); assertEquals("09:00", kept[0].time)
        assertEquals("2026-11-04", kept[1].date); assertEquals("11:00", kept[1].time)
        assertEquals("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2", kept[0].repeatRule)
        assertEquals(edited, form.draft.items); assertFalse(form.payload().has("items"))
        form.update { it.copy(mode = "NONE") }
        assertTrue(form.previewItems()!!.all { it.repeatRule.isEmpty() }); assertEquals(edited, form.draft.items)
        form.update { it.copy(mode = "CUSTOM") }
        assertEquals(edited, form.previewItems()); assertEquals("내가 편집한 산책", form.payload().list("items")[0].text("title"))
    }
    @Test fun invalidRoutinePreviewIsNotAnInventedScheduleAndDoesNotChangeSubmission() {
        val form = routine(); form.update { it.copy(date = "invalid") }
        val before = form.save()
        assertNull(form.previewItems()); assertNull(form.validation)
        assertEquals(before, form.save()); assertFalse(form.submission.pending)
    }
    @Test fun routinePendingRestoreKeepsExactPayloadAndBlocksEdits() {
        val form = routine(); form.update { it.copy(mode = "CUSTOM",title = "내 루틴") }
        val first = form.begin(1000)!!
        val restored = restore(form)
        assertFalse(restored.editable); assertFalse(restored.submission.busy)
        restored.update { it.copy(title = "다른 요청",mode = "NONE") }; restored.resetItems()
        val same = restored.begin(2000)!!
        assertEquals(first.body,same.body); assertEquals(first.key,same.key)
        assertEquals("내 루틴",restored.draft.title)
    }
    @Test fun routineRestoreRejectsOtherOwnerSourceAndInconsistentReceipt() {
        val form = routine(); form.begin()
        assertNull(RoutineImportState.restore(form.save(),"account-b","routine"))
        assertNull(RoutineImportState.restore(form.save(),owner,"another"))
        val corrupted = JsonParser.parseString(form.save()).asJsonObject
        corrupted.getAsJsonObject("draft").addProperty("title","not the submitted body")
        assertNull(RoutineImportState.restore(corrupted.toString(),owner,"routine"))
        assertFalse(form.save().contains("never-copy-this-field"))
    }
    @Test fun routineExplicitResetUsesCurrentStartAndRejectionRotatesOnlyChangedBody() {
        val form = routine(); form.update { it.copy(mode = "CUSTOM") }; form.updateItem("one") { it.copy(title = "편집") }
        form.update { it.copy(date = "2026-11-03") }; assertEquals("편집",form.draft.items[0].title)
        form.resetItems(); assertEquals("산책",form.draft.items[0].title); assertEquals("2026-11-03",form.draft.items[0].date)
        val first = form.begin()!!; form.submission.failed(first,ApiException(400,"입력 확인"))
        val same = form.begin()!!; assertEquals(first.key,same.key)
        form.submission.failed(same,ApiException(400,"입력 확인"))
        form.update { it.copy(title = "새 이름") }
        assertNotEquals(first.key,form.begin()!!.key)
    }
    @Test fun routineInvalidOrEmptyInputCannotSendAndDeletedSourceStaysDenied() {
        val empty = RoutineImportState.create(owner,json("id" to "empty","title" to "빈 그룹"),zone)
        assertNull(empty.begin())
        val form = routine(); form.update { it.copy(title = " ") }; assertNull(form.begin())
        form.update { it.copy(title = "내 루틴",date = "invalid") }; assertNull(form.begin())
        form.update { it.copy(date = "2026-10-31") }; val request = form.begin()!!
        form.submission.failed(request,ApiException(404,"원본이 없어요."))
        assertTrue(restore(form).submission.denied); assertNull(restore(form).begin())
    }
    @Test fun routineHttpSuccessRequiresNewPrivateGroupOwnedByCurrentUser() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val api = api(server)
            for(body in listOf("{}","{\"id\":\"routine\",\"userId\":\"account-a\",\"visibility\":\"PRIVATE\"}",
                "{\"id\":\"copy\",\"userId\":\"other\",\"visibility\":\"PRIVATE\"}","{\"id\":\"copy\",\"userId\":\"account-a\",\"visibility\":\"PUBLIC\"}")) {
                server.enqueue(MockResponse().setBody(body)); val form = routine(); val request = form.begin()!!
                val failure = runCatching { sendRoutineImport(api,form.id,owner,request,api.sessionVersion) }.exceptionOrNull() as ApiException
                assertEquals(502,failure.status); form.submission.failed(request,failure); assertTrue(form.submission.uncertain)
            }
            server.enqueue(MockResponse().setBody("{\"id\":\"copy\",\"userId\":\"account-a\",\"visibility\":\"PRIVATE\"}"))
            val form = routine(); val request = form.begin()!!
            sendRoutineImport(api,form.id,owner,request,api.sessionVersion); assertTrue(form.submission.succeeded(request))
            assertEquals("routine",source.text("id")); assertEquals(5,server.requestCount)
        }
    }
}
