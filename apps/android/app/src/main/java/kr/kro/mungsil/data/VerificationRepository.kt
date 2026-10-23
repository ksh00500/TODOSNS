package kr.kro.mungsil.data

import com.google.gson.JsonElement
import com.google.gson.JsonObject

data class VerificationItem(val id: String, val attempt: Int, val challengeId: String, val title: String, val criteria: List<String>, val mediaUrl: String?) {
    // A new attempt or changed criteria must not inherit a previous decision.
    val identity: String get() = json("id" to id, "attempt" to attempt, "criteria" to criteria).toString()
}
data class VerificationQueue(val contributions: Int, val items: List<VerificationItem>)
private fun invalidVerification(): Nothing = throw ApiException(502, "확인할 인증의 정보를 읽지 못했어요. 다시 불러와주세요.", "VERIFICATION_RESPONSE_INVALID")
private fun JsonObject.verificationText(name: String): String = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.takeIf(String::isNotBlank) ?: invalidVerification()
private fun JsonObject.verificationNumber(name: String): Int = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull()?.takeIf { it >= 0 } ?: invalidVerification()
fun parseVerificationQueue(value: JsonElement): VerificationQueue {
    if(!value.isJsonObject) invalidVerification()
    val obj = value.asJsonObject
    val rows = obj.get("items")?.takeIf { it.isJsonArray }?.asJsonArray ?: invalidVerification()
    return VerificationQueue(obj.verificationNumber("contributionCount"), rows.map { raw ->
        if(!raw.isJsonObject) invalidVerification()
        val item = raw.asJsonObject
        val challenge = item.get("challenge")?.takeIf { it.isJsonObject }?.asJsonObject ?: invalidVerification()
        val criteria = item.get("criteria")?.takeIf { it.isJsonArray }?.asJsonArray?.map {
            if(!it.isJsonPrimitive || !it.asJsonPrimitive.isString || it.asString.isBlank()) invalidVerification() else it.asString
        }?.takeIf { it.size in 1..5 } ?: invalidVerification()
        val media = item.get("mediaUrl")?.let { if(it.isJsonNull) null else if(it.isJsonPrimitive && it.asJsonPrimitive.isString) it.asString.takeIf(String::isNotBlank) else invalidVerification() }
        val attempt = item.verificationNumber("attempt").takeIf { it > 0 } ?: invalidVerification()
        VerificationItem(item.verificationText("checkInId"), attempt, challenge.verificationText("id"), challenge.verificationText("title"), criteria, media)
    }.distinctBy { it.identity })
}
interface VerificationSource { suspend fun queue(challengeId: String): VerificationQueue }
class VerificationRepository(private val api: Api) : VerificationSource {
    override suspend fun queue(challengeId: String): VerificationQueue = parseVerificationQueue(api.request("challenge-verifications/queue", query = mapOf("challengeId" to challengeId, "limit" to "1")))
}
