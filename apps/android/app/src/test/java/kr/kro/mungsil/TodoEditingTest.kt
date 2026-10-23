package kr.kro.mungsil

import androidx.compose.runtime.saveable.SaverScope
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import org.junit.Test
import org.junit.Assert.*
import java.time.ZoneId

class TodoEditingTest {
    private val zone = ZoneId.of("Asia/Seoul")
    private val source = json("id" to "todo", "dueDate" to "2026-09-28T00:00:30.123Z", "seriesId" to "series", "repeatRule" to "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2")
    private fun draft(rule: String = source.text("repeatRule"), scope: String = "THIS") =
        TodoDraft(" 바뀐 제목 ", " 메모 ", "2026-09-28", "09:00", "생활", "custom", rule, "FOLLOWERS", "group", scope)

    @Test fun titleEditPreservesExactInstantAndUnknownRelationsAndComplexRepeat() {
        val body = todoWritePayload(draft(), source, false, zone, false, false)
        assertEquals(source.text("dueDate"), body.text("dueDate"))
        assertEquals(source.text("repeatRule"), body.text("repeatRule"))
        assertEquals("바뀐 제목", body.text("title")); assertEquals("메모", body.text("notes"))
        assertEquals("FOLLOWERS", body.text("visibility")); assertEquals("THIS", body.text("recurrenceScope"))
        assertFalse(body.has("category")); assertFalse(body.has("categoryId")); assertFalse(body.has("todoListId"))
    }
    @Test fun explicitFutureChangeUsesAccountTimeAndChosenRelations() {
        val body = todoWritePayload(draft("FREQ=WEEKLY", "FUTURE").copy(date = "2026-09-29", time = "10:15"), source, false, zone, true, true)
        assertEquals("2026-09-29T01:15:00Z", body.text("dueDate"))
        assertEquals("FUTURE", body.text("recurrenceScope")); assertEquals("FREQ=WEEKLY", body.text("repeatRule"))
        assertEquals("custom", body.text("categoryId")); assertEquals("group", body.text("todoListId"))
    }
    @Test fun removingRepeatAndCloningHaveDistinctRequestContracts() {
        val detached = todoWritePayload(draft(""), source, false, zone, true, true)
        assertTrue(detached.get("repeatRule").isJsonNull); assertEquals("THIS", detached.text("recurrenceScope"))
        val clone = todoWritePayload(draft().copy(date = "2026-10-01", visibility = "PRIVATE", groupId = ""), source, true, zone, true, true)
        assertEquals("2026-10-01T00:00:00Z", clone.text("dueDate")); assertTrue(clone.flag("keepRepeat"))
        assertFalse(clone.has("recurrenceScope")); assertTrue(clone.get("todoListId").isJsonNull)
    }
    @Test fun repeatPresentationKeepsLegacyAndComplexRawRules() {
        assertEquals("평일", repeatLabel("WEEKDAYS"))
        assertEquals(1, repeatChoices("WEEKDAYS").count { it.second == "평일" })
        assertTrue(repeatChoices("WEEKDAYS").contains("WEEKDAYS" to "평일"))
        assertTrue(repeatChoices(source.text("repeatRule")).contains(source.text("repeatRule") to "원본 반복 유지"))
    }
    @Test fun groupOwnershipUsesServerOrKnownRecurringMembership() {
        val group = json("id" to "owner", "items" to listOf(json("todo" to source)))
        assertEquals("owner", groupOwnerOf(json("id" to "next", "seriesId" to "series"), listOf(group))!!.text("id"))
        assertEquals("server-owner", groupOwnerOf(json("id" to "next", "seriesId" to "series", "group" to json("id" to "server-owner")), listOf(group))!!.text("id"))
        assertNull(groupOwnerOf(json("id" to "other"), listOf(group)))
    }
    @Test fun failedSubmissionKeepsKeyAcrossRestoreAndTransientDraftChanges() {
        val submission = DraftSubmission()
        val body = todoWritePayload(draft(), source, false, zone, false, false)
        val first = submission.keyFor(body)
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val restored = DraftSubmission.StateSaver.restore(with(DraftSubmission.StateSaver) { scope.save(submission) }!!)!!
        assertEquals(first, restored.keyFor(body.deepCopy()))
        val changed = body.deepCopy().apply { addProperty("title", "다른 제목") }
        assertNotEquals(first, restored.keyFor(changed))
    }
    @Test fun successfulSubmissionUsesNewKeyForAnotherIdenticalAction() {
        val submission = DraftSubmission(); val body = json("title" to "새 TODO")
        val first = submission.keyFor(body); submission.succeeded()
        assertNotEquals(first, submission.keyFor(body))
    }
}
