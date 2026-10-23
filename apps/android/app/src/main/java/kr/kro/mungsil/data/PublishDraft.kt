package kr.kro.mungsil.data

import com.google.gson.JsonObject
import java.text.Normalizer
import java.util.Locale

data class TagAddition(val tags: List<String>, val draft: String = "", val error: String? = null)
fun addPublishTag(tags: List<String>, value: String): TagAddition {
    val tag = Normalizer.normalize(value, Normalizer.Form.NFKC).trim().replace(Regex("^#+"), "").lowercase(Locale.KOREAN)
    if(tag.isBlank() || tag in tags) return TagAddition(tags)
    val error = when {
        tag.length > 30 -> "해시태그는 30자까지 입력할 수 있어요."
        !tag.matches(Regex("[\\p{L}\\p{N}_]+")) -> "해시태그는 글자, 숫자, 밑줄만 사용할 수 있어요."
        tags.size >= 5 -> "해시태그는 5개까지 추가할 수 있어요."
        else -> null
    }
    return if(error == null) TagAddition(tags + tag) else TagAddition(tags, value, error)
}
fun publishPayload(id: String, group: Boolean, caption: String, hashtags: List<String>, visibility: String, mediaId: String?): JsonObject =
    json((if(group) "todoListId" else "todoId") to id, "caption" to caption, "hashtags" to hashtags, "visibility" to visibility)
        .apply { mediaId?.let { addProperty("mediaId", it) } }
