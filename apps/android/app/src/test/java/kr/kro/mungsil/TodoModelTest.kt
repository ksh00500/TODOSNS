package kr.kro.mungsil

import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.TodoModel
import kr.kro.mungsil.ui.todoDayPresentation
import org.junit.*
import org.junit.Assert.*
import java.io.IOException
import java.time.*

@OptIn(ExperimentalCoroutinesApi::class)
class TodoModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val date = LocalDate.of(2026, 10, 23)
    private val zone = ZoneId.of("Asia/Seoul")
    private val serverTime = "2026-10-23T09:32:12.345Z"
    private fun row(id: String = "todo", completed: String? = null, title: String = "산책") = TodoRecord.parse(
        json("id" to id, "title" to title, "dueDate" to "2026-10-23T09:00:30.123Z", "completedAt" to completed))
    private inner class Source(var rows: List<TodoRecord> = listOf(row())) : TodoSource {
        val dates = mutableListOf<LocalDate>()
        val keys = mutableListOf<String>()
        var read: suspend (LocalDate) -> List<TodoRecord> = { rows }
        var write: suspend (TodoRecord) -> TodoRecord = { row(it.id, if(it.completedAt == null) serverTime else null) }
        override suspend fun list(date: LocalDate, zone: ZoneId): List<TodoRecord> { dates += date; return read(date) }
        override suspend fun complete(item: TodoRecord, key: String): TodoRecord { keys += key; return write(item) }
    }
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun canonicalServerRowReplacesOptimisticClockAndReachesCallback() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val result = CompletableDeferred<TodoRecord>()
        source.write = { result.await() }
        var callback: TodoRecord? = null
        model.toggle("todo") { callback = it }
        runCurrent()
        assertEquals(setOf("todo"), model.state.value.pending)
        assertNotNull(model.state.value.rows.single().completedAt)
        assertNull(callback)
        result.complete(row(completed = serverTime, title = "서버 제목")); advanceUntilIdle()
        assertEquals(serverTime, model.state.value.rows.single().completedAt)
        assertEquals("서버 제목", model.state.value.rows.single().title)
        assertEquals(model.state.value.rows.single(), callback)
        assertTrue(model.state.value.pending.isEmpty())
    }
    @Test fun failedCompletionRestoresStateAndRetryUsesSameKeyUntilSuccess() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        var fails = true; var callbacks = 0
        source.write = { if(fails) throw IOException(); row(completed = serverTime) }
        model.toggle("todo") { callbacks++ }; advanceUntilIdle()
        assertNull(model.state.value.rows.single().completedAt)
        assertNotNull(model.state.value.error); assertEquals(0, callbacks)
        fails = false
        model.toggle("todo") { callbacks++ }; advanceUntilIdle()
        assertEquals(source.keys[0], source.keys[1]); assertEquals(1, callbacks)
        assertNull(model.state.value.error)
        source.write = { row() }
        model.toggle("todo") {}; advanceUntilIdle()
        assertNotEquals(source.keys[1], source.keys[2]); assertNull(model.state.value.rows.single().completedAt)
        source.write = { row(completed = serverTime) }
        model.toggle("todo") {}; advanceUntilIdle()
        assertNotEquals(source.keys[0], source.keys.last())
    }
    @Test fun rejectedUndoRestoresCompletionAndRetainsErrorThroughQueuedRefresh() = runTest(dispatcher) {
        val source = Source(listOf(row(completed = serverTime))); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>(); source.write = { response.await() }
        var callbacks = 0
        model.toggle("todo") { callbacks++ }; runCurrent()
        model.load(date, zone)
        response.completeExceptionally(ApiException(400, "게시물을 먼저 삭제한 뒤 완료를 취소해주세요.")); advanceUntilIdle()
        assertEquals(serverTime, model.state.value.rows.single().completedAt)
        assertTrue(model.state.value.error!!.contains("게시물"))
        assertEquals(2, source.dates.size); assertEquals(0, callbacks)
        assertTrue(model.state.value.pending.isEmpty())
    }
    @Test fun duplicateTapsAndOtherRowsCannotStartParallelWrites() = runTest(dispatcher) {
        val source = Source(listOf(row(), row("other"))); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>(); source.write = { response.await() }
        var callbacks = 0
        model.toggle("todo") { callbacks++ }; model.toggle("todo") { callbacks++ }; model.toggle("other") { callbacks++ }
        runCurrent(); assertEquals(1, source.keys.size)
        response.complete(row(completed = serverTime)); advanceUntilIdle()
        assertEquals(1, callbacks); assertNull(model.state.value.rows.last().completedAt)
    }
    @Test fun latestDateRequestedDuringWriteLoadsAfterItWithoutPublishingOldDay() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        source.read = { if(it == date) listOf(row()) else listOf(row("new-day")) }
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>(); source.write = { response.await() }
        var callbacks = 0
        model.toggle("todo") { callbacks++ }; runCurrent()
        model.load(date.plusDays(1), zone); model.load(date.plusDays(2), zone)
        assertTrue(model.state.value.rows.isEmpty()); assertTrue(model.state.value.loading)
        response.complete(row(completed = serverTime)); advanceUntilIdle()
        assertEquals(listOf(date, date.plusDays(2)), source.dates)
        assertEquals("new-day", model.state.value.rows.single().id); assertEquals(0, callbacks)
        assertFalse(model.state.value.loading); assertTrue(model.state.value.pending.isEmpty())
    }
    @Test fun repeatedRefreshDuringMutationIsCoalescedAndRunsAfterCanonicalCallback() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>(); source.write = { response.await() }
        var callbackTime: String? = null
        model.toggle("todo") { callbackTime = it.completedAt; assertTrue(model.state.value.pending.isEmpty()) }
        runCurrent(); repeat(3) { model.load(date, zone) }
        source.rows = listOf(row(completed = serverTime))
        response.complete(source.rows.single()); advanceUntilIdle()
        assertEquals(serverTime, callbackTime); assertEquals(listOf(date, date), source.dates)
        assertEquals(serverTime, model.state.value.rows.single().completedAt)
    }
    @Test fun staleNonCancellableReadCannotOverwriteNewDate() = runTest(dispatcher) {
        val source = Source(); val first = CompletableDeferred<List<TodoRecord>>(); val model = TodoModel(source)
        source.read = { if(it == date) withContext(NonCancellable) { first.await() } else listOf(row("latest")) }
        model.load(date, zone); runCurrent(); model.load(date.plusDays(1), zone); runCurrent()
        first.complete(listOf(row("old"))); advanceUntilIdle()
        assertEquals("latest", model.state.value.rows.single().id)
    }
    @Test fun clearingModelDuringDelayedWriteCannotInvokeOldScreensCallback() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source); val store = ViewModelStore()
        store.put("todos", model)
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>()
        source.write = { withContext(NonCancellable) { response.await() } }
        var callbacks = 0
        model.toggle("todo") { callbacks++ }; runCurrent(); store.clear()
        response.complete(row(completed = serverTime)); advanceUntilIdle()
        assertEquals(0, callbacks); assertTrue(model.state.value.pending.isEmpty())
    }
    @Test fun confirmedOppositeActionDiscardsOldUncertainRetryKey() = runTest(dispatcher) {
        val source = Source(listOf(row(completed = serverTime))); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        source.write = { throw IOException() }
        model.toggle("todo") {}; advanceUntilIdle()
        val uncertainUndoKey = source.keys.single()
        source.rows = listOf(row()) // A later authoritative read confirms the uncertain undo succeeded.
        model.retry(); advanceUntilIdle()
        source.write = { row(completed = serverTime) }
        model.toggle("todo") {}; advanceUntilIdle()
        source.write = { row() }
        model.toggle("todo") {}; advanceUntilIdle()
        assertNotEquals(uncertainUndoKey, source.keys.last())
    }
    @Test fun firstFailureIsUnknownAndSuccessfulEmptyReadIsKnownEmpty() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        source.read = { throw IOException() }
        model.load(date, zone); advanceUntilIdle()
        assertFalse(model.state.value.hasLoaded); assertNotNull(model.state.value.loadError)
        assertNull(model.state.value.lastLoadedAt); assertFalse(todoDayPresentation(model.state.value, emptyList(), true).empty)
        source.read = { emptyList() }
        model.retry(); advanceUntilIdle()
        assertTrue(model.state.value.hasLoaded); assertNull(model.state.value.error)
        assertTrue(todoDayPresentation(model.state.value, emptyList(), true).empty)
    }
    @Test fun refreshFailureKeepsRowsAndLastConfirmationAndBlocksStaleWrites() = runTest(dispatcher) {
        val checked = Instant.parse("2026-10-23T01:02:03Z")
        val source = Source(listOf(row(), row("done", serverTime)))
        val model = TodoModel(source, Clock.fixed(checked, ZoneOffset.UTC))
        model.load(date, zone); advanceUntilIdle()
        val original = model.state.value.rows
        val response = CompletableDeferred<List<TodoRecord>>()
        source.read = { response.await() }
        model.retry(); runCurrent()
        assertTrue(model.state.value.hasLoaded); assertTrue(model.state.value.loading)
        assertEquals(original, model.state.value.rows); assertFalse(model.state.value.canWrite)
        response.completeExceptionally(IOException()); advanceUntilIdle()
        assertEquals(original, model.state.value.rows); assertEquals(checked, model.state.value.lastLoadedAt)
        assertTrue(model.state.value.hasLoaded); assertNotNull(model.state.value.loadError)
        model.toggle("todo") { fail("Stale rows must be refreshed before writing") }; runCurrent()
        assertTrue(source.keys.isEmpty())
        source.read = { listOf(row("fresh")) }
        model.retry(); advanceUntilIdle()
        assertNull(model.state.value.loadError); assertTrue(model.state.value.canWrite)
        assertEquals("fresh", model.state.value.rows.single().id)
    }
    @Test fun refreshFailureOfPreviouslyEmptyListIsNotFreshEmptyState() = runTest(dispatcher) {
        val source = Source(emptyList()); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        source.read = { throw IOException() }
        model.retry(); advanceUntilIdle()
        assertTrue(model.state.value.hasLoaded); assertTrue(model.state.value.rows.isEmpty())
        assertNotNull(model.state.value.loadError)
        assertFalse(todoDayPresentation(model.state.value, emptyList(), true).empty)
    }
    @Test fun permissionLossClearsPreviouslyLoadedPrivateRows() = runTest(dispatcher) {
        for(status in listOf(401, 403)) {
            val source = Source(); val model = TodoModel(source)
            model.load(date, zone); advanceUntilIdle()
            source.read = { throw ApiException(status, "다시 확인해주세요.") }
            model.retry(); advanceUntilIdle()
            assertTrue(model.state.value.rows.isEmpty()); assertFalse(model.state.value.hasLoaded)
            assertNull(model.state.value.lastLoadedAt); assertFalse(model.state.value.canWrite)
            assertNotNull(model.state.value.loadError)
        }
    }
    @Test fun newHeadingHidesPreviousDateOrTimezoneBeforeLoadEffectRuns() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val known = model.state.value
        assertEquals(known, known.forQuery(date, zone))
        for(hidden in listOf(known.forQuery(date.plusDays(1), zone), known.forQuery(date, ZoneId.of("UTC")))) {
            assertTrue(hidden.rows.isEmpty()); assertFalse(hidden.hasLoaded)
            assertNull(hidden.lastLoadedAt); assertFalse(hidden.canWrite)
        }
    }
    @Test fun dateChangeClearsPreviousFailureAndConfirmationWhileNewReadWaits() = runTest(dispatcher) {
        val source = Source(); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        source.read = { throw IOException() }; model.retry(); advanceUntilIdle()
        val response = CompletableDeferred<List<TodoRecord>>(); source.read = { response.await() }
        model.load(date.plusDays(1), zone); runCurrent()
        assertFalse(model.state.value.hasLoaded); assertNull(model.state.value.error)
        assertNull(model.state.value.lastLoadedAt); assertEquals(date.plusDays(1), model.state.value.date)
        response.complete(emptyList()); advanceUntilIdle()
        assertTrue(model.state.value.hasLoaded)
    }
    @Test fun queuedRefreshKeepsMutationAndReadFailuresDistinct() = runTest(dispatcher) {
        val source = Source(listOf(row(completed = serverTime))); val model = TodoModel(source)
        model.load(date, zone); advanceUntilIdle()
        val response = CompletableDeferred<TodoRecord>(); source.write = { response.await() }
        model.toggle("todo") {}; runCurrent(); model.load(date, zone)
        source.read = { throw IOException() }
        response.completeExceptionally(ApiException(400, "게시물을 먼저 삭제해주세요.")); advanceUntilIdle()
        assertEquals("게시물을 먼저 삭제해주세요.", model.state.value.mutationError)
        assertNotNull(model.state.value.loadError); assertEquals(serverTime, model.state.value.rows.single().completedAt)
        assertTrue(model.state.value.error!!.contains("게시물")); assertFalse(model.state.value.canWrite)
    }
}
