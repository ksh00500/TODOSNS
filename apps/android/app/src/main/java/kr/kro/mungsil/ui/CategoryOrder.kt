package kr.kro.mungsil.ui

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.focusable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*

@Composable fun CategoryOrderSheet(api: Api, categories: List<JsonObject>, close: () -> Unit, saved: () -> Unit) {
    val rows = remember(categories) { categories.filter { it.text("archivedAt").isBlank() } }
    var ids by rememberSaveable { mutableStateOf(rows.map { it.text("id") }) }
    val action = rememberAction()
    val submission = rememberDraftSubmission("category-order")
    val step = with(LocalDensity.current) { 72.dp.toPx() }
    fun move(id: String, target: Int): Boolean {
        if(action.busy) return false
        val from = ids.indexOf(id)
        if(from < 0 || target !in ids.indices || from == target) return false
        ids = ids.toMutableList().apply { removeAt(from); add(target, id) }.toList()
        return true
    }
    NativeSheet("카테고리 순서", close, !action.busy, dirty = ids != rows.map { it.text("id") }) {
        Text("길게 눌러 끌거나 이동 버튼을 사용하세요. 키보드는 ↑·↓·Home·End로 이동할 수 있어요.", color = Muted)
        ids.forEachIndexed { index, id -> key(id) {
            val name = rows.first { it.text("id") == id }.text("name")
            var distance by remember { mutableFloatStateOf(0f) }
            var focused by remember { mutableStateOf(false) }
            Surface(Modifier.fillMaxWidth().semantics { contentDescription = "$name 순서 이동"; customActions = listOf(
                CustomAccessibilityAction("위로 이동") { move(id, ids.indexOf(id) - 1) },
                CustomAccessibilityAction("아래로 이동") { move(id, ids.indexOf(id) + 1) },
                CustomAccessibilityAction("맨 위로 이동") { move(id, 0) },
                CustomAccessibilityAction("맨 아래로 이동") { move(id, ids.lastIndex) }) }
                .onPreviewKeyEvent { if(it.type != KeyEventType.KeyDown) false else when(it.key) {
                    Key.DirectionUp -> move(id, ids.indexOf(id) - 1); Key.DirectionDown -> move(id, ids.indexOf(id) + 1)
                    Key.MoveHome -> move(id, 0); Key.MoveEnd -> move(id, ids.lastIndex); else -> false
                } }.onFocusChanged { focused = it.isFocused }.focusable(!action.busy).pointerInput(id, action.busy) { detectDragGesturesAfterLongPress(onDragStart = { distance = 0f }, onDragEnd = { distance = 0f }, onDragCancel = { distance = 0f }) { change, drag ->
                    change.consume(); distance += drag.y
                    if(kotlin.math.abs(distance) >= step) { move(id, ids.indexOf(id) + if(distance > 0) 1 else -1); distance = 0f }
                } }, shape = MaterialTheme.shapes.medium, border = if(focused) BorderStroke(2.dp, Brand) else null) {
                Column(Modifier.padding(12.dp)) {
                    Text("${index+1}. $name", style = MaterialTheme.typography.titleMedium)
                    Row {
                        ActionIcon("$name 맨 위로", Icons.Rounded.VerticalAlignTop, !action.busy && index > 0) { move(id,0) }
                        ActionIcon("$name 위로", Icons.Rounded.KeyboardArrowUp, !action.busy && index > 0) { move(id,index-1) }
                        ActionIcon("$name 아래로", Icons.Rounded.KeyboardArrowDown, !action.busy && index < ids.lastIndex) { move(id,index+1) }
                        ActionIcon("$name 맨 아래로", Icons.Rounded.VerticalAlignBottom, !action.busy && index < ids.lastIndex) { move(id,ids.lastIndex) }
                    }
                }
            }
        } }
        ActionFeedback(action)
        Primary("순서 저장", !action.busy) { action.run { val payload = json("ids" to ids); api.request("me/todo-categories/reorder", "PATCH", payload, key = submission.keyFor(payload)); submission.succeeded(); saved(); close() } }
    }
}
