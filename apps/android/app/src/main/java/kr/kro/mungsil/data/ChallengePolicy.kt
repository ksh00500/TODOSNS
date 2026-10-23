package kr.kro.mungsil.data

import com.google.gson.JsonObject
import java.time.Instant

enum class ChallengeWindow { BEFORE, ACTIVE, ENDED, UNKNOWN }
fun challengeWindow(challenge: JsonObject, now: Instant = Instant.now()): ChallengeWindow {
    if(challenge.text("endedAt").isNotBlank()) return ChallengeWindow.ENDED
    val start = runCatching { Instant.parse(challenge.text("startsAt")) }.getOrNull() ?: return ChallengeWindow.UNKNOWN
    val end = runCatching { Instant.parse(challenge.text("endsAt")) }.getOrNull() ?: return ChallengeWindow.UNKNOWN
    if(end <= start) return ChallengeWindow.UNKNOWN
    return when { now < start -> ChallengeWindow.BEFORE; now > end -> ChallengeWindow.ENDED; else -> ChallengeWindow.ACTIVE }
}
fun canRetryChallengeCheckIn(check: JsonObject, window: ChallengeWindow, joined: Boolean, now: Instant = Instant.now()): Boolean {
    val attempt = check.get("attempt")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull() ?: return false
    val until = runCatching { Instant.parse(check.text("retryUntil")) }.getOrNull() ?: return false
    return joined && window == ChallengeWindow.ACTIVE && check.text("status") == "REJECTED" && attempt in 1..2 && until > now
}
