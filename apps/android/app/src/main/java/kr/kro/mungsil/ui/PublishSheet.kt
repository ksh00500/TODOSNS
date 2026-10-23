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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*

@Composable fun PublishSheet(api: Api, todo: JsonObject, close: () -> Unit, saved: () -> Unit, group: Boolean = false,
    photoPicker: @Composable (Api, String?, (String?) -> Unit, Boolean, (Boolean) -> Unit, PhotoDraft) -> Unit = { source, media, update, enabled, pending, draft ->
        PhotoPicker(source, media, update, enabled, pending, draft = draft)
    }) {
    val id = todo.text("id")
    var caption by rememberSaveable(id, group) { mutableStateOf("") }
    var tagDraft by rememberSaveable(id, group) { mutableStateOf("") }
    var tags by rememberSaveable(id, group) { mutableStateOf(arrayListOf<String>()) }
    var visibility by rememberSaveable(id, group) { mutableStateOf("PUBLIC") }
    var media by rememberSaveable(id, group) { mutableStateOf<String?>(null) }
    var photoPending by rememberSaveable(id, group) { mutableStateOf(false) }
    val photoDraft = rememberPhotoDraft(id, group)
    val incompletePhoto = photoPending || (photoDraft.selectedUri != null && media == null)
    var tagError by rememberSaveable(id, group) { mutableStateOf<String?>(null) }
    val submission = rememberDraftSubmission(id, group)
    val action = rememberAction()
    fun addTag(value: String = tagDraft) {
        if(action.busy) return
        val result = addPublishTag(tags, value)
        tags = ArrayList(result.tags); tagDraft = result.draft; tagError = result.error
    }
    val payload = publishPayload(id, group, caption, tags, visibility, media)
    NativeSheet("실천 게시하기", close, !action.busy,
        dirty = caption.isNotBlank() || tags.isNotEmpty() || tagDraft.isNotBlank() || media != null || incompletePhoto || visibility != "PUBLIC") {
        CloudCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.CloudUpload, null, tint = Brand)
                Column { Text("이 실천을 게시할까요?", style = MaterialTheme.typography.titleMedium); Text(todo.text("title"), color = Muted) }
            }
        }
        Text("인증 사진 추가", style = MaterialTheme.typography.titleMedium)
        Text("선택 사항 · 최대 10MB", color = Muted)
        key(id, group) { photoPicker(api, media, { media = it }, !action.busy, { photoPending = it }, photoDraft) }
        Field("오늘의 한마디", caption, { caption = it }, 180, multiline = true, hint = "실천하면서 어떤 기분이었나요?", enabled = !action.busy)
        Text("해시태그 ${tags.size}/5 · 선택 사항", style = MaterialTheme.typography.titleMedium)
        Field("해시태그 입력", tagDraft, { if(it.endsWith(',')) addTag(it.dropLast(1)) else tagDraft = it.take(30) }, 31,
            enabled = !action.busy, hint = "예: 아침루틴 · 최대 30자", imeAction = ImeAction.Done, onSubmit = { addTag() })
        OutlinedButton({ addTag() }, enabled = !action.busy && tagDraft.isNotBlank()) { Text("추가") }
        ErrorNotice(tagError)
        if(tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { tags.forEach { tag ->
            TextButton({ tags = ArrayList(tags.filter { it != tag }); tagError = null }, enabled = !action.busy,
                modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = "$tag 해시태그 삭제" }) { Text("#$tag ×") }
        } }
        Text("Enter 또는 쉼표로 추가할 수 있어요.", color = Muted)
        PublishVisibility(visibility, !action.busy) { visibility = it }
        ActionFeedback(action)
        Primary(if(action.busy) "게시 중…" else "피드에 게시하기", !action.busy && !incompletePhoto) {
            action.run { api.request("feed/posts", "POST", payload, key = submission.keyFor(payload)); submission.succeeded(); saved(); close() }
        }
        if(incompletePhoto) Text("사진 첨부를 완료하거나 사진을 제외하면 게시할 수 있어요.", color = Muted)
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
