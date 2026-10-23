package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.JsonParser
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kr.kro.mungsil.data.*

data class PublicationDraft(val caption: String = "", val tags: List<String> = emptyList(),
    val tagInput: String = "", val visibility: String = "PUBLIC", val mediaId: String? = null)
data class PublicationRequest(val body: String, val key: String, val attempt: Long)

/** Product state only: no credentials and no copy of the source TODO or group. */
class PublishFormState(val owner: String, val targetId: String, val group: Boolean) {
    var draft by mutableStateOf(PublicationDraft()); private set
    val photo = PhotoDraft()
    var photoPending by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var uncertain by mutableStateOf(false); private set
    var denied by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var tagError by mutableStateOf<String?>(null); private set
    private var body: String? = null
    private var requestKey = newKey()
    private var attempt = 0L
    private var submittedAt = 0L
    val editable get() = !busy && !uncertain && !denied && owner.isNotBlank()
    val incompletePhoto get() = photoPending || (photo.selectedUri != null && draft.mediaId == null)
    val dirty get() = uncertain || draft != PublicationDraft() || incompletePhoto || photo.cameraUri != null
    fun update(change: (PublicationDraft) -> PublicationDraft) {
        if(editable) {
            val next = change(draft)
            if(next.tagInput != draft.tagInput || next.tags != draft.tags) tagError = null
            draft = next; error = null
        }
    }
    fun photoPending(value: Boolean) { if(editable) photoPending = value }
    fun addTag(value: String = draft.tagInput) {
        if(!editable) return
        val result = addPublishTag(draft.tags, value)
        draft = draft.copy(tags = result.tags, tagInput = result.draft)
        tagError = result.error
    }
    fun begin(nowMillis: Long = System.currentTimeMillis()): PublicationRequest? {
        if(busy || denied || owner.isBlank() || targetId.isBlank()) return null
        if(uncertain && (nowMillis < submittedAt || nowMillis - submittedAt >= 5 * 60_000)) {
            error = "시간이 지나 게시 결과를 다시 확인해야 해요. 닫은 뒤 마이의 게시 기록을 확인해주세요."
            return null
        }
        if(!uncertain) {
            if(incompletePhoto) { error = "사진 첨부를 완료하거나 사진을 제외해주세요."; return null }
            if(draft.tagInput.isNotBlank()) addTag()
            if(tagError != null) return null
            if(draft.caption.codePointCount(0, draft.caption.length) > 180 || draft.visibility !in listOf("PUBLIC", "FOLLOWERS", "PRIVATE")) {
                error = "한마디는 180자까지 입력하고 공개 범위를 확인해주세요."; return null
            }
            val nextBody = payload().toString()
            if(body != null && body != nextBody) requestKey = newKey()
            body = nextBody; submittedAt = nowMillis
        }
        busy = true; uncertain = true; error = null; attempt++
        return PublicationRequest(checkNotNull(body), requestKey, attempt)
    }
    private fun payload() = publishPayload(targetId, group, draft.caption, draft.tags, draft.visibility, draft.mediaId)
    private fun current(request: PublicationRequest) = busy && request.key == requestKey && request.body == body && request.attempt == attempt
    fun succeeded(request: PublicationRequest): Boolean {
        if(!current(request)) return false
        busy = false; uncertain = false; body = null; requestKey = newKey(); error = null
        return true
    }
    fun failed(request: PublicationRequest, failure: Throwable) {
        if(!current(request)) return
        busy = false
        denied = failure is ApiException && failure.status in listOf(401, 403)
        uncertain = failure !is ApiException || failure.status >= 500 || failure.status == 409
        error = if(uncertain) "게시 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else friendlyError(failure)
    }
    fun cancelled(request: PublicationRequest) = failed(request, java.io.IOException())
    fun saveState(): String = json("version" to 1, "owner" to owner, "target" to targetId, "group" to group,
        "caption" to draft.caption, "tags" to draft.tags, "tagInput" to draft.tagInput, "visibility" to draft.visibility,
        "mediaId" to draft.mediaId, "selectedUri" to photo.selectedUri, "cameraUri" to photo.cameraUri,
        "photoPending" to photoPending, "body" to body, "key" to requestKey, "attempt" to attempt,
        "submittedAt" to submittedAt, "uncertain" to (busy || uncertain), "denied" to denied, "error" to error).toString()
    companion object {
        fun restoreState(value: String, owner: String, targetId: String, group: Boolean): PublishFormState? = runCatching {
            val data = JsonParser.parseString(value).asJsonObject
            require(owner.isNotBlank() && data.text("owner") == owner && data.text("target") == targetId && data.flag("group") == group)
            require(data.get("version").asInt == 1)
            val state = PublishFormState(owner, targetId, group)
            state.draft = PublicationDraft(data.text("caption"), data.strings("tags"), data.text("tagInput"), data.text("visibility"), data.text("mediaId").takeIf(String::isNotBlank))
            require(state.draft.visibility in listOf("PUBLIC", "FOLLOWERS", "PRIVATE"))
            state.photo.selectedUri = data.text("selectedUri").takeIf(String::isNotBlank)
            state.photo.cameraUri = data.text("cameraUri").takeIf(String::isNotBlank)
            state.photoPending = data.flag("photoPending")
            state.body = data.text("body").takeIf(String::isNotBlank)
            state.requestKey = data.text("key").also { require(it.isNotBlank()) }
            state.attempt = data.get("attempt").asLong; state.submittedAt = data.get("submittedAt").asLong
            state.uncertain = data.flag("uncertain") && state.body != null
            if(state.uncertain) require(state.body == state.payload().toString())
            state.denied = data.flag("denied")
            state.error = if(state.uncertain) "게시 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else data.text("error").takeIf(String::isNotBlank)
            state
        }.getOrNull()
        fun saver(owner: String, targetId: String, group: Boolean) = Saver<PublishFormState, String>(
            save = { if(it.owner.isBlank()) null else it.saveState() },
            restore = { restoreState(it, owner, targetId, group) })
    }
}

@Composable fun rememberPublishFormState(owner: String, id: String, group: Boolean): PublishFormState =
    rememberSaveable(owner, id, group, saver = PublishFormState.saver(owner, id, group)) { PublishFormState(owner, id, group) }

internal suspend fun sendPublication(api: Api, request: PublicationRequest, sessionVersion: Long) {
    currentCoroutineContext().ensureActive()
    val response = api.request("feed/posts", "POST", JsonParser.parseString(request.body).asJsonObject,
        key = request.key, expectedSessionVersion = sessionVersion)
    currentCoroutineContext().ensureActive()
    val id = if(response.isJsonObject) response.asJsonObject.get("id") else null
    if(id == null || !id.isJsonPrimitive || !id.asJsonPrimitive.isString || id.asString.isBlank())
        throw ApiException(502, "게시 응답을 확인하지 못했어요.")
}
