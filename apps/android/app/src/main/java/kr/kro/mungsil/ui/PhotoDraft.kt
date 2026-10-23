package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable

/** URI references only; image bytes stay in the OS provider or app cache. */
class PhotoDraft(selected: String? = null, camera: String? = null) {
    var selectedUri by mutableStateOf(selected)
    var cameraUri by mutableStateOf(camera)
    companion object {
        val StateSaver = Saver<PhotoDraft, List<String>>(
            save = { listOf(it.selectedUri.orEmpty(), it.cameraUri.orEmpty()) },
            restore = { PhotoDraft(it[0].takeIf(String::isNotBlank), it[1].takeIf(String::isNotBlank)) },
        )
    }
}
@Composable fun rememberPhotoDraft(vararg keys: Any?): PhotoDraft = rememberSaveable(*keys, saver = PhotoDraft.StateSaver) { PhotoDraft() }
