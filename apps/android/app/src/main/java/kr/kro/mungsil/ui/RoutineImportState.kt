package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kr.kro.mungsil.data.*
import java.time.*
import java.time.format.DateTimeFormatter

data class RoutineSourceItem(val id: String, val title: String, val category: String, val dueDate: String, val repeatRule: String)
data class RoutineItemDraft(val id: String, val title: String, val category: String, val date: String, val time: String, val repeatRule: String)
data class RoutineDraft(val title: String, val date: String, val time: String = "07:00", val mode: String = "KEEP", val items: List<RoutineItemDraft>)

class RoutineImportState private constructor(val owner: String, val id: String, val zoneId: String,
    val source: List<RoutineSourceItem>, private val initial: RoutineDraft) {
    var draft by mutableStateOf(initial); private set
    var validation by mutableStateOf<String?>(null); private set
    val submission = PendingSocialWrite(owner,"routine/$id","가져오기","닫은 뒤 TODO 그룹과 일정을 확인해주세요.")
    val editable get() = submission.editable
    val dirty get() = submission.pending || draft != initial
    val sourceTitle get() = initial.title
    /** Match the selected base schedule without overwriting preserved CUSTOM edits. */
    fun previewItems(): List<RoutineItemDraft>? = if(draft.mode == "CUSTOM") draft.items else runCatching {
        shifted(source, draft.date, draft.time, ZoneId.of(zoneId)).map {
            if(draft.mode == "NONE") it.copy(repeatRule = "") else it
        }
    }.getOrNull()
    fun update(change: (RoutineDraft) -> RoutineDraft) { if(editable) { draft = change(draft); validation = null } }
    fun updateItem(id: String, change: (RoutineItemDraft) -> RoutineItemDraft) = update { it.copy(items = it.items.map { item -> if(item.id == id) change(item) else item }) }
    fun resetItems() {
        if(!editable) return
        runCatching { shifted(source,draft.date,draft.time,ZoneId.of(zoneId)) }
            .onSuccess { items -> update { it.copy(items = items) } }
            .onFailure { validation = "원본 일정을 확인하지 못했어요. 날짜와 시간을 확인해주세요." }
    }
    fun payload(): JsonObject {
        require(source.isNotEmpty() && source.size <= 30 && source.map { it.id }.distinct().size == source.size)
        source.forEach { require(it.id.isNotBlank()); Instant.parse(it.dueDate) }
        require(draft.title.trim().isNotEmpty() && draft.title.codePointCount(0,draft.title.length) <= 100)
        require(draft.mode in listOf("KEEP","NONE","CUSTOM"))
        val zone = ZoneId.of(zoneId)
        return json("title" to draft.title.trim(),"dueDate" to dueInstant(draft.date,draft.time,zone),"repeatMode" to draft.mode).apply {
            if(draft.mode == "CUSTOM") {
                require(draft.items.map { it.id } == source.map { it.id })
                add("items",json("items" to draft.items.map { item ->
                    require(item.title.trim().isNotEmpty() && item.title.codePointCount(0,item.title.length) <= 120)
                    mapOf("sourceTodoId" to item.id,"title" to item.title.trim(),"category" to item.category,
                        "dueDate" to dueInstant(item.date,item.time,zone),"repeatRule" to item.repeatRule.ifBlank { null })
                }).get("items"))
            }
        }
    }
    fun begin(now: Long = System.currentTimeMillis()): SocialWrite? {
        if(submission.pending) return submission.begin(json(),now)
        val payload = runCatching { payload() }.getOrElse {
            validation = "루틴 이름·항목·날짜와 시간을 확인해주세요."
            return null
        }
        return submission.begin(payload,now)
    }
    fun save(): String = json("version" to 1,"owner" to owner,"id" to id,"zone" to zoneId,"source" to source,
        "initial" to initial,"draft" to draft,"submission" to submission.save()).toString()
    companion object {
        private fun shifted(source: List<RoutineSourceItem>, date: String, time: String, zone: ZoneId): List<RoutineItemDraft> {
            if(source.isEmpty()) return emptyList()
            val base = source.minOf { Instant.parse(it.dueDate) }
            val target = Instant.parse(dueInstant(date,time,zone))
            return source.map { row ->
                val due = target.plus(Duration.between(base,Instant.parse(row.dueDate))).atZone(zone)
                RoutineItemDraft(row.id,row.title,row.category,due.toLocalDate().toString(),due.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")),row.repeatRule)
            }
        }
        fun create(owner: String, list: JsonObject, zone: ZoneId, date: String = LocalDate.now(zone).toString()): RoutineImportState {
            val rows = list.list("items").map { it.child("todo") }.map { row ->
                RoutineSourceItem(row.text("id"),row.text("title"),row.text("category"),row.text("dueDate"),row.text("repeatRule"))
            }
            val items = runCatching { shifted(rows,date,"07:00",zone) }.getOrDefault(emptyList())
            return RoutineImportState(owner,list.text("id"),zone.id,rows,RoutineDraft(list.text("title"),date,items = items))
        }
        fun restore(value: String, owner: String, id: String): RoutineImportState? = runCatching {
            val data = JsonParser.parseString(value).asJsonObject
            require(owner.isNotBlank() && data.text("owner") == owner && data.text("id") == id && data.get("version").asInt == 1)
            fun strings(row: JsonObject, fields: List<String>) = fields.forEach { field ->
                val entry = row.get(field)
                require(entry?.isJsonPrimitive == true && entry.asJsonPrimitive.isString)
            }
            for(key in listOf("initial","draft")) {
                val row = data.getAsJsonObject(key)
                strings(row,listOf("title","date","time","mode"))
                require(row.get("items")?.isJsonArray == true)
                row.list("items").forEach { strings(it,listOf("id","title","category","date","time","repeatRule")) }
            }
            data.list("source").forEach { strings(it,listOf("id","title","category","dueDate","repeatRule")) }
            val gson = Gson()
            val source = data.list("source").map { gson.fromJson(it,RoutineSourceItem::class.java) }
            val initial = gson.fromJson(data.get("initial"),RoutineDraft::class.java)
            val state = RoutineImportState(owner,id,ZoneId.of(data.text("zone")).id,source,initial)
            state.draft = gson.fromJson(data.get("draft"),RoutineDraft::class.java)
            require(state.draft.mode in listOf("KEEP","NONE","CUSTOM"))
            require(state.draft.items.map { it.id } == source.map { it.id })
            state.submission.restore(data.child("submission"))
            if(state.submission.pending) require(data.child("submission").text("body") == state.payload().toString())
            state
        }.getOrNull()
        fun saver(owner: String,id: String) = Saver<RoutineImportState,String>(save = { if(owner.isBlank()) null else it.save() },restore = { restore(it,owner,id) })
    }
}
@Composable fun rememberRoutineImportState(owner: String,list: JsonObject,zone: ZoneId): RoutineImportState =
    rememberSaveable(owner,list.text("id"),saver = RoutineImportState.saver(owner,list.text("id"))) { RoutineImportState.create(owner,list,zone) }

internal suspend fun sendRoutineImport(api: Api,id: String,owner: String,write: SocialWrite,session: Long) {
    currentCoroutineContext().ensureActive()
    val result = api.request("todo-lists/$id/clone","POST",JsonParser.parseString(write.body).asJsonObject,
        key = write.key,expectedSessionVersion = session)
    currentCoroutineContext().ensureActive()
    val created = if(result.isJsonObject) result.asJsonObject.get("id") else null
    if(created == null || !created.isJsonPrimitive || !created.asJsonPrimitive.isString || created.asString.isBlank() || created.asString == id)
        throw ApiException(502,"가져온 루틴 응답을 확인하지 못했어요.")
    if(result.asJsonObject.text("userId") != owner || result.asJsonObject.text("visibility") != "PRIVATE")
        throw ApiException(502,"가져온 루틴의 소유권과 공개 범위를 확인하지 못했어요.")
}
