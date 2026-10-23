package kr.kro.mungsil

import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.TodoModel
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
}
