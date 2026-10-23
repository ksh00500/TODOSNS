package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*
import java.time.*

data class HistoryUiState(
    val selection: HistoryRange? = null, val contextZone: String? = null,
    val rows: List<HistoryRecord> = emptyList(), val range: HistoryRange? = null, val zone: ZoneId? = null,
    val total: Long? = null, val nextCursor: String? = null, val loading: Boolean = true, val loadingMore: Boolean = false,
    val error: String? = null, val moreError: String? = null, val notice: String? = null, val checkedAt: Instant? = null,
) {
    val hasData get() = total != null
    fun forQuery(selection: HistoryRange?, zone: ZoneId) = if(this.selection == selection && contextZone == zone.id) this
        else HistoryUiState(selection = selection, contextZone = zone.id)
}

class HistoryModel(private val source: HistorySource, private val clock: Clock = Clock.systemUTC()) : ViewModel() {
    private val mutable = MutableStateFlow(HistoryUiState())
    val state = mutable.asStateFlow()
    private var query: Pair<HistoryRange?, ZoneId>? = null
    private var job: Job? = null
    private var generation = 0L
    private val consumedCursors = mutableSetOf<String>()

    fun load(selection: HistoryRange?, zone: ZoneId) = first(selection, zone)
    fun refresh() { query?.let { first(it.first, it.second) } }
    private fun first(selection: HistoryRange?, zone: ZoneId, notice: String? = null, discard: Boolean = false) {
        val same = query == (selection to zone)
        query = selection to zone
        val request = ++generation
        job?.cancel(); consumedCursors.clear()
        mutable.value = if(same && !discard) mutable.value.copy(loading = true, loadingMore = false, error = null, moreError = null, nextCursor = null, notice = notice)
            else HistoryUiState(selection = selection, contextZone = zone.id, notice = notice)
        job = viewModelScope.launch {
            try {
                val page = source.page(selection)
                currentCoroutineContext().ensureActive()
                if(request == generation) mutable.value = HistoryUiState(selection, zone.id, page.rows.toList(), page.range, page.zone,
                    page.total, page.nextCursor, loading = false, notice = notice, checkedAt = clock.instant())
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(request == generation) fail(e, more = false) }
        }
    }
    fun more() {
        val before = mutable.value
        val cursor = before.nextCursor ?: return
        val range = before.range ?: return
        if(before.loading || before.loadingMore || before.error != null) return
        val request = generation
        mutable.value = before.copy(loadingMore = true, moreError = null)
        job = viewModelScope.launch {
            try {
                val page = source.page(range, cursor)
                currentCoroutineContext().ensureActive()
                if(request != generation) return@launch
                if(page.zone != before.zone) { restart("계정 시간대가 바뀌어 처음부터 다시 확인하고 있어요."); return@launch }
                if(page.range != range || page.nextCursor == cursor || page.nextCursor?.let { it in consumedCursors } == true) invalidHistory()
                val rows = (before.rows + page.rows).associateBy { it.id }.values.sortedWith(compareByDescending<HistoryRecord> { it.completedAt }.thenByDescending { it.id })
                if(rows.size.toLong() > page.total) {
                    restart("기록이 바뀌어 처음부터 다시 확인하고 있어요.")
                    return@launch
                }
                consumedCursors += cursor
                mutable.value = before.copy(rows = rows.toList(), total = page.total, nextCursor = page.nextCursor,
                    loadingMore = false, moreError = null, checkedAt = clock.instant(),
                    notice = if(page.total != before.total) "조회 중 기록이 바뀌었어요. 새로고침하면 최신 목록을 확인할 수 있어요." else before.notice)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(request == generation) {
                    if(e is ApiException && e.status == 400 && e.code == "TODO_HISTORY_CURSOR_INVALID") restart("기록 조회 조건이 바뀌어 처음부터 다시 확인하고 있어요.")
                    else fail(e, more = true)
                }
            }
        }
    }
    private fun restart(message: String) { query?.let { first(it.first, it.second, message, discard = true) } }
    private fun fail(error: Exception, more: Boolean) {
        val message = when(error) {
            is ApiException -> friendlyError(error)
            is java.io.IOException -> "연결을 확인한 뒤 기록을 다시 불러와주세요."
            else -> "기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요."
        }
        if(error is ApiException && error.status in listOf(401, 403)) {
            val current = mutable.value
            consumedCursors.clear()
            mutable.value = HistoryUiState(selection = current.selection, contextZone = current.contextZone, loading = false, error = message)
        } else mutable.value = if(more) mutable.value.copy(loadingMore = false, moreError = message)
            else mutable.value.copy(loading = false, error = message)
    }
}
