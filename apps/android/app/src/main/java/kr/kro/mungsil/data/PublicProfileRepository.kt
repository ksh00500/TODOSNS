package kr.kro.mungsil.data

import com.google.gson.JsonObject

data class PublicPerson(val id: String, val handle: String, val nickname: String, val bio: String, val avatarUrl: String,
    val rank: String, val power: Int, val posts: Int, val followers: Int, val following: Int)
data class FollowStatus(val following: Boolean, val blocked: Boolean, val followers: Int, val followingCount: Int)

private fun invalidPerson(): Nothing = throw ApiException(502, "사용자 정보를 확인하지 못했어요. 다시 불러와주세요.", "PUBLIC_PROFILE_INVALID")
private fun JsonObject.personText(key: String) = text(key).takeIf { it.isNotBlank() } ?: invalidPerson()
private fun JsonObject.personCount(key: String) = text(key).toIntOrNull()?.takeIf { it >= 0 } ?: invalidPerson()
private fun JsonObject.personFlag(key: String) = when(text(key)) { "true" -> true; "false" -> false; else -> invalidPerson() }
fun parsePublicPerson(value: JsonObject): PublicPerson {
    val counts = value.child("_count")
    return PublicPerson(value.personText("id"), value.personText("handle"), value.personText("nickname"), value.text("bio"), value.text("avatarUrl"),
        value.personText("rank"), value.personCount("lifetimePower"), counts.personCount("posts"), counts.personCount("followers"), counts.personCount("following"))
}
fun parseFollowStatus(value: JsonObject) = FollowStatus(value.personFlag("following"), value.personFlag("blocked"), value.personCount("followerCount"), value.personCount("followingCount"))
interface PublicProfileSource {
    suspend fun profile(handle: String, auth: Boolean): PublicPerson
    suspend fun followStatus(id: String): FollowStatus
}
class PublicProfileRepository(private val api: Api) : PublicProfileSource {
    override suspend fun profile(handle: String, auth: Boolean) = parsePublicPerson(api.request("public/users/$handle", authenticated = auth).obj())
    override suspend fun followStatus(id: String) = parseFollowStatus(api.request("social/follow-state/$id").obj())
}
