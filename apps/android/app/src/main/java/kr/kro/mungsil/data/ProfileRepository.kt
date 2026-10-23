package kr.kro.mungsil.data

import com.google.gson.JsonObject

data class ProfileRecord(
    val id: String, val handle: String, val nickname: String, val avatar: String,
    val bio: String, val interests: List<String>, val rank: String, val power: Int,
    val points: Int, val posts: Int, val followers: Int, val following: Int,
    val completed: Int, val cheers: Int, val copies: Int, val awards: List<ProfileBadge>,
)
data class ProfileGroup(val id: String, val title: String, val description: String, val items: Int, val copies: Int)
data class ProfilePost(val id: String, val title: String, val image: String, val cheers: Int)
data class ProfileBadge(
    val id: String, val title: String, val description: String, val issuer: String,
    val condition: String, val unlocked: Boolean?, val challengeId: String? = null,
    val challengeTitle: String? = null,
)
data class Growth(val next: Int?, val remaining: Int, val progress: Float)
fun profileGrowth(power: Int): Growth {
    val next = listOf(100, 300, 800, 2000, 5000).firstOrNull { power < it }
    return Growth(next, next?.let { (it - power).coerceAtLeast(0) } ?: 0,
        next?.let { (power.toFloat() / it).coerceIn(0f, 1f) } ?: 1f)
}
fun profileBadges(profile: ProfileRecord, groupCount: Int?): List<ProfileBadge> = listOf(
    ProfileBadge("first-post", "첫 게시", "완료한 실천을 뭉실에 처음 게시한 기록이에요.", "뭉실 운영팀", "첫 번째 실천 게시", profile.posts > 0),
    ProfileBadge("routine-maker", "루틴 메이커", "여러 TODO를 나만의 그룹으로 묶어 꾸준함을 시작한 기록이에요.", "뭉실 운영팀", "첫 번째 TODO 그룹 만들기", groupCount?.let { it > 0 }),
    ProfileBadge("rank-piece", "조각구름", "작은 실천을 쌓아 누적 뭉실력 100에 도착한 등급 배지예요.", "뭉실 운영팀", "누적 뭉실력 100 달성", profile.power >= 100),
) + profile.awards

private fun JsonObject.requiredText(name: String): String = text(name).takeIf(String::isNotBlank)
    ?: throw ApiException(502, "기록 정보를 확인하지 못했어요. 다시 시도해주세요.", "PROFILE_RESPONSE_INVALID")
private fun JsonObject.requiredCount(name: String): Int = text(name).toIntOrNull()?.takeIf { it >= 0 }
    ?: throw ApiException(502, "기록 수치를 확인하지 못했어요. 다시 시도해주세요.", "PROFILE_RESPONSE_INVALID")
fun parseProfile(source: JsonObject): ProfileRecord {
    val counts = source.child("_count"); val stats = source.child("stats")
    return ProfileRecord(source.requiredText("id"), source.requiredText("handle"), source.requiredText("nickname"),
        source.text("avatarUrl"), source.text("bio"), source.strings("interests"), source.requiredText("rank"),
        source.requiredCount("lifetimePower"), source.requiredCount("availablePoints"), counts.requiredCount("posts"),
        counts.requiredCount("followers"), counts.requiredCount("following"), stats.requiredCount("completedCount"),
        stats.requiredCount("receivedCheers"), stats.requiredCount("copiedCount"), source.list("earnedTitles").map { award ->
            val challenge = award.child("challenge"); val title = award.requiredText("titleAwarded")
            val challengeTitle = challenge.requiredText("title"); val challengeId = challenge.requiredText("id")
            val position = award.number("finalRank").takeIf { it > 0 }
            ProfileBadge("challenge-$challengeId-$title", title,
                challenge.text("description").ifBlank { "‘$challengeTitle’에서 꾸준히 실천해 받은 칭호예요." },
                challenge.child("creator").text("nickname").ifBlank { if(challenge.text("kind") == "OFFICIAL") "뭉실 운영팀" else "챌린지 방장" },
                "$challengeTitle ${position?.let { "최종 ${it}위" } ?: "완주"}", true, challengeId, challengeTitle)
        })
}
interface ProfileSource {
    suspend fun profile(): ProfileRecord
    suspend fun groups(): List<ProfileGroup>
    suspend fun posts(handle: String): List<ProfilePost>
}
class ProfileRepository(private val api: Api) : ProfileSource {
    override suspend fun profile() = parseProfile(api.request("me").obj())
    override suspend fun groups(): List<ProfileGroup> {
        val response = api.request("todo-lists")
        if(!response.isJsonArray) throw ApiException(502, "그룹 목록을 확인하지 못했어요. 다시 시도해주세요.", "PROFILE_RESPONSE_INVALID")
        return response.rows().map {
        if(it.get("items")?.isJsonArray != true) throw ApiException(502, "그룹 구성을 확인하지 못했어요. 다시 시도해주세요.", "PROFILE_RESPONSE_INVALID")
        ProfileGroup(it.requiredText("id"), it.requiredText("title"), it.text("description"), it.list("items").size,
            if(it.get("copyCount")?.isJsonNull == false) it.requiredCount("copyCount") else it.child("_count").requiredCount("copies"))
        }
    }
    override suspend fun posts(handle: String): List<ProfilePost> {
        val response = api.request("public/users/$handle/posts", query = mapOf("limit" to "6")).obj()
        if(response.get("items")?.isJsonArray != true) throw ApiException(502, "게시 기록을 확인하지 못했어요. 다시 시도해주세요.", "PROFILE_RESPONSE_INVALID")
        return response.list("items").map {
        ProfilePost(it.requiredText("id"), it.child("todoList").text("title").ifBlank { it.list("todos").firstOrNull()?.text("title").orEmpty() },
            it.text("thumbnailUrl").ifBlank { it.text("mediaUrl") }, it.requiredCount("cheerCount"))
        }
    }
}
