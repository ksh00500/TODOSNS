package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*
import java.time.*

data class TodoUiState(val rows: List<TodoRecord> = emptyList(), val loading: Boolean = true, val error: String? = null, val pending: Set<String> = emptySet())
class TodoModel(private val repository: TodoRepository) : ViewModel() {
    private val mutable = MutableStateFlow(TodoUiState())
    val state = mutable.asStateFlow()
    private var query: Pair<LocalDate, ZoneId>? = null
    private var job: Job? = null
    private var epoch = 0L
    private val retryKeys = mutableMapOf<Pair<String, Boolean>, String>()
    fun load(date: LocalDate, zone: ZoneId) {
        if(mutable.value.pending.isNotEmpty()) return
        val same = query == (date to zone)
        query = date to zone
        val generation = ++epoch
        job?.cancel()
        mutable.value = TodoUiState(rows = if(same) mutable.value.rows else emptyList())
        job = viewModelScope.launch {
            try { val rows = repository.list(date, zone); if(generation == epoch) mutable.value = TodoUiState(rows, false) }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(generation == epoch) mutable.value = mutable.value.copy(loading = false, error = friendlyError(e)) }
        }
    }
    fun retry() { query?.let { load(it.first, it.second) } }
    fun toggle(id: String, saved: (TodoRecord) -> Unit) {
        val before = mutable.value.rows.firstOrNull { it.id == id } ?: return
        if(mutable.value.pending.isNotEmpty() || mutable.value.loading) return
        val generation = epoch
        val optimistic = before.withCompletion(before.completedAt == null)
        mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) optimistic else it }, pending = setOf(id), error = null)
        viewModelScope.launch {
            try {
                repository.complete(before, retryKeys.getOrPut(id to (before.completedAt == null)) { newKey() })
                retryKeys.remove(id to (before.completedAt == null))
                if(generation == epoch) { mutable.value = mutable.value.copy(pending = emptySet()); saved(optimistic) }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(generation == epoch) mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) before else it }, pending = emptySet(), error = friendlyError(e))
            }
        }
    }
}
