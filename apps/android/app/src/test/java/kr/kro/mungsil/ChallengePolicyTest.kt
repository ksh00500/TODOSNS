package kr.kro.mungsil

import kr.kro.mungsil.data.*
import java.time.Instant
import org.junit.Test
import org.junit.Assert.*

class ChallengePolicyTest {
    private val now = Instant.parse("2026-09-28T03:00:00Z")
    private fun challenge() = json("startsAt" to now.minusSeconds(60).toString(), "endsAt" to now.plusSeconds(60).toString())
    private fun check() = json("status" to "REJECTED", "attempt" to 1, "retryUntil" to now.plusSeconds(30).toString())
    @Test fun periodBoundariesAndManualEndingDoNotDefaultToActive() {
        assertEquals(ChallengeWindow.ACTIVE, challengeWindow(challenge(), now))
        assertEquals(ChallengeWindow.BEFORE, challengeWindow(challenge(), now.minusSeconds(61)))
        assertEquals(ChallengeWindow.ENDED, challengeWindow(challenge(), now.plusSeconds(61)))
        assertEquals(ChallengeWindow.ACTIVE, challengeWindow(challenge(), now.plusSeconds(60)))
        assertEquals(ChallengeWindow.ENDED, challengeWindow(challenge().apply { addProperty("endedAt", now.toString()) }, now))
        assertEquals(ChallengeWindow.UNKNOWN, challengeWindow(challenge().apply { remove("startsAt") }, now))
        assertEquals(ChallengeWindow.UNKNOWN, challengeWindow(challenge().apply { addProperty("endsAt", now.minusSeconds(120).toString()) }, now))
    }
    @Test fun rejectedCheckNeedsActiveMembershipValidAttemptAndUnexpiredWindow() {
        assertTrue(canRetryChallengeCheckIn(check(), ChallengeWindow.ACTIVE, true, now))
        for(window in listOf(ChallengeWindow.BEFORE, ChallengeWindow.ENDED, ChallengeWindow.UNKNOWN)) assertFalse(canRetryChallengeCheckIn(check(), window, true, now))
        assertFalse(canRetryChallengeCheckIn(check(), ChallengeWindow.ACTIVE, false, now))
        for(bad in listOf(check().apply { addProperty("attempt", 3) }, check().apply { remove("attempt") }, check().apply { addProperty("attempt", "1") },
            check().apply { addProperty("retryUntil", now.toString()) }, check().apply { addProperty("status", "APPROVED") }, check().apply { addProperty("status", "PENDING") })) {
            assertFalse(canRetryChallengeCheckIn(bad, ChallengeWindow.ACTIVE, true, now))
        }
    }
}
