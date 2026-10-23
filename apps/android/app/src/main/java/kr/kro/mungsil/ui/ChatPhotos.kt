package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import kr.kro.mungsil.data.newKey

data class ChatPhoto(val key: String, val mediaId: String? = null)
/** Stable slot identities keep picker drafts attached to the right photo after removal. */
class ChatPhotos(initial: List<ChatPhoto> = emptyList()) {
    var entries by mutableStateOf(initial.toList()); private set
    val incomplete: Boolean get() = entries.any { it.mediaId.isNullOrBlank() }
    val mediaIds: List<String> get() = entries.mapNotNull { it.mediaId }
    fun add(): Boolean {
        if(entries.size >= 4) return false
        entries = entries + ChatPhoto(newKey()); return true
    }
    fun update(key: String, mediaId: String?) { entries = entries.map { if(it.key == key) it.copy(mediaId = mediaId?.takeIf(String::isNotBlank)) else it } }
    fun remove(key: String) { entries = entries.filterNot { it.key == key } }
    fun clear() { entries = emptyList() }
    companion object {
        val StateSaver = Saver<ChatPhotos, List<String>>(
            save = { draft -> draft.entries.flatMap { listOf(it.key, it.mediaId.orEmpty()) } },
            restore = { saved -> ChatPhotos(saved.chunked(2).filter { it.size == 2 }.take(4).map { ChatPhoto(it[0], it[1].takeIf(String::isNotBlank)) }) },
        )
    }
}
