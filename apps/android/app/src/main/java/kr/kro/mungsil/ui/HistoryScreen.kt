package kr.kro.mungsil.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.awaitCancellation
import kr.kro.mungsil.data.*
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.net.URLEncoder

internal fun historySelection(values: List<String>, owner: String): HistoryRange? = runCatching {
    if(owner.isBlank() || values.size != 3 || values.first() != owner) return null
    HistoryRange(LocalDate.parse(values[1]), LocalDate.parse(values[2]))
}.getOrNull()

internal fun historyScheduleRoute(record: HistoryRecord, zone: ZoneId) =
    "schedule/${record.dueAt.atZone(zone).toLocalDate()}?zone=${URLEncoder.encode(zone.id, "UTF-8")}"

@Composable fun HistoryScreen(api: Api, zone: ZoneId, revision: Int, navigate: (String) -> Unit) {
    val owner = LocalTodoDraftOwner.current
    key(owner) {
        if(owner.isBlank()) PageList { item { EmptyState("로그인이 필요해요", "로그인 상태를 확인한 뒤 완료 기록을 다시 열어주세요.") } }
        else HistoryContent(api, zone, revision, navigate, owner)
    }
}

@Composable private fun HistoryContent(api: Api, contextZone: ZoneId, revision: Int, navigate: (String) -> Unit, owner: String) {
    // Only account-stamped dates are saveable. Rows, notes and cursors stay in memory.
    var savedSelection by rememberSaveable { mutableStateOf(listOf(owner)) }
    val selection = historySelection(savedSelection, owner)
    val sessionVersion = remember(api, owner) { api.sessionVersion }
    val model: HistoryModel = viewModel(key = "history-$owner-$sessionVersion", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = HistoryModel(HistoryRepository(api, sessionVersion)) as T
    })
    val state = model.state.collectAsStateWithLifecycle().value.forQuery(selection, contextZone)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, selection, contextZone, revision, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { model.load(selection, contextZone); awaitCancellation() }
    }
    var period by rememberSaveable { mutableStateOf(false) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(state.loading, state.error, state.rows) {
        if(state.loading || state.error != null || state.rows.none { it.id == selectedId }) selectedId = null
    }
    val displayZone = state.zone ?: contextZone
    val grouped = state.rows.groupBy { it.completedAt.atZone(displayZone).toLocalDate() }
    val canInspect = !state.loading && state.error == null
    val dateFormat = remember { DateTimeFormatter.ofPattern("yyyy년 M월 d일 (E)", Locale.KOREAN) }
    val stamp = remember { DateTimeFormatter.ofPattern("yyyy년 M월 d일 HH:mm", Locale.KOREAN) }
    PageList {
        item { Heading("내가 마친 실천", "실제로 완료한 날짜별로 모았어요. 완료 취소·삭제한 항목은 새로고침하면 제외돼요.") }
        item { CloudCard {
            Text(state.range?.let { "조회 기간 · ${it.from} ~ ${it.to}" } ?: selection?.let { "조회 기간 · ${it.from} ~ ${it.to}" } ?: "최근 7일 · 계정 날짜를 확인하고 있어요.")
            Text("시간대 · ${displayZone.id}", color = Muted, style = MaterialTheme.typography.bodySmall)
            OutlinedButton({ period = true }) { Text("기간 설정") }
            TextButton({ if(selection == null) model.refresh() else savedSelection = listOf(owner) }) { Text("최근 7일") }
        } }
        if(state.loading) item {
            Text(if(state.hasData) "기록을 새로 확인하고 있어요." else "완료 기록을 불러오고 있어요.", Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Muted)
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        if(state.error != null) item {
            if(state.hasData) Text("마지막으로 확인한 기록이에요.", color = Muted)
            ErrorNotice(state.error, model::refresh)
        }
        if(state.notice != null) item { Text(state.notice, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Muted) }
        if(state.total != null) item {
            Text("기간 전체 ${state.total}개 완료", style = MaterialTheme.typography.titleLarge)
            Text("${state.rows.size}개 표시", color = Muted, style = MaterialTheme.typography.bodySmall)
            state.checkedAt?.let { Text("마지막 확인 · ${it.atZone(displayZone).format(stamp)}", color = Muted, style = MaterialTheme.typography.bodySmall) }
        }
        if(state.hasData && !state.loading && state.error == null && state.rows.isEmpty()) item {
            EmptyState("이 기간에는 완료한 실천이 없어요", "다른 기간을 선택하거나 실천을 마친 뒤 다시 확인해보세요.")
        }
        grouped.forEach { (date, records) ->
            item(key = "history-date-$date") { Text(date.format(dateFormat), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() }) }
            items(records, key = { "history-${it.id}" }) { record ->
                Surface(shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth().clickable(enabled = canInspect, role = Role.Button, onClickLabel = "기록 상세 보기") { selectedId = record.id }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(record.title, style = MaterialTheme.typography.titleMedium)
                        Text("완료 · ${record.completedAt.atZone(displayZone).format(DateTimeFormatter.ofPattern("HH:mm"))}", color = Brand)
                        Text("예정 · ${record.dueAt.atZone(displayZone).format(stamp)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                        Text(record.category, color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if(state.moreError != null) item { ErrorNotice(state.moreError, model::more) }
        if(state.nextCursor != null && state.moreError == null) item {
            Primary(if(state.loadingMore) "기록을 더 불러오는 중…" else "더 보기", !state.loading && !state.loadingMore && state.error == null, model::more)
        }
        item { TextButton(model::refresh, enabled = !state.loading && !state.loadingMore) { Text("새로고침") } }
    }
    if(period) HistoryPeriodSheet(selection ?: state.range ?: HistoryRange.recent(displayZone), { period = false }) {
        savedSelection = listOf(owner, it.from.toString(), it.to.toString()); period = false; selectedId = null
    }
    state.rows.firstOrNull { it.id == selectedId && canInspect }?.let { record ->
        NativeSheet("완료 기록 상세", { selectedId = null }) {
            Text(record.title, style = MaterialTheme.typography.titleLarge)
            Text("완료 · ${record.completedAt.atZone(displayZone).format(stamp)}")
            Text("예정 · ${record.dueAt.atZone(displayZone).format(stamp)}", color = Muted)
            Text("시간대 · ${displayZone.id}", color = Muted)
            Text("카테고리 · ${record.category}")
            Text("반복 · ${repeatLabel(record.repeatRule)}")
            Text("공개 범위 · ${when(record.visibility) { "PUBLIC" -> "전체 공개"; "FOLLOWERS" -> "팔로워"; else -> "나만 보기" }}")
            Text("메모", style = MaterialTheme.typography.labelLarge)
            Text(record.notes.ifBlank { "남긴 메모가 없어요." })
            Primary("일정에서 보기") { selectedId = null; navigate(historyScheduleRoute(record, displayZone)) }
        }
    }
}

@Composable private fun HistoryPeriodSheet(initial: HistoryRange, close: () -> Unit, apply: (HistoryRange) -> Unit) {
    var from by rememberSaveable { mutableStateOf(initial.from.toString()) }
    var to by rememberSaveable { mutableStateOf(initial.to.toString()) }
    val range = runCatching { HistoryRange(LocalDate.parse(from), LocalDate.parse(to)) }.getOrNull()
    NativeSheet("기록 기간 설정", close, dirty = from != initial.from.toString() || to != initial.to.toString()) {
        DateControl(from, { from = it }, "조회 시작일")
        DateControl(to, { to = it }, "조회 종료일")
        Text("계정 시간대로 1~90일을 선택할 수 있어요.", color = Muted)
        if(range == null) ErrorNotice("시작일·종료일과 90일 이내의 범위를 확인해주세요.")
        Primary("이 기간 보기", range != null) { range?.let(apply) }
    }
}
