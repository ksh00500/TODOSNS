package kr.kro.mungsil.data

import com.google.gson.JsonObject
import com.google.gson.JsonNull
import com.google.gson.JsonPrimitive
import java.time.*
import java.time.format.DateTimeFormatter

data class TodoDraft(
    val title: String, val notes: String, val date: String, val time: String,
    val category: String, val categoryId: String, val repeatRule: String,
    val visibility: String, val groupId: String, val recurrenceScope: String,
)
fun todoWritePayload(draft: TodoDraft, source: JsonObject?, clone: Boolean, zone: ZoneId,
    categoriesReady: Boolean, groupsReady: Boolean): JsonObject {
    val original = if(source != null && !clone) Instant.parse(source.text("dueDate")).atZone(zone) else null
    val due = if(original != null && draft.date == original.toLocalDate().toString() &&
        draft.time == original.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))) source!!.text("dueDate")
        else dueInstant(draft.date, draft.time, zone)
    return json("title" to draft.title.trim(), "notes" to draft.notes.trim().ifBlank { null },
        "dueDate" to due, "repeatRule" to draft.repeatRule.ifBlank { null }, "visibility" to draft.visibility).apply {
        if(source == null || clone || categoriesReady) {
            addProperty("category", draft.category)
            add("categoryId", draft.categoryId.takeIf(String::isNotBlank)?.let(::JsonPrimitive) ?: JsonNull.INSTANCE)
        }
        if(groupsReady) add("todoListId", draft.groupId.takeIf(String::isNotBlank)?.let(::JsonPrimitive) ?: JsonNull.INSTANCE)
        if(source != null && !clone && source.text("seriesId").isNotBlank()) addProperty("recurrenceScope", draft.recurrenceScope)
        if(clone) addProperty("keepRepeat", draft.repeatRule.isNotBlank())
    }
}
