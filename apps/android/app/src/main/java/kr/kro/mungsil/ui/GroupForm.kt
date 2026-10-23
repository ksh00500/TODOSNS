package kr.kro.mungsil.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.gson.*
import kr.kro.mungsil.data.*
import java.time.*

fun groupOwnerOf(todo: JsonObject, groups: List<JsonObject>): JsonObject? {
    todo.child("group").takeIf { it.text("id").isNotBlank() }?.let { return it }
    return groups.firstOrNull { group -> group.list("items").any { item ->
        val member = item.child("todo")
        member.text("id") == todo.text("id") || todo.text("seriesId").isNotBlank() && member.text("seriesId") == todo.text("seriesId")
    } }
}

@Composable fun TodoSectionNav(active: String, navigate: (String) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(4.dp)) {
            listOf("todos" to "일정", "groups" to "그룹", "categories" to "카테고리").forEach { (route, name) ->
                TextButton({ if(route != active) navigate(route) }, Modifier.weight(1f).heightIn(min = 48.dp).semantics { selected = active == route },
                    colors = ButtonDefaults.textButtonColors(containerColor = if(route == active) MaterialTheme.colorScheme.surface else androidx.compose.ui.graphics.Color.Transparent)) { Text(name) }
            }
        }
    }
}

@Composable fun GroupForm(api: Api, zone: ZoneId, source: JsonObject?, groups: List<JsonObject>, close: () -> Unit, saved: () -> Unit, remove: (() -> Unit)? = null) {
    var title by rememberSaveable { mutableStateOf(source?.text("title").orEmpty()) }
    var description by rememberSaveable { mutableStateOf(source?.text("description").orEmpty()) }
    var query by rememberSaveable { mutableStateOf("") }
    var from by rememberSaveable { mutableStateOf(LocalDate.now(zone).minusDays(60).toString()) }
    var to by rememberSaveable { mutableStateOf(LocalDate.now(zone).plusDays(60).toString()) }
    var chosenJson by rememberSaveable { mutableStateOf(Gson().toJson(source?.list("items")?.map { it.child("todo") }.orEmpty())) }
    val chosen = JsonParser.parseString(chosenJson).rows()
    val original = rememberSaveable { listOf(title, description, chosen.map { it.text("id") }.joinToString("|")) }
    fun choose(values: List<JsonObject>) { chosenJson = Gson().toJson(values.distinctBy { it.text("id") }) }
    val range = runCatching { LocalDate.parse(from) to LocalDate.parse(to) }.getOrNull()
    val validRange = range != null && range.first <= range.second
    val parameters = if(validRange) mapOf("query" to query.trim(), "from" to dayRange(range!!.first, zone).first, "to" to dayRange(range.second, zone).second) else emptyMap()
    val candidates = rememberPaged(api, "todos/search", true, 0, parameters, enabled = validRange)
    val action = rememberAction()
    val submission = rememberDraftSubmission(source?.text("id"))
    NativeSheet(if(source == null) "새 TODO 그룹" else "TODO 그룹 편집", close, !action.busy,
        dirty = original != listOf(title, description, chosen.map { it.text("id") }.joinToString("|"))) {
        Field("그룹 이름", title, { title = it }, 100, enabled = !action.busy)
        Field("짧은 설명 (선택)", description, { description = it }, 300, multiline = true, enabled = !action.busy)
        Text("선택한 TODO · ${chosen.size}/30개", fontWeight = FontWeight.Bold)
        if(chosen.isEmpty()) Text("아래에서 TODO를 하나 이상 선택해주세요.", color = Muted)
        chosen.forEach { todo ->
            Surface(shape = MaterialTheme.shapes.medium, color = Aqua) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    GroupTodoDetails(todo, zone)
                    TextButton({ choose(chosen.filterNot { it.text("id") == todo.text("id") }) }, enabled = !action.busy,
                        modifier = Modifier.semantics { contentDescription = "${todo.text("title")} 선택 해제" }) { Text("선택 해제") }
                }
            }
        }
        Field("TODO 제목 검색", query, { query = it }, 120, enabled = !action.busy)
        DateControl(from, { from = it }, "조회 시작일", enabled = !action.busy)
        DateControl(to, { to = it }, "조회 종료일", enabled = !action.busy)
        if(!validRange) ErrorNotice("종료일은 시작일 이후로 선택해주세요.")
        Text("검색 결과 · ${candidates.rows.size}개 표시", fontWeight = FontWeight.Bold)
        Text("기간을 넓히거나 제목으로 오래된 TODO도 찾을 수 있어요. 검색을 바꿔도 선택한 TODO는 유지돼요.", color = Muted)
        candidates.rows.forEach { todo ->
            val selected = chosen.any { it.text("id") == todo.text("id") }
            val owner = groupOwnerOf(todo, groups)
            val otherGroup = owner != null && owner.text("id") != source?.text("id")
            val enabled = !action.busy && !otherGroup && (selected || chosen.size < 30)
            Surface(shape = MaterialTheme.shapes.medium, color = if(selected) Aqua else MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, if(selected) Brand else MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${todo.text("title")} 선택" }.toggleable(selected, enabled = enabled, role = Role.Checkbox) {
                    choose(if(it) chosen + todo else chosen.filterNot { entry -> entry.text("id") == todo.text("id") })
                }) {
                Row(Modifier.padding(12.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(selected, null, enabled = enabled)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        GroupTodoDetails(todo, zone)
                        if(otherGroup) Text("${owner!!.text("title", "다른")} 그룹에 포함됨", color = Muted)
                    }
                }
            }
        }
        if(validRange) PageStatus(candidates)
        ActionFeedback(action)
        Primary(if(action.busy) "저장 중…" else if(source == null) "TODO 그룹 만들기" else "그룹 변경사항 저장", title.isNotBlank() && !action.busy) {
            if(chosen.isEmpty()) action.notice = "TODO를 하나 이상 선택해주세요."
            else {
                val payload = json("title" to title.trim(), "description" to description.trim().ifBlank { null }, "todoIds" to chosen.map { it.text("id") }).apply {
                    if(source == null) addProperty("visibility", "PRIVATE")
                }
                action.run {
                    api.request("todo-lists" + (source?.let { "/${it.text("id")}" } ?: ""), if(source == null) "POST" else "PATCH", payload, key = submission.keyFor(payload))
                    submission.succeeded(); saved(); close()
                }
            }
        }
        remove?.let { TextButton(it, enabled = !action.busy) { Text("그룹 삭제", color = MaterialTheme.colorScheme.error) } }
    }
}

@Composable private fun GroupTodoDetails(todo: JsonObject, zone: ZoneId) {
    Text(todo.text("title"), fontWeight = FontWeight.Bold)
    val due = runCatching { Instant.parse(todo.text("dueDate")) }.getOrNull()
    Text(if(due == null) "일정 확인 필요" else "${due.atZone(zone).toLocalDate()} · ${localTime(todo.text("dueDate"), zone)}", color = Muted)
    Text("${todo.child("categoryRef").text("name", todo.text("category"))} · ${repeatLabel(todo.text("repeatRule"))}", color = Muted)
}
