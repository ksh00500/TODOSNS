package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*
import java.time.*

data class TodoUiState(
    val rows: List<TodoRecord> = emptyList(), val loading: Boolean = true,
    val loadError: String? = null, val mutationError: String? = null,
    val pending: Set<String> = emptySet(), val hasLoaded: Boolean = false,
    val lastLoadedAt: Instant? = null, val date: LocalDate? = null, val zoneId: String? = null,
) {
    val error: String? get() = listOfNotNull(mutationError, loadError).distinct().joinToString("\n").ifEmpty { null }
    val canWrite: Boolean get() = hasLoaded && !loading && loadError == null && pending.isEmpty()
    // A recomposition can precede the load effect for the new heading.
    fun forQuery(date: LocalDate, zone: ZoneId): TodoUiState =
        if(this.date == date && zoneId == zone.id) this else TodoUiState(date = date, zoneId = zone.id)
}
class TodoModel(private val repository: TodoSource, private val clock: Clock = Clock.systemUTC()) : ViewModel() {
    private val mutable = MutableStateFlow(TodoUiState())
    val state = mutable.asStateFlow()
    private var query: Pair<LocalDate, ZoneId>? = null
    private var queuedRefresh: Pair<LocalDate, ZoneId>? = null
    private var job: Job? = null
    private var epoch = 0L
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
                mutable.value = TodoUiState(pending = mutable.value.pending, date = date, zoneId = zone.id)
            }
            return
        }
        val same = query == requested
        query = requested
        val generation = ++epoch
        job?.cancel()
        mutable.value = if(same) mutable.value.copy(loading = true, loadError = null)
            else TodoUiState(date = date, zoneId = zone.id)
        job = viewModelScope.launch {
            try {
                val rows = repository.list(date, zone)
                currentCoroutineContext().ensureActive()
                if(generation == epoch) mutable.value = mutable.value.copy(rows = rows.toList(), loading = false,
                    loadError = null, hasLoaded = true, lastLoadedAt = clock.instant())
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(generation == epoch) {
                    val denied = e is ApiException && e.status in listOf(401, 403)
                    mutable.value = if(denied) TodoUiState(loading = false, loadError = friendlyError(e), date = date, zoneId = zone.id)
                        else mutable.value.copy(loading = false, loadError = friendlyError(e))
                }
            }
        }
    }
    fun retry() { mutable.value = mutable.value.copy(mutationError = null); query?.let { load(it.first, it.second) } }
    fun toggle(id: String, saved: (TodoRecord) -> Unit) {
        val before = mutable.value.rows.firstOrNull { it.id == id } ?: return
        if(!mutable.value.canWrite) return
        val generation = epoch
        val operation = id to (before.completedAt == null)
        val key = retryKeys.getOrPut(operation) { newKey() }
        val optimistic = before.withCompletion(before.completedAt == null)
        mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) optimistic else it }, pending = setOf(id), mutationError = null)
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
                    mutable.value = mutable.value.copy(rows = mutable.value.rows.map { if(it.id == id) before else it }, mutationError = friendlyError(e))
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
