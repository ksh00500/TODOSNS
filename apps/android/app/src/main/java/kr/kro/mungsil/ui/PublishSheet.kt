@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

@Composable fun PublishSheet(api: Api, todo: JsonObject, close: () -> Unit, saved: () -> Unit, group: Boolean = false,
    photoPicker: @Composable (Api, String?, (String?) -> Unit, Boolean, (Boolean) -> Unit, PhotoDraft) -> Unit = { source, media, update, enabled, pending, draft ->
        PhotoPicker(source, media, update, enabled, pending, draft = draft)
    }) {
    val owner = LocalTodoDraftOwner.current
    key(owner, todo.text("id"), group) { PublishSheetContent(api, todo, owner, close, saved, group, photoPicker) }
}

@Composable private fun PublishSheetContent(api: Api, todo: JsonObject, owner: String, close: () -> Unit, saved: () -> Unit, group: Boolean,
    photoPicker: @Composable (Api, String?, (String?) -> Unit, Boolean, (Boolean) -> Unit, PhotoDraft) -> Unit) {
    val form = rememberPublishFormState(owner, todo.text("id"), group)
    val draft = form.draft
    val scope = rememberCoroutineScope()
    val sessionVersion = remember(api, owner) { api.sessionVersion }
    NativeSheet("실천 게시하기", close, !form.busy, dirty = form.dirty,
        discardDetail = if(form.uncertain) "게시 요청이 이미 반영됐을 수 있어요. 닫아도 게시는 취소되지 않아요. 마이의 게시 기록을 확인해주세요." else "작성한 게시 내용이 사라져요. 원래 실천은 그대로 유지돼요.") {
        CloudCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.CloudUpload, null, tint = Brand)
                Column { Text("이 실천을 게시할까요?", style = MaterialTheme.typography.titleMedium); Text(todo.text("title"), color = Muted) }
            }
        }
        Text(if(group) "그룹의 현재 내용을 루틴으로 게시해요. 원본 그룹의 공개 범위는 바뀌지 않아요."
            else "게시는 선택이에요. 닫아도 완료는 유지되며 원래 TODO의 공개 범위는 바뀌지 않아요.", color = Muted)
        if(!group) Text("게시한 TODO는 게시 기록이 연결된 동안 완료 취소가 제한돼요.", color = Muted)
        Text("인증 사진 추가", style = MaterialTheme.typography.titleMedium)
        Text("선택 사항 · 최대 10MB", color = Muted)
        photoPicker(api, draft.mediaId, { value -> form.update { it.copy(mediaId = value) } }, form.editable, form::photoPending, form.photo)
        Field("오늘의 한마디", draft.caption, { value ->
            if(value.codePointCount(0, value.length) <= 180) form.update { it.copy(caption = value) }
        }, 360, multiline = true, hint = "실천하면서 어떤 기분이었나요? · 최대 180자", enabled = form.editable)
        Text("해시태그 ${draft.tags.size}/5 · 선택 사항", style = MaterialTheme.typography.titleMedium)
        Field("해시태그 입력", draft.tagInput, { value ->
            if(value.endsWith(',')) form.addTag(value.dropLast(1)) else form.update { it.copy(tagInput = value.take(30)) }
        }, 31, enabled = form.editable, hint = "예: 아침루틴 · 최대 30자", imeAction = ImeAction.Done, onSubmit = { form.addTag() })
        OutlinedButton({ form.addTag() }, enabled = form.editable && draft.tagInput.isNotBlank()) { Text("추가") }
        ErrorNotice(form.tagError)
        if(draft.tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { draft.tags.forEach { tag ->
            TextButton({ form.update { it.copy(tags = it.tags.filter { value -> value != tag }) } }, enabled = form.editable,
                modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = "$tag 해시태그 삭제" }) { Text("#$tag ×") }
        } }
        Text("Enter 또는 쉼표로 추가할 수 있어요.", color = Muted)
        PublishVisibility(draft.visibility, form.editable) { value -> form.update { it.copy(visibility = value) } }
        ErrorNotice(form.error)
        if(owner.isBlank()) ErrorNotice("로그인 상태를 확인한 뒤 다시 열어주세요.")
        if(form.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Primary(if(form.busy) "게시 중…" else if(form.uncertain) "게시 결과 확인" else "피드에 게시하기",
            !form.busy && !form.denied && owner.isNotBlank() && (form.uncertain || !form.incompletePhoto)) {
            form.begin()?.let { request -> scope.launch {
                val completed = try { sendPublication(api, request, sessionVersion); form.succeeded(request) }
                    catch(e: CancellationException) { form.cancelled(request); throw e }
                    catch(e: Exception) { form.failed(request, e); false }
                if(completed) { saved(); close() }
            } }
        }
        if(form.incompletePhoto) Text("사진 첨부를 완료하거나 사진을 제외하면 게시할 수 있어요.", color = Muted)

    }
}

@Composable private fun PublishVisibility(value: String, enabled: Boolean, change: (String) -> Unit) {
    Text("공개 범위", style = MaterialTheme.typography.titleMedium)
    Column(Modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(Triple("PUBLIC", "전체 공개", "탐색에서 누구나 볼 수 있어요"), Triple("FOLLOWERS", "팔로워", "나를 팔로우한 사람만 봐요"), Triple("PRIVATE", "나만 보기", "내 기록으로만 남겨요")).forEach { (id, title, body) ->
            val selected = value == id
            Surface(Modifier.fillMaxWidth().heightIn(min = 60.dp).selectable(selected, enabled, Role.RadioButton) { change(id) },
                color = if(selected) Lavender else MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.small,
                border = BorderStroke(1.dp, if(selected) Brand else MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(when(id) { "PUBLIC" -> Icons.Rounded.Public; "FOLLOWERS" -> Icons.Rounded.People; else -> Icons.Rounded.Lock }, null, tint = Brand)
                    Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.titleMedium); Text(body, color = Muted) }
                    if(selected) Icon(Icons.Rounded.Check, "선택됨", tint = Brand)
                }
            }
        }
    }
}
