package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kr.kro.mungsil.data.*

class CheerState(val owner: String, val postId: String, cheered: Boolean, count: Int) {
    val submission = PendingSocialWrite(owner, "cheer/$postId", "응원", "게시물의 응원 상태를 확인해주세요. 자동으로 다시 보내지 않아요.")
    var cheered by mutableStateOf(cheered); private set
    var count by mutableIntStateOf(count.coerceAtLeast(0)); private set
    var inspecting by mutableStateOf(false); private set
    var inspectionError by mutableStateOf<String?>(null); private set
    private var before = cheered
    private var beforeCount = count.coerceAtLeast(0)
    fun observe(cheered: Boolean, count: Int) {
        if(submission.pending || submission.denied || inspecting) return
        this.cheered = cheered; this.count = count.coerceAtLeast(0)
    }
    fun begin(now: Long = System.currentTimeMillis()): SocialWrite? {
        if(inspecting) return null
        val fresh = !submission.pending
        val write = submission.begin(json(), now) ?: return null
        if(fresh) { before = cheered; beforeCount = count }
        cheered = !before; count = (beforeCount + if(before) -1 else 1).coerceAtLeast(0)
        return write
    }
    fun succeeded(write: SocialWrite, value: Boolean): Boolean {
        if(!submission.succeeded(write)) return false
        cheered = value; count = (beforeCount + if(value == before) 0 else if(value) 1 else -1).coerceAtLeast(0)
        return true
    }
    fun failed(write: SocialWrite, failure: Throwable) {
        if(submission.failed(write,failure)) { cheered = before; count = beforeCount }
    }
    fun beginInspection(): Boolean {
        if(inspecting || submission.busy) return false
        inspecting = true; inspectionError = null
        return true
    }
    fun beginResolution(): String? {
        val receipt = submission.receiptKey ?: return null
        if(!submission.uncertain || !beginInspection()) return null
        return receipt
    }
    fun resolved(receipt: String, value: Boolean, count: Int): Boolean {
        if(!inspecting || !submission.acceptReconciliation(receipt)) return false
        cheered = value; this.count = count; before = value; beforeCount = count
        inspecting = false; inspectionError = null
        return true
    }
    fun inspected(value: Boolean, count: Int) {
        if(!inspecting) return
        // A GET is a current observation, not proof that an earlier toggle finished.
        if(submission.uncertain) { cheered = value; this.count = count }
        else if(submission.acceptInspectedState()) { cheered = value; this.count = count; before = value; beforeCount = count }
        inspecting = false
    }
    fun inspectionFailed(failure: Throwable) { inspecting = false; inspectionError = friendlyError(failure) }
    fun save(): JsonObject = json("post" to postId, "before" to before, "count" to beforeCount, "submission" to submission.save())
    companion object {
        fun restore(owner: String, value: JsonObject): CheerState {
            val state = CheerState(owner, value.text("post"), value.flag("before"), value.number("count"))
            require(state.postId.isNotBlank())
            state.submission.restore(value.child("submission"))
            return state
        }
    }
}

/** App-scoped so a feed card and detail cannot issue competing toggle requests. */
class CheerStore(val owner: String) {
    private val states = mutableMapOf<String, CheerState>()
    fun get(id: String, cheered: Boolean, count: Int) = states.getOrPut(id) { CheerState(owner,id,cheered,count) }
    // Keep failed receipts as well; settled counts are fetched again after recreation.
    fun save(): String = json("owner" to owner, "pending" to states.values.filter { it.submission.hasReceipt }.map { it.save() }).toString()
    companion object {
        fun saver(owner: String) = Saver<CheerStore, String>(save = { if(owner.isBlank()) null else it.save() }, restore = { value ->
            runCatching {
                val data = JsonParser.parseString(value).asJsonObject
                require(owner.isNotBlank() && data.text("owner") == owner)
                CheerStore(owner).apply { data.list("pending").forEach { row ->
                    val state = CheerState.restore(owner,row); states[state.postId] = state
                } }
            }.getOrNull()
        })
    }
}
val LocalCheerStore = staticCompositionLocalOf<CheerStore?> { null }
@Composable fun rememberCheerStore(owner: String, session: Long): CheerStore =
    rememberSaveable(owner,session,saver = CheerStore.saver(owner)) { CheerStore(owner) }

@Composable fun rememberCheerState(owner: String, post: JsonObject): CheerState {
    val id = post.text("id")
    val local = rememberCheerStore(owner,0)
    val store = LocalCheerStore.current?.takeIf { it.owner == owner } ?: local
    val state = remember(store,id) { store.get(id,post.flag("cheered"),post.number("cheerCount")) }
    LaunchedEffect(state,post.toString()) { state.observe(post.flag("cheered"),post.number("cheerCount")) }
    return state
}

internal suspend fun sendCheer(api: Api, id: String, write: SocialWrite, session: Long): Boolean {
    currentCoroutineContext().ensureActive()
    val result = api.request("feed/posts/$id/cheer","POST",JsonParser.parseString(write.body).asJsonObject,
        key = write.key,expectedSessionVersion = session)
    currentCoroutineContext().ensureActive()
    val value = if(result.isJsonObject) result.asJsonObject.get("cheered") else null
    if(value == null || !value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) throw ApiException(502,"응원 응답을 확인하지 못했어요.")
    return value.asBoolean
}

internal suspend fun inspectCheer(api: Api, id: String, session: Long): Pair<Boolean,Int> {
    currentCoroutineContext().ensureActive()
    val result = api.request("feed/posts/$id",expectedSessionVersion = session)
    currentCoroutineContext().ensureActive()
    val post = if(result.isJsonObject) result.asJsonObject else throw ApiException(502,"응원 상태를 확인하지 못했어요.")
    val value = post.get("cheered"); val total = post.get("cheerCount")
    val count = if(total?.isJsonPrimitive == true && total.asJsonPrimitive.isNumber) total.asString.toIntOrNull() else null
    if(post.text("id") != id || value?.isJsonPrimitive != true || !value.asJsonPrimitive.isBoolean || count == null || count < 0)
        throw ApiException(502,"응원 상태를 확인하지 못했어요.")
    return value.asBoolean to count
}

internal suspend fun resolveCheer(api: Api, id: String, receipt: String, session: Long): Pair<Boolean,Int> {
    currentCoroutineContext().ensureActive()
    val result = api.request("feed/posts/$id/cheer/result","POST",json("requestKey" to receipt),expectedSessionVersion = session)
    currentCoroutineContext().ensureActive()
    val response = if(result.isJsonObject) result.asJsonObject else throw ApiException(502,"응원 결과를 확인하지 못했어요.")
    val value = response.get("cheered"); val total = response.get("cheerCount")
    val count = if(total?.isJsonPrimitive == true && total.asJsonPrimitive.isNumber) total.asString.toIntOrNull() else null
    if(response.text("status") != "RECONCILED" || response.text("postId") != id || value?.isJsonPrimitive != true || !value.asJsonPrimitive.isBoolean || count == null || count < 0)
        throw ApiException(502,"응원 결과를 확인하지 못했어요.")
    return value.asBoolean to count
}
