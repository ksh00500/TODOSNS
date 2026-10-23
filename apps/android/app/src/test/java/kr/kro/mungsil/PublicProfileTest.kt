package kr.kro.mungsil

import kr.kro.mungsil.data.*
import org.junit.Assert.*
import org.junit.Test

class PublicProfileTest {
    private val person = json("id" to "user", "handle" to "cloud", "nickname" to "실천 구름", "rank" to "조각구름", "lifetimePower" to 120,
        "_count" to json("posts" to 4, "followers" to 3, "following" to 2))
    @Test fun publicCountsAndRankUseServerRecords() {
        val parsed = parsePublicPerson(person)
        assertEquals(4, parsed.posts); assertEquals(3, parsed.followers); assertEquals(120, parsed.power); assertEquals("조각구름", parsed.rank)
    }
    @Test fun missingOrInvalidPublicCountsDoNotBecomeZero() {
        assertThrows(ApiException::class.java) { parsePublicPerson(person.deepCopy().apply { remove("_count") }) }
        assertThrows(ApiException::class.java) { parsePublicPerson(person.deepCopy().apply { child("_count").addProperty("followers", -1) }) }
        assertThrows(ApiException::class.java) { parsePublicPerson(person.deepCopy().apply { remove("handle") }) }
    }
    @Test fun relationshipRequiresExplicitFollowingAndBlockedFlags() {
        val source = json("following" to false, "blocked" to true, "followerCount" to 3, "followingCount" to 2)
        assertTrue(parseFollowStatus(source).blocked)
        assertThrows(ApiException::class.java) { parseFollowStatus(source.deepCopy().apply { remove("blocked") }) }
        assertThrows(ApiException::class.java) { parseFollowStatus(source.deepCopy().apply { addProperty("following", "unknown") }) }
    }
}
