package kr.kro.mungsil

import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.HistoryModel
import org.junit.*
import org.junit.Assert.*
import java.io.IOException
import java.time.*

@OptIn(ExperimentalCoroutinesApi::class)
class HistoryModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val zone = ZoneId.of("Asia/Seoul")
    private val range = HistoryRange(LocalDate.of(2026,10,17),LocalDate.of(2026,10,23))
    private val checked = Instant.parse("2026-10-23T04:00:00Z")
    private fun row(id: String, title: String = id) = HistoryRecord(id,title,"메모 $id",Instant.parse("2026-10-10T00:00:00Z"),Instant.parse("2026-10-23T03:00:00Z"),"생활","","PRIVATE")
    private fun page(rows: List<HistoryRecord> = listOf(row("b")), cursor: String? = null, total: Long = rows.size.toLong(), r: HistoryRange = range, z: ZoneId = zone) = HistoryPage(rows,cursor,total,r,z)
    private inner class Source : HistorySource {
        val calls = mutableListOf<Pair<HistoryRange?,String?>>()
        var read: suspend (HistoryRange?,String?) -> HistoryPage = { _,_ -> page() }
        override suspend fun page(range: HistoryRange?, cursor: String?, limit: Int): HistoryPage { calls += range to cursor; return read(range,cursor) }
    }
    private fun model(source: Source) = HistoryModel(source,Clock.fixed(checked,ZoneOffset.UTC))
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun initialErrorIsNotEmptyAndConfirmedTotalIsNotPageLength() = runTest(dispatcher) {
        val source=Source(); val model=model(source)
        source.read={_,_->throw IOException()}; model.load(null,zone); advanceUntilIdle()
        assertNull(model.state.value.total); assertNotNull(model.state.value.error)
        source.read={_,_->page(total=55)};model.refresh();advanceUntilIdle()
        assertEquals(55L,model.state.value.total);assertEquals(1,model.state.value.rows.size);assertEquals(checked,model.state.value.checkedAt)
        source.read={_,_->page(emptyList())};model.refresh();advanceUntilIdle()
        assertEquals(0L,model.state.value.total);assertTrue(model.state.value.rows.isEmpty());assertNull(model.state.value.error)
    }
    @Test fun moreFailureKeepsRowsAndCursorAndRetriesSamePinnedRange() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(listOf(row("c"),row("b")),"next",3)};model.load(null,zone);advanceUntilIdle()
        source.read={_,_->throw IOException()};model.more();advanceUntilIdle()
        assertEquals(2,model.state.value.rows.size);assertEquals("next",model.state.value.nextCursor)
        assertNotNull(model.state.value.moreError);assertNull(model.state.value.error)
        source.read={_,_->page(listOf(row("a")),total=3)};model.more();advanceUntilIdle()
        assertEquals(listOf("c","b","a"),model.state.value.rows.map { it.id });assertNull(model.state.value.moreError)
        assertEquals(range to "next",source.calls[1]);assertEquals(source.calls[1],source.calls[2])
        model.refresh();advanceUntilIdle();assertEquals(null to null,source.calls.last())
    }
    @Test fun overlappingPagesUpdateByIdAndUseLatestWholeTotal() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(listOf(row("c"),row("b")),"next",5)};model.load(range,zone);advanceUntilIdle()
        source.read={_,_->page(listOf(row("b","수정된 제목"),row("a")),total=4)};model.more();advanceUntilIdle()
        assertEquals(listOf("c","b","a"),model.state.value.rows.map { it.id })
        assertEquals("수정된 제목",model.state.value.rows[1].title);assertEquals(4L,model.state.value.total);assertNotNull(model.state.value.notice)
    }
    @Test fun invalidCursorDropsOldRowsAndRestartsOnlyOnceEvenWhenReloadFails() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(cursor="next",total=3)};model.load(range,zone);advanceUntilIdle()
        val reload=CompletableDeferred<HistoryPage>()
        source.read={_,cursor->if(cursor!=null) throw ApiException(400,"다시 확인","TODO_HISTORY_CURSOR_INVALID") else reload.await()}
        model.more();runCurrent()
        assertTrue(model.state.value.rows.isEmpty());assertNull(model.state.value.total);assertTrue(model.state.value.loading)
        reload.completeExceptionally(IOException());advanceUntilIdle()
        assertEquals(3,source.calls.size);assertNotNull(model.state.value.error);assertFalse(model.state.value.loading)
    }
    @Test fun changedTimezoneOrLowerTotalRestartsInsteadOfAppendingIncompatibleRows() = runTest(dispatcher) {
        for(changeZone in listOf(true,false)) {
            val source=Source();val model=model(source)
            source.read={_,_->page(cursor="next",total=3)};model.load(range,zone);advanceUntilIdle()
            source.read={_,cursor->if(cursor!=null) page(emptyList(),total=0,z=if(changeZone) ZoneId.of("UTC") else zone) else page(emptyList())}
            model.more();advanceUntilIdle()
            assertEquals(3,source.calls.size);assertEquals(0L,model.state.value.total);assertTrue(model.state.value.rows.isEmpty());assertNotNull(model.state.value.notice)
        }
    }
    @Test fun refreshFailurePreservesLastDataButSuccessReplacesDeletedRows() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(cursor="next",total=3)};model.load(range,zone);advanceUntilIdle()
        source.read={_,_->throw IOException()};model.refresh();advanceUntilIdle()
        assertEquals(checked,model.state.value.checkedAt);assertEquals(listOf("b"),model.state.value.rows.map { it.id })
        assertNull(model.state.value.nextCursor);assertNotNull(model.state.value.error)
        model.more();advanceUntilIdle();assertEquals(2,source.calls.size)
        source.read={_,_->page(emptyList())};model.refresh();advanceUntilIdle()
        assertTrue(model.state.value.rows.isEmpty());assertEquals(0L,model.state.value.total)
    }
    @Test fun periodChangeIgnoresDelayedNonCancellableOldPage() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(cursor="next",total=3)};model.load(range,zone);advanceUntilIdle()
        val pending=CompletableDeferred<HistoryPage>()
        val other=HistoryRange(range.from.minusDays(1),range.to)
        source.read={_,cursor->if(cursor!=null) withContext(NonCancellable){pending.await()} else page(listOf(row("new")),r=other)}
        model.more();runCurrent()
        model.load(other,zone);runCurrent();pending.complete(page(listOf(row("old")),total=3));advanceUntilIdle()
        assertEquals(listOf("new"),model.state.value.rows.map { it.id });assertEquals(other,model.state.value.selection)
        assertFalse(model.state.value.loadingMore)
    }
    @Test fun modelClearAndNewQueryMaskCannotExposePreviousRows() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        model.load(range,zone);advanceUntilIdle()
        val before=model.state.value
        assertTrue(before.forQuery(null,zone).rows.isEmpty());assertNull(before.forQuery(range,ZoneId.of("UTC")).total)
        val store=ViewModelStore();store.put("history",model)
        val pending=CompletableDeferred<HistoryPage>();source.read={_,_->withContext(NonCancellable){pending.await()}}
        model.refresh();runCurrent();store.clear();pending.complete(page(listOf(row("late"))));advanceUntilIdle()
        assertFalse(model.state.value.rows.any { it.id=="late" })
    }
    @Test fun lostPermissionClearsRowsTotalsAndCursorOnFirstOrFollowingRead() = runTest(dispatcher) {
        for(status in listOf(401,403)) for(more in listOf(true,false)) {
            val source=Source();val model=model(source)
            source.read={_,_->page(cursor="next",total=3)};model.load(range,zone);advanceUntilIdle()
            source.read={_,_->throw ApiException(status,"로그인 상태 확인")}
            if(more)model.more() else model.refresh();advanceUntilIdle()
            assertTrue(model.state.value.rows.isEmpty());assertNull(model.state.value.total);assertNull(model.state.value.nextCursor);assertNull(model.state.value.checkedAt)
            assertNotNull(model.state.value.error)
        }
    }
    @Test fun duplicateMoreAndCursorCycleCannotStartUnboundedRequests() = runTest(dispatcher) {
        val source=Source();val model=model(source)
        source.read={_,_->page(cursor="a",total=5)};model.load(range,zone);advanceUntilIdle()
        val pending=CompletableDeferred<HistoryPage>();source.read={_,_->pending.await()}
        model.more();model.more();runCurrent();assertEquals(2,source.calls.size)
        pending.complete(page(listOf(row("a")),"b",5));advanceUntilIdle()
        source.read={_,_->page(listOf(row("z")),"a",5)};model.more();advanceUntilIdle()
        assertNotNull(model.state.value.moreError);assertEquals("b",model.state.value.nextCursor);assertFalse(model.state.value.loadingMore)
        assertEquals(3,source.calls.size)
    }
}
