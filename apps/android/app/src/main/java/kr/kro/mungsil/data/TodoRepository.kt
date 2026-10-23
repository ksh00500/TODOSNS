package kr.kro.mungsil.data

import com.google.gson.JsonObject
import java.time.*

private fun invalidTodoResponse(): Nothing = throw ApiException(
    502, "할 일 정보를 확인하지 못했어요. 다시 불러와주세요.", "TODO_RESPONSE_INVALID",
)

data class TodoRecord(val id: String, val title: String, val dueDate: String, val completedAt: String?, val source: JsonObject) {
    companion object {
        fun parse(value: JsonObject): TodoRecord {
            fun requiredText(key: String): String = value.get(key)
                ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
                ?.asString?.takeIf(String::isNotBlank) ?: invalidTodoResponse()
            val id = requiredText("id")
            val title = requiredText("title")
            val due = requiredText("dueDate")
            if(runCatching { Instant.parse(due) }.isFailure) invalidTodoResponse()
            val completion = value.get("completedAt")?.takeUnless { it.isJsonNull }?.let {
                if(!it.isJsonPrimitive || !it.asJsonPrimitive.isString) invalidTodoResponse()
                it.asString.also { time -> if(runCatching { Instant.parse(time) }.isFailure) invalidTodoResponse() }
            }
            return TodoRecord(id, title, due, completion, value.deepCopy())
        }
    }
    fun withCompletion(done: Boolean): TodoRecord {
        val time = if(done) Instant.now().toString() else null
        val value = source.deepCopy().apply { addProperty("completedAt", time) }
        return copy(completedAt = time, source = value)
    }
}

interface TodoSource {
    suspend fun list(date: LocalDate, zone: ZoneId): List<TodoRecord>
    suspend fun complete(item: TodoRecord, key: String): TodoRecord
}

class TodoRepository(private val api: Api) : TodoSource {
    override suspend fun list(date: LocalDate, zone: ZoneId): List<TodoRecord> {
        val (from, to) = dayRange(date, zone)
        val response = api.request("todos", query = mapOf("from" to from, "to" to to))
        if(!response.isJsonArray) throw ApiException(502, "할 일 목록을 확인하지 못했어요. 다시 불러와주세요.")
        return response.rows().map(TodoRecord::parse)
    }
    override suspend fun complete(item: TodoRecord, key: String): TodoRecord {
        val completing = item.completedAt == null
        val response = api.request("todos/${item.id}/${if(completing) "complete" else "uncomplete"}", "POST", if(completing) json("share" to false) else null, key = key)
        val value = if(completing) response.obj().child("todo") else response.obj()
        // A partial/wrong-item response must never confirm an optimistic completion.
        if(!value.has("completedAt")) invalidTodoResponse()
        val saved = TodoRecord.parse(value)
        if(saved.id != item.id || (saved.completedAt != null) != completing) invalidTodoResponse()
        return saved
    }
}
