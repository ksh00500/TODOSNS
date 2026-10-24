@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.google.gson.*
import kr.kro.mungsil.data.*
import java.time.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitCancellation

@Composable fun TodosScreen(api: Api, zone: ZoneId, today: Boolean, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, initialDate: String? = null, nickname: String = "뭉실", clock: Clock = Clock.systemUTC()) {
    val owner = LocalTodoDraftOwner.current
    key(owner) { TodosScreenContent(api, zone, today, revision, changed, navigate, initialDate, nickname, clock, owner) }
}

@Composable private fun TodosScreenContent(api: Api, zone: ZoneId, today: Boolean, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, initialDate: String?, nickname: String, clock: Clock, owner: String) {
    var selectedDate by rememberSaveable(today) { mutableStateOf(initialDate ?: accountToday(clock, zone).toString()) }
    val date = if(today) rememberAccountToday(zone, clock) else LocalDate.parse(selectedDate)
    val model: TodoModel = viewModel(key = "todos-$today-$owner-${api.sessionVersion}", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = TodoModel(TodoRepository(api), clock) as T
    })
    val state = model.state.collectAsStateWithLifecycle().value.forQuery(date, zone)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(date, zone, revision, lifecycle, model) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { model.load(date, zone); awaitCancellation() }
    }
    val groups = rememberRemote(api, owner) { api.request("todo-lists").also {
        if(!it.isJsonArray) throw ApiException(502, "그룹을 확인하지 못했어요.")
    } }
    var groupsRevision by remember { mutableIntStateOf(revision) }
    LaunchedEffect(revision) { if(groupsRevision != revision) { groupsRevision = revision; groups.reload() } }
    val day = todoDayPresentation(state, groups.data?.rows().orEmpty(), today)
    val todos = day.rows.map { it.source }
    val next = day.next?.source
    var ended by rememberJsonState()
    var removed by rememberJsonState()
    val restoreSubmission = rememberDraftSubmission("restore")
    var collapsedGroups by rememberSaveable { mutableStateOf(listOf<String>()) }
    val collapsedSnapshot = collapsedGroups.toSet()
    var edit by rememberJsonState()
    var creating by rememberSaveable { mutableStateOf(false) }
    var publish by rememberJsonState()
    var delete by rememberJsonState()
    var menu by rememberJsonState()
    val action = rememberAction()
    val canWrite = state.canWrite && !action.busy
    PageList {
        item {
            if(today) {
                Text(date.format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 E요일", java.util.Locale.KOREAN)), color = Muted, style = MaterialTheme.typography.bodySmall)
                Heading("${nickname}님의 오늘", when {
                    !state.hasLoaded -> "오늘의 작은 실천을 확인해요."
                    state.pending.isNotEmpty() -> "변경 결과를 확인하고 있어요."
                    state.loadError != null -> "마지막으로 확인한 실천을 보여드려요."
                    day.allDone -> "오늘 담은 실천을 모두 마쳤어요."
                    day.remaining > 0 -> "${day.remaining}개의 작은 실천이 남았어요."
                    else -> "가볍게 시작할 실천 하나를 담아보세요."
                })
            } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("날짜별로 가볍게 확인해요", color = Muted, style = MaterialTheme.typography.bodySmall); Heading("내 TODO") }
                FilledIconButton({ creating = true }, Modifier.size(48.dp)) { Icon(Icons.Rounded.Add, "TODO 추가") }
            }
        }
        if(!today) {
            item { TodoSectionNav("todos", navigate) }
            item {
                // Seven days need 308dp for 44dp targets inside the 360dp frame.
                CloudCard(inset = 8.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ActionIcon("이전 주", Icons.AutoMirrored.Rounded.ArrowBack) { if(state.pending.isEmpty()) selectedDate = date.minusWeeks(1).toString() }
                    Box(Modifier.weight(1f)) { DateControl(selectedDate, { if(state.pending.isEmpty()) selectedDate = it }, displayText = "${date.year}년 ${date.monthValue}월") }
                    ActionIcon("다음 주", Icons.Rounded.ArrowForward) { if(state.pending.isEmpty()) selectedDate = date.plusWeeks(1).toString() }
                }
                Row(Modifier.fillMaxWidth()) {
                    val monday = date.minusDays(date.dayOfWeek.value.toLong() - 1)
                    (0L..6L).forEach { offset ->
                        val day = monday.plusDays(offset)
                        TextButton({ if(state.pending.isEmpty()) selectedDate = day.toString() }, Modifier.weight(1f).heightIn(min = 52.dp).semantics { selected = day == date }, contentPadding = PaddingValues(0.dp), colors = ButtonDefaults.textButtonColors(containerColor = if(day == date) Brand else androidx.compose.ui.graphics.Color.Transparent, contentColor = if(day == date) androidx.compose.ui.graphics.Color.White else Muted)) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(listOf("월", "화", "수", "목", "금", "토", "일")[offset.toInt()]); Text(day.dayOfMonth.toString()) }
                        }
                    }
                }
                }
            }
            item { Heading(date.format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 E요일", java.util.Locale.KOREAN))); if(state.hasLoaded) Text("${todos.size}개의 할 일", color = Muted, style = MaterialTheme.typography.bodySmall) }
        }
        if(state.loading) item {
            CloudCard {
                Text(if(state.hasLoaded) "목록을 새로 확인하고 있어요." else "할 일을 불러오고 있어요.", Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
        if(state.loadError != null) item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if(state.hasLoaded) Text("마지막으로 확인한 목록이에요. ${state.lastLoadedAt?.atZone(zone)?.format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 HH:mm")) ?: ""}", color = Muted)
                ErrorNotice(state.loadError) { model.retry() }
            }
        }
        if(state.mutationError != null) item { ErrorNotice(state.mutationError) { model.retry() } }
        if(groups.error != null) item { ErrorNotice("그룹을 확인하지 못했어요. 할 일과 기존 소속은 유지돼요.") { groups.reload() } }
        if(groups.loading && groups.data == null) item { Text("그룹을 확인하고 있어요.", color = Muted, style = MaterialTheme.typography.bodySmall) }
        if(state.pending.isNotEmpty()) item { Text("변경 결과를 확인하고 있어요.", Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Brand) }
        if(today && state.hasLoaded) item {
            val progress = if(todos.isEmpty()) 0f else day.completed.toFloat() / todos.size
            Surface(color = if(day.allDone) Butter else androidx.compose.ui.graphics.Color.Transparent, shape = MaterialTheme.shapes.medium) {
            Column(Modifier.fillMaxWidth().padding(horizontal = if(day.allDone) 16.dp else 0.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if(state.pending.isNotEmpty()) "변경 중인 진행 상황" else "오늘의 흐름", color = Muted, style = MaterialTheme.typography.labelLarge)
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${day.completed} / ${todos.size} 완료", style = MaterialTheme.typography.titleMedium)
                    Text("${day.remaining}개 남았어요", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth()
                    .semantics { stateDescription = if(state.pending.isNotEmpty()) "변경 확인 중" else "전체 ${todos.size}개 중 ${day.completed}개 완료" },
                    gapSize = 0.dp, drawStopIndicator = {})
            }
            }
        }
        if(next != null) item {
            Surface(color = Sky.copy(alpha = .4f), shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("지금 할 일", color = Brand, style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
                    // Material's pill clips the outer glyphs of a tall, multiline
                    // title at 200% text. A small corner and inner inset keep the
                    // whole title readable without limiting its lines or height.
                    TextButton({ edit = next }, enabled = canWrite, modifier = Modifier.heightIn(min = 48.dp), shape = MaterialTheme.shapes.small, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)) { Text(next.text("title"), style = MaterialTheme.typography.headlineMedium, color = Ink) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        Surface(color = Meadow, shape = CircleShape) { Text(next.child("categoryRef").text("name", next.text("category")), Modifier.padding(horizontal = 10.dp, vertical = 5.dp), color = Brand, style = MaterialTheme.typography.bodySmall) }
                        Text("예정 · ${localTime(next.text("dueDate"), zone)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    day.featuredGroup?.let { Text("그룹 · ${it.group!!.text("title")} · ${it.completed}/${it.total} 완료", color = Muted) }
                    if(next.text("notes").isNotBlank()) Text(next.text("notes"), color = Muted, style = MaterialTheme.typography.bodyMedium)
                    Primary(if(state.pending.isNotEmpty()) "변경 확인 중…" else "이 실천 완료하기", canWrite) { model.toggle(next.text("id")) { changed(); publish = it.source } }
                }
            }
        }
        if(today) item {
            if(day.empty) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("오늘의 목록", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                Primary("TODO 추가", !action.busy && state.pending.isEmpty()) { creating = true }
            } else FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text("오늘의 목록", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                OutlinedButton({ creating = true }, modifier = Modifier.heightIn(min = 48.dp), enabled = !action.busy && state.pending.isEmpty()) { Icon(Icons.Rounded.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("TODO 추가") }
            }
        }
        item { ActionFeedback(action); removed?.let { todo ->
            Text("TODO를 삭제했어요. 연결된 게시물과 사진은 되돌리기로 복구되지 않아요.", color = Muted)
            TextButton({ action.run {
                api.request("todos/${todo.text("id")}/restore", "POST", key = restoreSubmission.keyFor(json("id" to todo.text("id"))))
                restoreSubmission.succeeded(); removed = null; changed()
            } }, enabled = !action.busy) { Text("삭제한 TODO 되돌리기") }
        } }
        if(day.empty) item { EmptyState(if(today) "오늘은 아직 담긴 실천이 없어요" else "아직 비어 있는 하루예요", "가볍게 시작할 TODO 하나를 적어보세요.") }
        day.clusters.forEach { cluster ->
            val clusterId = cluster.id
            val entries = cluster.entries
            val group = cluster.group
            if(group != null) item(key = "group/$clusterId") {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    HorizontalDivider()
                    val summary = "${group.text("title")} · ${cluster.completed}/${cluster.total} 완료"
                    if(today) TextButton({ collapsedGroups = if(clusterId in collapsedGroups) collapsedGroups - clusterId else collapsedGroups + clusterId }) { Text(summary + if(clusterId in collapsedSnapshot) " · 펼치기" else " · 접기") }
                    else Text(summary, style = MaterialTheme.typography.labelMedium, color = Muted)
                    Text("다음: ${cluster.nextTitle ?: if(state.pending.isNotEmpty()) "변경 확인 중" else "모두 완료"}", color = Muted)
                }
            }
            if(!today || clusterId !in collapsedSnapshot) items(entries, key = { it.id }) { record ->
            val todo = record.source
            val completed = todo.text("completedAt").isNotBlank()
            Surface(color = if(completed) Meadow.copy(alpha = .55f) else androidx.compose.ui.graphics.Color.Transparent, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Surface(color = MaterialTheme.colorScheme.surface, shape = CircleShape, border = BorderStroke(2.dp, if(completed) androidx.compose.ui.graphics.Color.Transparent else Brand), modifier = Modifier.size(48.dp).toggleable(completed, enabled = canWrite, role = Role.Checkbox, onValueChange = { model.toggle(todo.text("id")) { changed(); if(it.completedAt != null) publish = it.source } }).semantics { contentDescription = "${todo.text("title")} ${if(completed) "완료 취소" else "완료하기"}"; stateDescription = if(record.id in state.pending) "변경 확인 중" else if(completed) "완료" else "미완료" }) {
                        Box(contentAlignment = Alignment.Center) { if(completed) Icon(Icons.Rounded.Check, null, tint = Brand) }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(todo.child("categoryRef").text("name", todo.text("category")), color = Brand, style = MaterialTheme.typography.bodySmall)
                        Text(todo.text("title"), style = MaterialTheme.typography.titleMedium, color = if(completed) Muted else Ink, textDecoration = if(completed) TextDecoration.LineThrough else TextDecoration.None)
                        if(record.id in state.pending) Text("변경 확인 중", color = Brand, style = MaterialTheme.typography.bodySmall)
                        else if(completed) Text("완료 · ${Instant.parse(record.completedAt).atZone(zone).format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 HH:mm"))}", color = Muted, style = MaterialTheme.typography.bodySmall)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { Icon(Icons.Rounded.Schedule, null, Modifier.size(14.dp), tint = Muted); Text(localTime(todo.text("dueDate"), zone), color = Muted, style = MaterialTheme.typography.bodySmall) }
                    }
                    ActionIcon("${todo.text("title")} 메뉴", Icons.Rounded.MoreHoriz, canWrite) { menu = todo }
                }
            }
            }
        }
        item { TextButton({ model.retry(); groups.reload() }, enabled = !state.loading && !action.busy && state.pending.isEmpty()) { Text("새로고침") } }
    }
    menu?.let { todo -> NativeSheet(todo.text("title"), { menu = null }) {
        if(todo.text("notes").isNotBlank()) Text(todo.text("notes"))
        TextButton({ menu = null; edit = todo }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("편집") }
        if(todo.text("completedAt").isNotBlank()) TextButton({ menu = null; publish = todo }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("기록 게시") }
        TextButton({ menu = null; delete = todo }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("삭제") }
        if(todo.text("seriesId").isNotBlank()) TextButton({ menu = null; ended = todo }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("반복 종료") }
    } }
    ended?.let { todo -> ConfirmSheet("반복을 종료할까요?", "이 일정 이후의 반복을 종료해요. 이미 완료한 기록은 유지돼요.", "반복 종료", { ended = null }) { api.request("todos/${todo.text("id")}/series", "DELETE"); changed() } }
    if(creating || edit != null) TodoForm(api, zone, edit, date.toString(), false, { creating = false; edit = null }) { changed() }
    publish?.let { todo -> PublishSheet(api, todo, { publish = null }, changed) }
    delete?.let { todo -> ConfirmSheet("TODO를 삭제할까요?", "선택한 할 일과 연결된 게시물·사진이 삭제돼요. 반복 일정의 다른 날짜는 유지돼요. TODO를 되돌려도 게시물과 사진은 복구되지 않아요.", "삭제", { delete = null }) { api.request("todos/${todo.text("id")}", "DELETE"); removed = todo; changed() } }
}

@Composable fun TodoForm(api: Api, zone: ZoneId, source: JsonObject?, initialDate: String, clone: Boolean, close: () -> Unit, saved: () -> Unit) {
    val owner = LocalTodoDraftOwner.current
    key(owner, source?.text("id"), clone) { TodoFormContent(api, zone, source, initialDate, clone, owner, close, saved) }
}

@Composable private fun TodoFormContent(api: Api, zone: ZoneId, input: JsonObject?, initialDate: String, clone: Boolean, owner: String, close: () -> Unit, saved: () -> Unit) {
    val form = rememberTodoFormState(owner, input, clone, initialDate, zone)
    val source = form.source()
    val draft = form.draft
    val scope = rememberCoroutineScope()
    val sessionVersion = remember(api, owner) { api.sessionVersion }
    val categories = rememberRemote(api) { api.request("me/todo-categories").also {
        if(!it.isJsonArray) throw ApiException(502, "카테고리를 확인하지 못했어요. 기존 분류는 유지돼요.")
    } }
    val lists = rememberRemote(api) { api.request("todo-lists").also {
        if(!it.isJsonArray) throw ApiException(502, "그룹을 확인하지 못했어요. 기존 관계는 유지돼요.")
    } }
    val currentGroup = if(clone) "" else lists.data?.rows()?.firstOrNull { list -> list.list("items").any { val todo = it.child("todo"); source != null && (todo.text("id") == source.text("id") || source.text("seriesId").isNotBlank() && todo.text("seriesId") == source.text("seriesId")) } }?.text("id").orEmpty()
    LaunchedEffect(lists.data, lists.error) { if(lists.data != null && lists.error == null) form.observeGroup(currentGroup) }
    val groupId = if(form.chosenGroup) draft.groupId else form.originalGroup ?: currentGroup
    var validation by remember { mutableStateOf<String?>(null) }
    val loadedOptions = categories.data?.rows().orEmpty()
    val originalCategory = if(!clone) source?.child("categoryRef") else null
    val options = if(originalCategory?.text("id")?.isNotBlank() == true && loadedOptions.none { it.text("id") == originalCategory.text("id") }) listOf(originalCategory) + loadedOptions else loadedOptions
    val selectedCategoryId = draft.categoryId.ifBlank { options.firstOrNull { it.text("name") == draft.category || it.text("baseCategory") == draft.category }?.text("id").orEmpty() }
    NativeSheet(if(clone) "내 TODO로 가져오기" else if(source == null) "TODO 추가" else "TODO 편집", close, !form.busy, dirty = form.dirty,
        discardDetail = if(form.uncertain) "저장 요청이 이미 반영됐을 수 있어요. 닫아도 서버의 저장은 취소되지 않아요. 나중에 목록을 확인해주세요." else "저장하지 않은 내용이 사라져요.") {
        if(clone) {
            Text("원본 실천 · ${source?.text("title").orEmpty()}",color = Muted)
            Text("내 일정에 새 TODO로 저장해요. 원본 실천은 바뀌지 않아요.",color = Muted)
        }
        Field("할 일", draft.title, { value -> form.update { it.copy(title = value) } }, 120, enabled = form.editable)
        Field("메모 (선택)", draft.notes, { value -> form.update { it.copy(notes = value) } }, 500, multiline = true, enabled = form.editable)
        DateControl(draft.date, { value -> form.update { it.copy(date = value) } }, enabled = form.editable)
        TimeControl(draft.time, form.editable) { value -> form.update { it.copy(time = value) } }
        Text("시간대 · ${form.zoneId}", color = Muted, style = MaterialTheme.typography.bodySmall)
        if(categories.loading) Text("카테고리를 확인하고 있어요. 기존 분류는 유지돼요.", color = Muted)
        if(source == null || clone || categories.data != null && categories.error == null) ChoiceControl("카테고리", if(options.isEmpty()) baseCategories.map { it to it } else options.map { it.text("id") to it.text("name") }, if(options.isEmpty()) draft.category else selectedCategoryId, form.editable && !categories.loading) { selected ->
            form.update { if(options.isEmpty()) it.copy(category = selected, categoryId = "") else it.copy(categoryId = selected, category = options.first { option -> option.text("id") == selected }.text("baseCategory")) }
        }
        ErrorNotice(categories.error) { categories.reload() }
        ChoiceControl("반복", repeatChoices(draft.repeatRule), draft.repeatRule, form.editable) { value -> form.update { it.copy(repeatRule = value) } }
        if(repeatLabel(draft.repeatRule) == "원본 반복 유지") Text("현재의 세부 반복 규칙을 그대로 유지해요. 다른 반복을 고르면 새 설정으로 바뀌어요.", color = Muted)
        if(lists.loading) Text("현재 그룹을 확인하고 있어요. 기존 관계는 유지돼요.", color = Muted)
        ErrorNotice(lists.error) { lists.reload() }
        if(lists.data != null && lists.error == null) ChoiceControl("그룹", listOf("" to "그룹 없음") + lists.data.rows().map { it.text("id") to it.text("title") }, groupId, form.editable && !lists.loading) { form.selectGroup(it) }
        ChoiceControl("공개 범위", listOf("PRIVATE" to "나만 보기", "FOLLOWERS" to "팔로워", "PUBLIC" to "전체 공개"), draft.visibility, form.editable) { value -> form.update { it.copy(visibility = value) } }
        if(source?.text("seriesId")?.isNotBlank() == true && !clone) {
            Choices("변경할 일정", listOf("THIS" to "이번 일정만", "FUTURE" to "이후 일정도"), draft.recurrenceScope, form.editable) { value -> form.update { it.copy(recurrenceScope = value) } }
            Text("선택한 날짜의 일정만 바꾸거나 이후 일정 전체에 적용할 수 있어요.", color = Muted)
        }
        ErrorNotice(validation)
        ErrorNotice(form.error)
        if(owner.isBlank()) ErrorNotice("로그인 상태를 확인한 뒤 다시 열어주세요.")
        Primary(if(form.busy) "저장 중…" else if(form.uncertain) "저장 결과 확인" else if(clone) "가져오기" else "저장", !form.busy && owner.isNotBlank() && (form.uncertain || draft.title.isNotBlank())) {
            val payload = if(form.uncertain) null else runCatching {
                require(draft.title.trim().isNotEmpty() && draft.title.codePointCount(0, draft.title.length) <= 120 && draft.notes.codePointCount(0, draft.notes.length) <= 500)
                todoWritePayload(draft.copy(categoryId = selectedCategoryId, groupId = groupId), source, clone, ZoneId.of(form.zoneId),
                    categoriesReady = categories.data != null && categories.error == null, groupsReady = lists.data != null && lists.error == null)
            }.getOrNull()
            validation = if(!form.uncertain && payload == null) "제목·메모 길이와 날짜·시간을 확인해주세요. 시간은 HH:mm 형식이에요." else null
            if(form.uncertain || payload != null) form.begin(payload)?.let { request -> scope.launch {
                val completed = try { sendTodoForm(api, request, sessionVersion); form.succeeded(request) }
                    catch(e: kotlinx.coroutines.CancellationException) { form.cancelled(request); throw e }
                    catch(e: Exception) { form.failed(request, e); false }
                if(completed) { saved(); close() }
            } }
        }
    }
}

@Composable fun CategoriesScreen(api: Api, revision: Int, changed: () -> Unit, navigate: (String) -> Unit = {}, zone: ZoneId = ZoneId.of("Asia/Seoul")) {
    val remote = rememberRemote(revision) {
        api.request("me/todo-categories", query = mapOf("archived" to "true")).also {
            if(!it.isJsonArray) throw ApiException(502, "카테고리 목록을 확인하지 못했어요. 다시 불러와주세요.")
        }
    }
    val categoryRows = remote.data?.rows().orEmpty()
    val activeCategories = categoryRows.filter { it.text("archivedAt").isBlank() }
    val archivedCategories = categoryRows.filter { it.text("archivedAt").isNotBlank() }
    var edit by rememberJsonState()
    var selected by rememberJsonState()
    var creating by rememberSaveable { mutableStateOf(false) }
    var ordering by rememberSaveable { mutableStateOf(false) }
    var showArchived by rememberSaveable { mutableStateOf(false) }
    PageList {
        item { Heading("카테고리", "내 생활에 맞는 분류"); TextButton({ ordering = true }, enabled = activeCategories.isNotEmpty() && remote.error == null) { Text("순서 편집") } }
        item { TodoSectionNav("categories", navigate) }
        remoteStatus(remote)
        items((listOf<JsonObject?>(null) + activeCategories).chunked(2)) { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { category ->
                    if(category == null) OutlinedButton({ creating = true }, Modifier.weight(1f).heightIn(min = 160.dp), shape = MaterialTheme.shapes.medium) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Rounded.Add, null); Text("새 카테고리"); Text("나만의 분류 만들기", style = MaterialTheme.typography.bodySmall) }
                    } else Surface(Modifier.weight(1f), shape = MaterialTheme.shapes.medium, color = categoryTone(category.text("color"))) {
                        Column(Modifier.padding(12.dp)) {
                            TextButton({ selected = category }, Modifier.fillMaxWidth().heightIn(min = 96.dp)) {
                                    Column { Icon(categoryIcon(category.text("icon")), null); Text(category.text("name"), style = MaterialTheme.typography.titleMedium); Text("${category.number("todoCount")}개") }
                            }
                            TextButton({ edit = category }) { Text("편집") }
                        }
                    }
                }
                if(pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        if(!remote.loading && remote.error == null && activeCategories.isEmpty()) item { EmptyState("사용 중인 카테고리가 없어요", "보관한 카테고리를 다시 켜거나 새로 만들어보세요.") }
        item { TextButton({ showArchived = !showArchived }) { Text("보관된 카테고리 ${if(showArchived) "접기" else "보기"}") } }
        if(showArchived) items(archivedCategories, key = { "archived/${it.text("id")}" }) { category ->
            CloudCard { Text("${category.text("name")} · 보관됨", style = MaterialTheme.typography.titleMedium); Text("기존 TODO는 유지돼요.", color = Muted); TextButton({ edit = category }) { Text("편집 · 다시 표시") } }
        }
    }
    if(creating || edit != null) {
        var name by rememberSaveable { mutableStateOf(edit?.text("name").orEmpty()) }
        var base by rememberSaveable { mutableStateOf(edit?.text("baseCategory") ?: "생활") }
        var color by rememberSaveable { mutableStateOf(edit?.text("color") ?: "lilac") }
        var icon by rememberSaveable { mutableStateOf(edit?.text("icon") ?: "tag") }
        var archived by rememberSaveable { mutableStateOf(edit?.text("archivedAt")?.isNotBlank() == true) }
        val default = edit?.flag("isDefault") == true
        val initial = rememberSaveable { listOf(name, base, color, icon, archived.toString()) }
        val action = rememberAction()
        val close = { creating = false; edit = null }
        val payload = if(default) json("archived" to archived) else json("name" to name.trim(), "baseCategory" to base, "color" to color, "icon" to icon).apply { if(edit != null) addProperty("archived", archived) }
        val submission = rememberDraftSubmission(edit?.text("id"), creating)
        NativeSheet("카테고리 ${if(creating) "추가" else "편집"}", close, !action.busy, dirty = initial != listOf(name, base, color, icon, archived.toString())) {
            if(default) { Text(name, style = MaterialTheme.typography.titleLarge); Text("기본 카테고리는 이름·기준·색상·아이콘을 바꿀 수 없어요. 목록에서 숨기거나 다시 표시할 수 있어요.", color = Muted) }
            else {
                Field("이름", name, { name = it }, 30, enabled = !action.busy)
                ChoiceControl("기본 분류", baseCategories.map { it to it }, base, !action.busy) { base = it }
                ChoiceControl("색상", listOf("aqua" to "민트", "blush" to "핑크", "butter" to "옐로", "lilac" to "라일락"), color, !action.busy) { color = it }
                ChoiceControl("아이콘", listOf("tag" to "태그", "home" to "생활", "heart" to "건강", "activity" to "운동", "graduation" to "공부", "book" to "독서", "brain" to "마음", "briefcase" to "커리어", "palette" to "취미"), icon, !action.busy) { icon = it }
            }
            if(edit != null) Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(archived, { archived = it }, enabled = !action.busy); Text("목록에서 숨기기") }
            ActionFeedback(action)
            Primary("저장", name.isNotBlank() && !action.busy) { action.run { api.request("me/todo-categories" + (edit?.let { "/${it.text("id")}" } ?: ""), if(creating) "POST" else "PATCH", payload, key = submission.keyFor(payload)); submission.succeeded(); changed(); close() } }
        }
    }
    if(ordering) CategoryOrderSheet(api, categoryRows, { ordering = false }, changed)
    selected?.let { category ->
        var status by rememberSaveable { mutableStateOf("ALL") }
        val page = rememberPaged(api, "me/todo-categories/${category.text("id")}/todos", true, revision, mapOf("status" to status))
        NativeSheet(category.text("name"), { selected = null }) {
            Choices("상태", listOf("ALL" to "전체", "OPEN" to "예정", "DONE" to "완료"), status, { status = it })
            page.rows.forEach { todo -> Text("${if(todo.text("completedAt").isBlank()) "예정" else "완료"} · ${todo.text("title")}"); TextButton({ selected = null; navigate("schedule/${localDate(todo.text("dueDate"), zone)}") }) { Text("${localDate(todo.text("dueDate"), zone)} · 일정 보기") } }
            PageStatus(page)
        }
    }
}

private fun categoryTone(value: String) = when(value) { "aqua" -> androidx.compose.ui.graphics.Color(0xFFC3ECE9); "blush" -> androidx.compose.ui.graphics.Color(0xFFFFDCE4); "butter" -> androidx.compose.ui.graphics.Color(0xFFF3F2C9); else -> androidx.compose.ui.graphics.Color(0xFFE8DEFF) }
private fun categoryIcon(value: String) = when(value) {
    "home" -> Icons.Rounded.Home; "heart" -> Icons.Rounded.FavoriteBorder; "activity" -> Icons.Rounded.FitnessCenter
    "graduation" -> Icons.Rounded.School; "book" -> Icons.Rounded.MenuBook; "brain" -> Icons.Rounded.Psychology
    "briefcase" -> Icons.Rounded.WorkOutline; "palette" -> Icons.Rounded.Palette; else -> Icons.Rounded.Label
}

@Composable fun GroupsScreen(api: Api, zone: ZoneId, revision: Int, changed: () -> Unit, navigate: (String) -> Unit = {}) {
    val owner = LocalTodoDraftOwner.current
    key(owner, api.sessionVersion) { GroupsScreenContent(api, zone, revision, changed, navigate) }
}

@Composable private fun GroupsScreenContent(api: Api, zone: ZoneId, revision: Int, changed: () -> Unit, navigate: (String) -> Unit) {
    val remote = rememberRemote(revision) {
        val response = api.request("todo-lists")
        if(!response.isJsonArray) throw ApiException(502, "그룹 목록을 확인하지 못했어요. 다시 시도해주세요.")
        response
    }
    val groups = remote.data?.rows().orEmpty()
    var creating by rememberSaveable { mutableStateOf(false) }
    var edit by rememberJsonState()
    var deleting by rememberJsonState()
    var publishing by rememberJsonState()
    PageList {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("TODO를 알아보기 쉽게 묶어요", color = Muted); Heading("그룹") }
            FilledIconButton({ creating = true }, Modifier.size(48.dp)) { Icon(Icons.Rounded.PlaylistAdd, "새 TODO 그룹 만들기") }
        } }
        item { TodoSectionNav("groups", navigate) }
        remoteStatus(remote)
        if(remote.data != null && remote.error == null && groups.isEmpty()) item { EmptyState("아직 만든 그룹이 없어요", "같이 실천할 TODO를 묶으면 일정 화면이 한결 단정해져요.") }
        items(groups, key = { it.text("id") }) { group ->
            val rows = group.list("items").map { it.child("todo") }
            CloudCard {
                Text("${rows.size}개 TODO · ${rows.count { it.text("completedAt").isNotBlank() }}개 완료", color = Muted)
                Text(group.text("title"), style = MaterialTheme.typography.titleLarge)
                Text(group.text("description").ifBlank { rows.take(2).joinToString(" · ") { it.text("title") } }, color = Muted)
                Text("다음: ${rows.firstOrNull { it.text("completedAt").isBlank() }?.text("title") ?: "모두 완료"}", color = Muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    rows.take(3).forEach { todo -> Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small) {
                        Text(todo.text("title"), Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall)
                    } }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ edit = group }) { Text("관리") }
                    OutlinedButton({ publishing = group }) { Text("루틴으로 게시") }
                }
            }
        }
    }
    if(creating || edit != null) GroupForm(api, zone, edit, groups, { creating = false; edit = null }, changed, edit?.let { group -> { deleting = group } })
    publishing?.let { group -> PublishSheet(api, group, { publishing = null }, changed, true) }
    deleting?.let { group -> ConfirmSheet("그룹을 삭제할까요?", "안에 있던 할 일은 유지돼요. 이 그룹으로 게시한 루틴 기록과 사진은 삭제되며 복구되지 않아요.", "그룹 삭제", { deleting = null }) {
        api.request("todo-lists/${group.text("id")}", "DELETE"); edit = null; changed()
    } }
}
