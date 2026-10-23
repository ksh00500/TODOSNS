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
import java.time.ZoneId

/** Account identity only. Never put access/refresh tokens in saveable product state. */
val LocalTodoDraftOwner = staticCompositionLocalOf { "" }

data class TodoFormRequest(val path: String, val method: String, val body: String, val key: String, val revision: Long, val attempt: Long)

class TodoFormState private constructor(
    val owner: String, val targetId: String?, val clone: Boolean, val zoneId: String,
    private val originalSource: JsonObject?, private val initial: TodoDraft,
) {
    var draft by mutableStateOf(initial); private set
    var chosenGroup by mutableStateOf(false); private set
    var originalGroup by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var uncertain by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var revision = 0L
    private var attempt = 0L
    private var submittedBody: String? = null
    private var requestKey = newKey()
    private var submittedRevision = 0L
    private var submittedAt = 0L
    val editable: Boolean get() = !busy && !uncertain
    val dirty: Boolean get() = uncertain || draft.copy(groupId = initial.groupId) != initial ||
        (chosenGroup && (originalGroup == null || draft.groupId != originalGroup))
    fun source(): JsonObject? = originalSource?.deepCopy()
    fun update(change: (TodoDraft) -> TodoDraft) {
        if(!editable) return
        val next = change(draft)
        if(next != draft) { draft = next; revision++; error = null }
    }
    fun selectGroup(id: String) {
        if(!editable) return
        update { it.copy(groupId = id) }
        chosenGroup = true
    }
    fun observeGroup(id: String) {
        if(originalGroup == null) {
            originalGroup = id
            if(!chosenGroup && editable) draft = draft.copy(groupId = id)
        }
    }
    fun begin(payload: JsonObject? = null, nowMillis: Long = System.currentTimeMillis()): TodoFormRequest? {
        if(busy || owner.isBlank()) return null
        // A 5xx may leave a server idempotency record with only a five-minute lifetime.
        if(uncertain && (nowMillis < submittedAt || nowMillis - submittedAt >= 5 * 60_000)) {
            error = "시간이 지나 저장 결과를 다시 확인해야 해요. 닫은 뒤 목록을 확인해주세요."
            return null
        }
        if(!uncertain) {
            requireNotNull(payload)
            val body = payload.toString()
            if(submittedBody != null && submittedBody != body) requestKey = newKey()
            submittedBody = body
            submittedRevision = revision
            submittedAt = nowMillis
        }
        val body = submittedBody ?: return null
        busy = true; uncertain = true; error = null; attempt++
        return TodoFormRequest(if(targetId == null) "todos" else "todos/$targetId${if(clone) "/clone" else ""}",
            if(targetId != null && !clone) "PATCH" else "POST", body, requestKey, submittedRevision, attempt)
    }
    private fun current(request: TodoFormRequest) = busy && request.attempt == attempt && request.key == requestKey && request.body == submittedBody
    fun succeeded(request: TodoFormRequest): Boolean {
        if(!current(request)) return false
        busy = false; uncertain = false; error = null; submittedBody = null; requestKey = newKey()
        return request.revision == revision
    }
    fun failed(request: TodoFormRequest, failure: Throwable) {
        if(!current(request)) return
        busy = false
        uncertain = failure !is ApiException || failure.status >= 500 || failure.status == 409
        error = if(uncertain) "저장 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else friendlyError(failure)
    }
    fun cancelled(request: TodoFormRequest) {
        if(!current(request)) return
        busy = false; uncertain = true
        error = "저장 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요."
    }
    fun saveState(): String = json("owner" to owner, "target" to targetId, "clone" to clone, "zone" to zoneId,
        "source" to originalSource, "initial" to initial, "draft" to draft, "chosenGroup" to chosenGroup,
        "originalGroup" to originalGroup, "revision" to revision, "attempt" to attempt,
        "body" to submittedBody, "key" to requestKey, "submittedRevision" to submittedRevision,
        "submittedAt" to submittedAt, "version" to 1, "uncertain" to (uncertain || busy), "error" to error).toString()
    companion object {
        fun create(owner: String, source: JsonObject?, clone: Boolean, initialDate: String, zone: ZoneId): TodoFormState {
            val original = source?.let { input -> JsonObject().apply {
                listOf("id", "title", "notes", "dueDate", "seriesId", "repeatRule", "category", "categoryId", "categoryRef", "visibility")
                    .forEach { key -> input.get(key)?.let { add(key, it.deepCopy()) } }
            } }
            val draft = TodoDraft(original?.text("title").orEmpty(), original?.text("notes").orEmpty(),
                if(original != null && !clone) localDate(original.text("dueDate"), zone).toString() else initialDate,
                original?.let { localTime(it.text("dueDate"), zone) } ?: "09:00", original?.text("category", "생활") ?: "생활",
                if(clone) "" else original?.text("categoryId").orEmpty(), original?.text("repeatRule").orEmpty(),
                if(clone) "PRIVATE" else original?.text("visibility", "PRIVATE") ?: "PRIVATE", "", "THIS")
            return TodoFormState(owner, original?.text("id"), clone, zone.id, original, draft)
        }
        fun restoreState(serialized: String, owner: String, targetId: String?, clone: Boolean): TodoFormState? = runCatching {
            val data = JsonParser.parseString(serialized).asJsonObject
            if(owner.isBlank() || data.text("owner") != owner || data.text("target").takeIf(String::isNotBlank) != targetId || data.flag("clone") != clone) return null
            require(data.get("version").asInt == 1)
            val gson = Gson()
            fun readDraft(key: String): TodoDraft {
                val obj = data.getAsJsonObject(key)
                listOf("title", "notes", "date", "time", "category", "categoryId", "repeatRule", "visibility", "groupId", "recurrenceScope").forEach {
                    val value = obj.get(it)
                    require(value != null && value.isJsonPrimitive && value.asJsonPrimitive.isString)
                }
                return gson.fromJson(obj, TodoDraft::class.java)
            }
            val initial = readDraft("initial")
            val state = TodoFormState(owner, targetId, clone, data.text("zone"), data.get("source")?.takeUnless { it.isJsonNull }?.asJsonObject, initial)
            ZoneId.of(state.zoneId)
            state.draft = readDraft("draft")
            state.chosenGroup = data.flag("chosenGroup")
            state.originalGroup = data.get("originalGroup")?.takeUnless { it.isJsonNull }?.asString
            state.revision = data.get("revision").asLong; state.attempt = data.get("attempt").asLong
            state.submittedBody = data.get("body")?.takeUnless { it.isJsonNull }?.asString
            state.requestKey = data.text("key").also { require(it.isNotBlank()) }
            state.submittedRevision = data.get("submittedRevision").asLong
            state.submittedAt = data.get("submittedAt").asLong
            state.submittedBody?.let { require(JsonParser.parseString(it).isJsonObject) }
            state.uncertain = data.flag("uncertain") && state.submittedBody != null
            state.error = if(state.uncertain) "저장 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else data.text("error").takeIf(String::isNotBlank)
            state
        }.getOrNull()
        fun saver(owner: String, targetId: String?, clone: Boolean) = Saver<TodoFormState, String>(
            save = { if(it.owner.isBlank()) null else it.saveState() },
            restore = { restoreState(it, owner, targetId, clone) },
        )
    }
}

@Composable fun rememberTodoFormState(owner: String, source: JsonObject?, clone: Boolean, date: String, zone: ZoneId): TodoFormState =
    rememberSaveable(owner, source?.text("id"), clone, saver = TodoFormState.saver(owner, source?.text("id"), clone)) {
        TodoFormState.create(owner, source, clone, date, zone)
    }

internal suspend fun sendTodoForm(api: Api, request: TodoFormRequest, sessionVersion: Long) {
    if(api.sessionVersion != sessionVersion) throw ApiException(401, "로그인 상태가 바뀌었어요. 다시 로그인해주세요.")
    api.request(request.path, request.method, JsonParser.parseString(request.body).asJsonObject, key = request.key, expectedSessionVersion = sessionVersion)
    currentCoroutineContext().ensureActive()
}
