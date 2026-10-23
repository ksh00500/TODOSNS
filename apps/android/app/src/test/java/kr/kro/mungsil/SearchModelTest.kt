package kr.kro.mungsil

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.SearchModel
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class SearchModelTest {
    private val dispatcher = StandardTestDispatcher()
    private fun payload() = json("counts" to json("all" to 1, "users" to 1, "posts" to 0, "routines" to 0, "tags" to 0, "challenges" to 0),
        "users" to listOf(json("id" to "person", "nickname" to "구름", "handle" to "cloud", "cloudRank" to "조각구름")),
        "posts" to emptyList<String>(), "routines" to emptyList<String>(), "tags" to emptyList<String>(), "challenges" to emptyList<String>())
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun malformedCountsAndMissingArraysAreErrorsNotEmptyResults() {
        for(bad in listOf(payload().apply { child("counts").remove("users") }, payload().apply { remove("routines") },
            payload().apply { child("counts").addProperty("all", -1) }, payload().apply { child("counts").addProperty("posts", "0") },
            payload().apply { list("users").first().remove("handle") })) {
            assertThrows(ApiException::class.java) { parseSearchResults(bad) }
        }
        assertThrows(ApiException::class.java) { parseSearchSuggestions(json()) }
        assertEquals(emptyList<SearchTag>(), parseSearchSuggestions(json("trendingTags" to emptyList<String>())))
    }
    @Test fun repeatedIdentitiesDoNotMakeDuplicateRowsAndCountsKeepServerTotals() {
        val source = payload(); source.getAsJsonArray("users").add(source.list("users").first().deepCopy())
        source.child("counts").addProperty("users", 99)
        val result = parseSearchResults(source)
        assertEquals(1, result.users.size); assertEquals(99, result.counts.getValue("users"))
    }
    @Test fun olderNonCancellableSearchCannotReplaceNewResultOrClearedQuery() = runTest(dispatcher) {
        val first = CompletableDeferred<SearchResultSet>(); val second = CompletableDeferred<SearchResultSet>()
        val result = parseSearchResults(payload())
        val source = object : SearchSource {
            override suspend fun suggestions() = emptyList<SearchTag>()
            override suspend fun results(query: String, authenticated: Boolean) = withContext(NonCancellable) { if(query == "old") first.await() else second.await() }
        }
        val model = SearchModel(source)
        model.search("old", false); runCurrent(); model.search("new", true); runCurrent()
        first.complete(result); runCurrent()
        assertEquals("new", model.state.value.query); assertNull(model.state.value.results.data)
        model.search("", true); second.complete(result); advanceUntilIdle()
        assertEquals("", model.state.value.query); assertNull(model.state.value.results.data); assertFalse(model.state.value.results.loading)
    }
    @Test fun failedSearchAndSuggestionsRemainErrorsUntilSuccessfulRetry() = runTest(dispatcher) {
        var fail = true
        val source = object : SearchSource {
            override suspend fun results(query: String, authenticated: Boolean): SearchResultSet { if(fail) throw ApiException(503, "검색 연결을 확인해주세요."); return parseSearchResults(payload()) }
            override suspend fun suggestions(): List<SearchTag> { if(fail) throw ApiException(503, "추천 연결을 확인해주세요."); return listOf(SearchTag("tag", "산책", 2)) }
        }
        val model = SearchModel(source)
        model.search("산책", true); model.suggestions(); advanceUntilIdle()
        assertNotNull(model.state.value.results.error); assertNull(model.state.value.results.data); assertNotNull(model.state.value.suggestions.error)
        fail = false; model.search("산책", true); model.suggestions(); advanceUntilIdle()
        assertNull(model.state.value.results.error); assertEquals(1, model.state.value.results.data!!.users.size)
        assertEquals("산책", model.state.value.suggestions.data!!.first().name)
    }
}
