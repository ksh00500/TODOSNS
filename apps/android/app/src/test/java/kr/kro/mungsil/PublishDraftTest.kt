package kr.kro.mungsil

import kr.kro.mungsil.data.*
import org.junit.Test
import org.junit.Assert.*

class PublishDraftTest {
    @Test fun tagsMatchWebNormalizationAndDeduplicateBeforeLimit() {
        val first = addPublishTag(emptyList(), " ##ＡＢＣ_산책 ")
        assertEquals(listOf("abc_산책"), first.tags); assertNull(first.error); assertEquals("", first.draft)
        val full = listOf("abc_산책", "독서", "운동", "식사", "명상")
        assertEquals(full, addPublishTag(full, "#ABC_산책").tags)
        assertNull(addPublishTag(full, "#ABC_산책").error)
        val extra = addPublishTag(full, "여섯번째")
        assertEquals(full, extra.tags); assertEquals("여섯번째", extra.draft); assertNotNull(extra.error)
    }
    @Test fun badTagsStayEditableWithoutChangingCommittedTags() {
        for(value in listOf("두 단어", "산책!", "😊", "a".repeat(31))) {
            val result = addPublishTag(listOf("독서"), value)
            assertEquals(listOf("독서"), result.tags); assertEquals(value, result.draft); assertNotNull(result.error)
        }
        assertNull(addPublishTag(emptyList(), "a".repeat(30)).error)
    }
    @Test fun publishingUsesSingleOrGroupContractAndOptionalUploadedMedia() {
        val single = publishPayload("todo", false, "한마디", listOf("산책"), "FOLLOWERS", "media")
        assertEquals("todo", single.text("todoId")); assertFalse(single.has("todoListId")); assertEquals("media", single.text("mediaId"))
        val group = publishPayload("group", true, "", emptyList(), "PRIVATE", null)
        assertEquals("group", group.text("todoListId")); assertFalse(group.has("todoId")); assertFalse(group.has("mediaId"))
    }
}
