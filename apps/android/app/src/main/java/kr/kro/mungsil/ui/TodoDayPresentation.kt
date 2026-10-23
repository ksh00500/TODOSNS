package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.google.gson.JsonObject
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kr.kro.mungsil.data.*
import java.time.*

data class TodoDayCluster(
    val id: String, val group: JsonObject?, val entries: List<TodoRecord>,
    val completed: Int, val total: Int, val nextTitle: String?,
)
data class TodoDayPresentation(
    val rows: List<TodoRecord>, val next: TodoRecord?, val clusters: List<TodoDayCluster>,
    val completed: Int, val remaining: Int, val empty: Boolean, val allDone: Boolean,
    val featuredGroup: TodoDayCluster?,
)

/** Pick by absolute due time, independent of response order or timestamp offset spelling. */
fun todoDayPresentation(state: TodoUiState, groups: List<JsonObject>, today: Boolean): TodoDayPresentation {
    val rows = state.rows.sortedWith(compareBy<TodoRecord> { it.completedAt != null }
        .thenBy { Instant.parse(it.dueDate) }.thenBy { it.id })
    fun groupFor(row: TodoRecord) = groups.firstOrNull { group -> group.list("items").any {
        val member = it.child("todo")
        member.text("id") == row.id || row.source.text("seriesId").isNotBlank() && member.text("seriesId") == row.source.text("seriesId")
    } }
    val membership = rows.associate { it.id to groupFor(it) }
    val next = if(today) rows.firstOrNull { it.completedAt == null } else null
    val clusters = rows.filterNot { it.id == next?.id }.groupBy { membership[it.id]?.text("id") ?: "todo/${it.id}" }.map { (id, entries) ->
        val group = membership[entries.first().id]
        // The featured TODO still belongs to its group and counts in its summary.
        val all = if(group == null) entries else rows.filter { membership[it.id]?.text("id") == id }
        TodoDayCluster(id, group, entries, all.count { it.completedAt != null }, all.size, all.firstOrNull { it.completedAt == null }?.title)
    }
    val completed = rows.count { it.completedAt != null }
    val settled = state.hasLoaded && !state.loading && state.loadError == null && state.pending.isEmpty()
    val featuredGroup = next?.let { membership[it.id] }?.let { group ->
        val members = rows.filter { membership[it.id]?.text("id") == group.text("id") }
        TodoDayCluster(group.text("id"), group, emptyList(), members.count { it.completedAt != null }, members.size, next.title)
    }
    return TodoDayPresentation(rows, next, clusters, completed, rows.size - completed,
        empty = settled && rows.isEmpty(), allDone = settled && rows.isNotEmpty() && completed == rows.size, featuredGroup = featuredGroup)
}

internal fun accountToday(clock: Clock, zone: ZoneId): LocalDate = clock.instant().atZone(zone).toLocalDate()
internal fun nextDayCheckDelay(clock: Clock, zone: ZoneId): Long {
    val now = clock.instant()
    val next = now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant()
    // Recheck wall-clock changes at least once a minute while the screen is resumed.
    return Duration.between(now, next).toMillis().coerceIn(1, 60_000)
}
@Composable internal fun rememberAccountToday(zone: ZoneId, clock: Clock): LocalDate {
    var date by remember(zone, clock) { mutableStateOf(accountToday(clock, zone)) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, zone, clock) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while(isActive) { date = accountToday(clock, zone); delay(nextDayCheckDelay(clock, zone)) }
        }
    }
    return date
}
