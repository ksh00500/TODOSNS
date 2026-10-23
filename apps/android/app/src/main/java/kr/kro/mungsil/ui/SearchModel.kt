package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*

data class SearchSection<T>(val data: T? = null, val loading: Boolean = false, val error: String? = null)
data class SearchState(val query: String = "", val results: SearchSection<SearchResultSet> = SearchSection(), val suggestions: SearchSection<List<SearchTag>> = SearchSection())
class SearchModel(private val source: SearchSource) : ViewModel() {
    private val mutable = MutableStateFlow(SearchState())
    val state = mutable.asStateFlow()
    private var resultJob: Job? = null
    private var suggestionJob: Job? = null
    private var resultGeneration = 0L
    private var suggestionGeneration = 0L
    fun search(query: String, authenticated: Boolean) {
        val current = ++resultGeneration
        resultJob?.cancel()
        mutable.value = mutable.value.copy(query = query, results = SearchSection(loading = query.isNotBlank()))
        if(query.isBlank()) return
        resultJob = viewModelScope.launch {
            try {
                val data = source.results(query, authenticated)
                if(current == resultGeneration) mutable.value = mutable.value.copy(results = SearchSection(data))
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == resultGeneration) mutable.value = mutable.value.copy(results = SearchSection(error = friendlyError(e))) }
        }
    }
    fun suggestions() {
        val current = ++suggestionGeneration
        suggestionJob?.cancel()
        mutable.value = mutable.value.copy(suggestions = SearchSection(loading = true))
        suggestionJob = viewModelScope.launch {
            try {
                val data = source.suggestions()
                if(current == suggestionGeneration) mutable.value = mutable.value.copy(suggestions = SearchSection(data))
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == suggestionGeneration) mutable.value = mutable.value.copy(suggestions = SearchSection(error = friendlyError(e))) }
        }
    }
}
