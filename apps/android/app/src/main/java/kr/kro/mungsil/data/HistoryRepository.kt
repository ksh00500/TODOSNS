package kr.kro.mungsil.data

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.time.*
import java.time.temporal.ChronoUnit

data class HistoryRange(val from: LocalDate, val to: LocalDate) {
    init { require(from.year in 1..9999 && to.year in 1..9999 && ChronoUnit.DAYS.between(from, to) in 0..89) }
    companion object {
        fun recent(zone: ZoneId, clock: Clock = Clock.systemUTC()) = clock.instant().atZone(zone).toLocalDate().let { HistoryRange(it.minusDays(6), it) }
    }
}
data class HistoryRecord(val id: String, val title: String, val notes: String, val dueAt: Instant,
    val completedAt: Instant, val category: String, val repeatRule: String, val visibility: String)
data class HistoryPage(val rows: List<HistoryRecord>, val nextCursor: String?, val total: Long, val range: HistoryRange, val zone: ZoneId)
interface HistorySource { suspend fun page(range: HistoryRange?, cursor: String? = null, limit: Int = 20): HistoryPage }

internal fun invalidHistory(): Nothing = throw ApiException(502, "완료 기록을 확인하지 못했어요. 다시 불러와주세요.", "HISTORY_RESPONSE_INVALID")

class HistoryRepository(private val api: Api, private val sessionVersion: Long = api.sessionVersion) : HistorySource {
    override suspend fun page(range: HistoryRange?, cursor: String?, limit: Int): HistoryPage {
        require(limit in 1..50 && (cursor == null || range != null))
        val query = buildMap {
            put("limit", limit.toString())
            range?.let { put("fromDate", it.from.toString()); put("toDate", it.to.toString()) }
            cursor?.let { put("cursor", it) }
        }
        val response = try { api.request("todos/history", query = query, expectedSessionVersion = sessionVersion) }
            catch(e: ApiException) { if(e.status == 404) throw ApiException(404, "서버에서 완료 기록을 아직 제공하지 않아요. 잠시 후 다시 확인해주세요."); else throw e }
        return parseHistoryPage(response, range, cursor, limit)
    }
}

internal fun parseHistoryPage(response: JsonElement, requested: HistoryRange?, cursor: String?, limit: Int): HistoryPage = try {
    if(!response.isJsonObject) invalidHistory()
    val data = response.asJsonObject
    fun JsonObject.string(key: String): String = get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString ?: invalidHistory()
    fun JsonObject.nonempty(key: String) = string(key).takeIf(String::isNotBlank) ?: invalidHistory()
    fun JsonObject.optional(key: String): String = get(key)?.takeUnless { it.isJsonNull }?.let { if(!it.isJsonPrimitive || !it.asJsonPrimitive.isString) invalidHistory(); it.asString }.orEmpty()
    fun date(key: String): LocalDate {
        val value = data.string(key)
        if(!value.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) invalidHistory()
        return LocalDate.parse(value)
    }
    val range = HistoryRange(date("fromDate"), date("toDate"))
    if(requested != null && requested != range || requested == null && ChronoUnit.DAYS.between(range.from, range.to) != 6L) invalidHistory()
    val zone = ZoneId.of(data.nonempty("timezone"))
    val totalValue = data.get("total")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber } ?: invalidHistory()
    val total = totalValue.asBigDecimal.longValueExact().takeIf { it in 0..9_007_199_254_740_991L } ?: invalidHistory()
    if(!data.has("nextCursor")) invalidHistory()
    val next = data.get("nextCursor").takeUnless { it.isJsonNull }?.let {
        if(!it.isJsonPrimitive || !it.asJsonPrimitive.isString) invalidHistory()
        it.asString.takeIf { value -> value.isNotBlank() && value.length <= 2048 && value != cursor } ?: invalidHistory()
    }
    val array = data.get("items")?.takeIf { it.isJsonArray }?.asJsonArray ?: invalidHistory()
    val start = range.from.atStartOfDay(zone).toInstant()
    val end = range.to.plusDays(1).atStartOfDay(zone).toInstant()
    val rows = array.map {
        if(!it.isJsonObject) invalidHistory()
        val item = it.asJsonObject
        val id = item.nonempty("id").also { value -> if(!value.matches(Regex("[A-Za-z0-9_-]{1,128}"))) invalidHistory() }
        val complete = Instant.parse(item.nonempty("completedAt"))
        if(complete < start || complete >= end) invalidHistory()
        val category = item.nonempty("category")
        val ref = item.get("categoryRef")?.takeUnless { value -> value.isJsonNull }?.let { value ->
            if(!value.isJsonObject) invalidHistory()
            value.asJsonObject.also { ref -> ref.nonempty("id"); ref.nonempty("name") }
        }
        val visibility = item.string("visibility").also { value -> if(value !in listOf("PRIVATE", "FOLLOWERS", "PUBLIC")) invalidHistory() }
        HistoryRecord(id, item.nonempty("title"), item.optional("notes"), Instant.parse(item.nonempty("dueDate")),
            complete, ref?.string("name") ?: category, item.optional("repeatRule"), visibility)
    }
    if(rows.size > limit || rows.size.toLong() > total || rows.distinctBy { it.id }.size != rows.size ||
        next != null && rows.size != limit || cursor == null && total > 0 && rows.isEmpty()) invalidHistory()
    if(rows.zipWithNext().any { (a, b) -> a.completedAt < b.completedAt || a.completedAt == b.completedAt && a.id < b.id }) invalidHistory()
    HistoryPage(rows.toList(), next, total, range, zone)
} catch(e: ApiException) { throw e } catch(_: Exception) { invalidHistory() }
