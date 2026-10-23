package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*
import java.time.*

data class TodoUiState(val rows: List<TodoRecord> = emptyList(), val loading: Boolean = true, val error: String? = null, val pending: Set<String> = emptySet())
class TodoModel(private val repository: TodoSource) : ViewModel() {
    private val mutable = MutableStateFlow(TodoUiState())
    val state = mutable.asStateFlow()
    private var query: Pair<LocalDate, ZoneId>? = null
    private var queuedRefresh: Pair<LocalDate, ZoneId>? = null
    private var job: Job? = null
    private var epoch = 0L
    private var mutationError: String? = null
    private val retryKeys = mutableMapOf<Pair<String, Boolean>, String>()
    fun load(date: LocalDate, zone: ZoneId) {
        val requested = date to zone
        if(mutable.value.pending.isNotEmpty()) {
            queuedRefresh = requested
            if(query != requested) {
                query = requested
                epoch++
                job?.cancel()
                // Do not display the previous day's rows under a new date heading.
                mutable.value = TodoUiState(pending = mutable.value.pending)
            }
            return
        }
        val same = query == requested
        query = requested
        val generation = ++epoch
        job?.cancel()
        mutable.value = TodoUiState(rows = if(same) mutable.value.rows else emptyList(), error = mutationError)
        job = viewModelScope.launch {
            try {
                val rows = repository.list(date, zone)
                currentCoroutineContext().ensureActive()
                if(generation == epoch) mutable.value = TodoUiState(rows.toList(), false, mutationError)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(generation == epoch) mutable.value = mutable.value.copy(loading = false,
                    error = listOfNotNull(mutationError, friendlyError(e)).distinct().joinToString("\n"))
            }
        }
    }
    fun retry() { mutationError = null; query?.let { load(it.first, it.second) } }
    fun toggle(id: String, saved: (TodoRecord) -> Unit) {
        val before = mutable.value.rows.firstOrNull { it.id == id } ?: return
        if(mutable.value.pending.isNotEmpty() || mutable.value.loading) return
        val generation = epoch
        val operation = id to (before.completedAt == null)
        val key = retryKeys.getOrPut(operation) { newKey() }
        mutationError = null
        val optimistic = before.withCompletion(before.completedAt == null)
        mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) optimistic else it }, pending = setOf(id), error = null)
        viewModelScope.launch {
            var confirmed: TodoRecord? = null
            try {
                val canonical = repository.complete(before, key)
                currentCoroutineContext().ensureActive()
                retryKeys.keys.removeAll { it.first == id }
                if(generation == epoch) {
                    mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) canonical else it })
                    confirmed = canonical
                }
            } catch(e: CancellationException) {
                if(generation == epoch) mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) before else it })
                throw e
            } catch(e: Exception) {
                if(generation == epoch) {
                    mutationError = friendlyError(e)
                    mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) before else it }, error = mutationError)
                }
            } finally {
                mutable.value = mutable.value.copy(pending = emptySet())
                val refresh = queuedRefresh
                queuedRefresh = null
                if(currentCoroutineContext().isActive) {
                    // A UI callback failure must not roll back a successful server mutation.
                    try { confirmed?.let(saved) }
                    finally { refresh?.let { load(it.first, it.second) } }
                }
            }
        }
    }
}
