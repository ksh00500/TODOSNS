package kr.kro.mungsil.data

import com.google.gson.JsonObject
import java.time.*

data class TodoRecord(val id: String, val title: String, val dueDate: String, val completedAt: String?, val source: JsonObject) {
    companion object {
        fun parse(value: JsonObject): TodoRecord {
            val id = value.text("id"); val title = value.text("title"); val due = value.text("dueDate")
            if(id.isBlank() || title.isBlank() || runCatching { Instant.parse(due) }.isFailure) throw ApiException(502, "할 일 정보를 확인하지 못했어요. 다시 불러와주세요.")
            return TodoRecord(id, title, due, value.text("completedAt").ifBlank { null }, value.deepCopy())
        }
    }
    fun withCompletion(done: Boolean): TodoRecord {
        val time = if(done) Instant.now().toString() else null
        val value = source.deepCopy().apply { addProperty("completedAt", time) }
        return copy(completedAt = time, source = value)
    }
}

class TodoRepository(private val api: Api) {
    suspend fun list(date: LocalDate, zone: ZoneId): List<TodoRecord> {
        val (from, to) = dayRange(date, zone)
        val response = api.request("todos", query = mapOf("from" to from, "to" to to))
        if(!response.isJsonArray) throw ApiException(502, "할 일 목록을 확인하지 못했어요. 다시 불러와주세요.")
        return response.rows().map(TodoRecord::parse)
    }
    suspend fun complete(item: TodoRecord, key: String) {
        api.request("todos/${item.id}/${if(item.completedAt == null) "complete" else "uncomplete"}", "POST", if(item.completedAt == null) json("share" to false) else null, key = key)
    }
}
