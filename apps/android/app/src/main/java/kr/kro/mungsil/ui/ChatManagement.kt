package kr.kro.mungsil.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*

@Composable fun ChatSettingsSheet(api: Api, path: String, current: String, close: () -> Unit, saved: () -> Unit) {
    var level by rememberSaveable { mutableStateOf(current) }
    val action = rememberAction()
    NativeSheet("대화방 알림", close, !action.busy) {
        Choices("받을 알림", listOf("ALL" to "모든 메시지", "REPLIES" to "내 답장만", "NONE" to "알림 없음"), level, { level = it })
        Text(when(level) { "ALL" -> "새 메시지가 오면 방별 알림을 갱신해요."; "REPLIES" -> "내 메시지에 답장이 달릴 때만 알려드려요."; else -> "알림 없이 안 읽은 수만 표시해요." }, color = Muted)
        ActionFeedback(action)
        Primary("알림 설정 저장", !action.busy) { action.run { api.request("$path/settings", "PATCH", json("notificationLevel" to level)); saved(); close() } }
    }
}

@Composable fun ChatMembersSheet(api: Api, path: String, manage: Boolean, close: () -> Unit) {
    var revision by remember { mutableIntStateOf(0) }
    val page = rememberPaged(api, "$path/members", true, revision)
    var selected by rememberJsonState()
    NativeSheet("대화방 참여자", close) {
        page.rows.forEach { member ->
            Text("${member.child("user").text("nickname")} · @${member.child("user").text("handle")}")
            if(member.text("mutedUntil").isNotBlank()) Text("${displayTime(member.text("mutedUntil"))}까지 제한", color = Muted)
            if(manage && member.flag("canModerate")) TextButton({ selected = member }) { Text("참여자 관리") }
        }
        PageStatus(page)
    }
    selected?.let { member ->
        var hours by rememberSaveable { mutableStateOf("24") }
        var reason by rememberSaveable { mutableStateOf("") }
        val unmute = runCatching { java.time.Instant.parse(member.text("mutedUntil")).isAfter(java.time.Instant.now()) }.getOrDefault(false)
        val action = rememberAction()
        NativeSheet(if(unmute) "채팅 제한 조기 해제" else "참여자 채팅 제한", { selected = null }, !action.busy) {
            Text(member.child("user").text("nickname"))
            if(!unmute) Choices("제한 기간", listOf("24" to "24시간", "168" to "7일"), hours, { hours = it })
            Field("조치 사유", reason, { reason = it }, 300, multiline = true, hint = "참여자가 이해할 수 있게 3자 이상 적어주세요.")
            ActionFeedback(action)
            Primary(if(unmute) "채팅 제한 해제" else "제한 적용", reason.trim().length >= 3 && !action.busy) { action.run {
                val payload = json("reason" to reason.trim()).apply { if(!unmute) addProperty("durationHours", hours.toInt()) }
                api.request("$path/members/${member.child("user").text("id")}/${if(unmute) "unmute" else "mute"}", "POST", payload); selected = null; revision++
            } }
        }
    }
}

@Composable fun MessageModerationSheet(api: Api, path: String, message: JsonObject, close: () -> Unit, saved: () -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    var operation by rememberSaveable { mutableStateOf(if(message.text("hiddenAt").isNotBlank()) "RESTORE" else "HIDE") }
    val action = rememberAction()
    NativeSheet("커뮤니티 대화 관리", close, !action.busy) {
        Choices("조치", if(message.text("hiddenAt").isNotBlank()) listOf("RESTORE" to "메시지 복구") else listOf("HIDE" to "메시지 숨김", "MUTE_24" to "24시간 채팅 제한", "MUTE_168" to "7일 채팅 제한"), operation, { operation = it })
        Field("조치 사유", reason, { reason = it }, 300, multiline = true)
        ActionFeedback(action)
        Primary("관리 조치 적용", reason.trim().length >= 3 && !action.busy) { action.run {
            if(operation.startsWith("MUTE")) api.request("$path/members/${message.child("sender").text("id")}/mute", "POST", json("reason" to reason.trim(), "durationHours" to if(operation == "MUTE_24") 24 else 168))
            else api.request("$path/messages/${message.text("id")}/visibility", "PATCH", json("hidden" to (operation == "HIDE"), "reason" to reason.trim()))
            saved(); close()
        } }
    }
}

fun displayTime(value: String): String = runCatching { java.time.Instant.parse(value).atZone(java.time.ZoneId.of("Asia/Seoul")).format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 HH:mm")) }.getOrDefault("")
