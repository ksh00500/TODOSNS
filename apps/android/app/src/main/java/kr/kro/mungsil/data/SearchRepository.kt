package kr.kro.mungsil.data

import com.google.gson.JsonObject

data class SearchTag(val id: String, val name: String, val posts: Int)
data class SearchPerson(val id: String, val handle: String, val nickname: String, val rank: String)
data class SearchChallenge(val id: String, val title: String, val description: String, val kind: String, val participants: Int)
data class SearchResultSet(val counts: Map<String, Int>, val users: List<SearchPerson>, val tags: List<SearchTag>,
    val posts: List<JsonObject>, val routines: List<JsonObject>, val challenges: List<SearchChallenge>)
private fun invalidSearch(): Nothing = throw ApiException(502, "검색 응답을 확인하지 못했어요. 다시 불러와주세요.", "SEARCH_RESPONSE_INVALID")
private fun JsonObject.requiredText(name: String): String = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.takeIf { it.isNotBlank() } ?: invalidSearch()
private fun JsonObject.requiredCount(name: String): Int = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull()?.takeIf { it >= 0 } ?: invalidSearch()
private fun JsonObject.requiredRows(name: String): List<JsonObject> {
    val array = get(name)?.takeIf { it.isJsonArray }?.asJsonArray ?: invalidSearch()
    return array.map { if(!it.isJsonObject) invalidSearch() else it.asJsonObject.deepCopy() }.distinctBy { it.requiredText("id") }
}
private fun searchTags(rows: List<JsonObject>) = rows.map { SearchTag(it.requiredText("id"), it.requiredText("name"), it.requiredCount("postCount")) }
fun parseSearchSuggestions(value: JsonObject): List<SearchTag> = searchTags(value.requiredRows("trendingTags"))
fun parseSearchResults(value: JsonObject): SearchResultSet {
    val counts = value.get("counts")?.takeIf { it.isJsonObject }?.asJsonObject ?: invalidSearch()
    return SearchResultSet(listOf("all", "users", "posts", "routines", "tags", "challenges").associateWith { counts.requiredCount(it) },
        value.requiredRows("users").map { SearchPerson(it.requiredText("id"), it.requiredText("handle"), it.requiredText("nickname"), it.requiredText("cloudRank")) },
        searchTags(value.requiredRows("tags")), value.requiredRows("posts"), value.requiredRows("routines"),
        value.requiredRows("challenges").map {
            val kind = it.requiredText("kind"); if(kind !in listOf("OFFICIAL", "COMMUNITY")) invalidSearch()
            val people = it.get("_count")?.takeIf { count -> count.isJsonObject }?.asJsonObject ?: invalidSearch()
            SearchChallenge(it.requiredText("id"), it.requiredText("title"), it.text("description"), kind, people.requiredCount("participants"))
        })
}
interface SearchSource {
    suspend fun results(query: String, authenticated: Boolean): SearchResultSet
    suspend fun suggestions(): List<SearchTag>
}
class SearchRepository(private val api: Api) : SearchSource {
    override suspend fun results(query: String, authenticated: Boolean): SearchResultSet = parseSearchResults(api.request("public/search",
        query = mapOf("query" to query, "limit" to "20"), authenticated = authenticated).obj())
    override suspend fun suggestions(): List<SearchTag> = parseSearchSuggestions(api.request("public/search/suggestions",
        query = mapOf("limit" to "10"), authenticated = false).obj())
}
