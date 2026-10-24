package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kr.kro.mungsil.data.*

data class SocialWrite(val body: String, val key: String, val attempt: Long)

/** A pending social write is a receipt to confirm, never a new user action. */
class PendingSocialWrite(val owner: String, val scope: String, private val label: String, private val inspect: String) {
    var busy by mutableStateOf(false); private set
    var uncertain by mutableStateOf(false); private set
    var denied by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var body: String? = null
    private var key = newKey()
    private var attempt = 0L
    private var submittedAt = 0L
    val editable get() = owner.isNotBlank() && !busy && !uncertain && !denied
    val pending get() = busy || uncertain
    val hasReceipt get() = body != null
    val receiptKey get() = key.takeIf { body != null }
    fun acceptReconciliation(receipt: String): Boolean {
        if(busy || receiptKey != receipt) return false
        return acceptInspectedState()
    }
    fun acceptInspectedState(): Boolean {
        if(busy) return false
        uncertain = false; denied = false; body = null; key = newKey(); error = null
        return true
    }
    fun begin(payload: JsonObject, now: Long = System.currentTimeMillis()): SocialWrite? {
        if(busy || denied || owner.isBlank()) return null
        if(uncertain && (now < submittedAt || now - submittedAt >= 5 * 60_000)) {
            error = "시간이 지나 결과를 다시 확인해야 해요. $inspect"; return null
        }
        if(!uncertain) {
            val next = payload.toString()
            if(body != null && body != next) key = newKey()
            body = next; submittedAt = now
        }
        busy = true; uncertain = true; error = null; attempt++
        return SocialWrite(checkNotNull(body), key, attempt)
    }
    private fun current(write: SocialWrite) = busy && write.key == key && write.body == body && write.attempt == attempt
    fun succeeded(write: SocialWrite): Boolean {
        if(!current(write)) return false
        busy = false; uncertain = false; body = null; key = newKey(); error = null
        return true
    }
    fun failed(write: SocialWrite, failure: Throwable): Boolean {
        if(!current(write)) return false
        busy = false
        denied = failure is ApiException && failure.status in listOf(401, 403, 404)
        uncertain = failure !is ApiException || failure.status >= 500 || failure.status == 409
        error = if(uncertain) "$label 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else friendlyError(failure)
        return true
    }
    fun save(): JsonObject = json("owner" to owner, "scope" to scope, "body" to body, "key" to key,
        "attempt" to attempt, "submittedAt" to submittedAt, "uncertain" to pending, "denied" to denied, "error" to error)
    fun restore(data: JsonObject) {
        require(data.text("owner") == owner && data.text("scope") == scope)
        body = data.text("body").takeIf(String::isNotBlank)
        body?.let { require(JsonParser.parseString(it).isJsonObject) }
        key = data.text("key").also { require(it.isNotBlank()) }
        attempt = data.get("attempt").asLong; submittedAt = data.get("submittedAt").asLong
        uncertain = data.flag("uncertain") && body != null
        denied = data.flag("denied")
        error = if(uncertain) "$label 결과를 확인하지 못했어요. 같은 요청으로 결과를 확인해주세요." else data.text("error").takeIf(String::isNotBlank)
    }
}
