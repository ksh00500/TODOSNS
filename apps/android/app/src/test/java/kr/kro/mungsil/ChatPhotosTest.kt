package kr.kro.mungsil

import androidx.compose.runtime.saveable.SaverScope
import kr.kro.mungsil.ui.ChatPhotos
import org.junit.Test
import org.junit.Assert.*

class ChatPhotosTest {
    @Test fun fourPhotoLimitAndRemovalKeepOtherIdentities() {
        val draft = ChatPhotos()
        repeat(4) { assertTrue(draft.add()) }
        assertFalse(draft.add())
        val slots = draft.entries.toList()
        slots.forEachIndexed { index, slot -> draft.update(slot.key, "media-$index") }
        assertFalse(draft.incomplete)
        draft.remove(slots[1].key)
        assertEquals(listOf("media-0", "media-2", "media-3"), draft.mediaIds)
        draft.update(slots[1].key, "late-upload")
        assertEquals(listOf("media-0", "media-2", "media-3"), draft.mediaIds)
        assertTrue(draft.add())
        assertTrue(draft.incomplete)
    }
    @Test fun restoredIncompleteUploadBlocksSendingAndPreservesReadyPhotos() {
        val draft = ChatPhotos(); draft.add(); draft.add()
        draft.update(draft.entries[0].key, "uploaded")
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val saved = with(ChatPhotos.StateSaver) { scope.save(draft) }!!
        val restored = ChatPhotos.StateSaver.restore(saved)!!
        assertEquals(draft.entries, restored.entries)
        assertTrue(restored.incomplete)
        assertEquals(listOf("uploaded"), restored.mediaIds)
        restored.remove(restored.entries[1].key)
        assertFalse(restored.incomplete)
        restored.clear(); assertTrue(restored.mediaIds.isEmpty())
    }
}
