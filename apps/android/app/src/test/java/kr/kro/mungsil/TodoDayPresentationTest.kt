package kr.kro.mungsil

import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import org.junit.Test
import org.junit.Assert.*
import java.time.*

class TodoDayPresentationTest {
    private val zone = ZoneId.of("Asia/Seoul")
    private fun row(id: String, due: String, done: Boolean = false, series: String? = null) = TodoRecord.parse(
        json("id" to id, "title" to "실천 $id", "dueDate" to due, "completedAt" to if(done) "2026-10-23T03:00:00Z" else null, "seriesId" to series))
    private fun ready(rows: List<TodoRecord>) = TodoUiState(rows = rows, loading = false, hasLoaded = true)
    @Test fun nextUsesInstantThenIdRegardlessOfResponseOrderOrOffset() {
        val late = row("later", "2026-10-23T02:00:00Z")
        val b = row("b", "2026-10-23T09:00:00+09:00")
        val a = row("a", "2026-10-23T00:00:00Z")
        val done = row("done", "2026-10-22T23:00:00Z", true)
        for(rows in listOf(listOf(late,b,done,a), listOf(done,a,late,b))) {
            val day = todoDayPresentation(ready(rows), emptyList(), true)
            assertEquals("a", day.next!!.id); assertEquals(1,day.completed); assertEquals(3,day.remaining)
            assertEquals(listOf("b","later","done"), day.clusters.flatMap { it.entries }.map { it.id })
            assertEquals(rows.size, 1 + day.clusters.sumOf { it.entries.size })
        }
    }
    @Test fun groupSummaryCountsFeaturedMemberAndMatchesRecurringOccurrences() {
        val featured = row("today-occurrence", "2026-10-23T00:00:00Z", series = "series")
        val done = row("done", "2026-10-23T02:00:00Z", true)
        val group = json("id" to "group", "title" to "아침", "items" to listOf(
            json("todo" to json("id" to "other-occurrence", "seriesId" to "series")), json("todo" to json("id" to "done"))))
        val day = todoDayPresentation(ready(listOf(done, featured)), listOf(group), true)
        val cluster = day.clusters.single()
        assertEquals("group", cluster.id); assertEquals(2, cluster.total); assertEquals(1, cluster.completed)
        assertEquals("실천 today-occurrence", cluster.nextTitle)
        assertEquals(listOf("done"),cluster.entries.map { it.id }); assertEquals(featured,day.next)
        assertEquals(2,day.featuredGroup!!.total); assertEquals(1,day.featuredGroup.completed)
        val onlyFeatured = todoDayPresentation(ready(listOf(featured)),listOf(group),true)
        assertTrue(onlyFeatured.clusters.isEmpty()); assertEquals("group",onlyFeatured.featuredGroup!!.id)
        assertEquals(1,onlyFeatured.featuredGroup.total)
    }
    @Test fun scheduleKeepsEveryItemAndHasNoFeaturedDuplicate() {
        val a = row("a", "2026-10-23T00:00:00Z")
        val b = row("b", "2026-10-23T01:00:00Z", true)
        val day = todoDayPresentation(ready(listOf(b,a)), emptyList(), false)
        assertNull(day.next); assertEquals(listOf("a","b"),day.clusters.flatMap { it.entries }.map { it.id })
    }
    @Test fun unknownFailedRefreshingAndConfirmedEmptyAreDifferentStates() {
        for(state in listOf(TodoUiState(), TodoUiState(loading = false, loadError = "오류"), ready(emptyList()).copy(loading = true), ready(emptyList()).copy(loadError = "오류"))) {
            val day = todoDayPresentation(state, emptyList(), true)
            assertFalse(day.empty); assertFalse(day.allDone)
        }
        val confirmed = todoDayPresentation(ready(emptyList()), emptyList(), true)
        assertTrue(confirmed.empty); assertFalse(confirmed.allDone)
    }
    @Test fun optimisticLastCompletionIsNotCelebratedBeforeServerConfirmation() {
        val done = row("a", "2026-10-23T00:00:00Z", true)
        val pending = ready(listOf(done)).copy(pending = setOf("a"))
        assertFalse(todoDayPresentation(pending, emptyList(), true).allDone)
        assertFalse(pending.canWrite)
        assertTrue(todoDayPresentation(pending.copy(pending = emptySet()), emptyList(), true).allDone)
        assertFalse(todoDayPresentation(ready(listOf(done)).copy(loadError = "오류"), emptyList(), true).allDone)
    }
    @Test fun accountDateRollsAtSeoulMidnightIndependentOfUtcDeviceDate() {
        val before = Clock.fixed(Instant.parse("2026-10-23T14:59:59.900Z"), ZoneOffset.UTC)
        val after = Clock.offset(before, Duration.ofMillis(100))
        assertEquals(LocalDate.of(2026,10,23),accountToday(before,zone))
        assertEquals(LocalDate.of(2026,10,24),accountToday(after,zone))
        assertEquals(LocalDate.of(2026,10,23),accountToday(after,ZoneOffset.UTC))
        assertEquals(100L,nextDayCheckDelay(before,zone))
    }
    @Test fun dstDaysUseLocalMidnightBoundariesAndBoundClockRechecks() {
        val newYork = ZoneId.of("America/New_York")
        for((date,hours) in listOf(LocalDate.of(2026,3,8) to 23L, LocalDate.of(2026,11,1) to 25L)) {
            val (from,to) = dayRange(date,newYork)
            // Existing GET /todos uses an inclusive final millisecond, not an exclusive end.
            val midnight = Instant.parse(to).plusMillis(1)
            assertEquals(hours, Duration.between(Instant.parse(from),midnight).toHours())
            val before = Clock.fixed(midnight.minusMillis(250),ZoneOffset.UTC)
            assertEquals(date,accountToday(before,newYork)); assertEquals(250L,nextDayCheckDelay(before,newYork))
            assertEquals(date.plusDays(1),accountToday(Clock.offset(before,Duration.ofMillis(250)),newYork))
            assertEquals(60_000L,nextDayCheckDelay(Clock.fixed(Instant.parse(from),ZoneOffset.UTC),newYork))
        }
    }
}
