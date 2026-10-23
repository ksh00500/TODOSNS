package kr.kro.mungsil.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*
import java.time.*

@Composable fun ChallengeComposer(api: Api, source: JsonObject?, close: () -> Unit, saved: () -> Unit) =
    ChallengeComposer(api, source, close, saved, ZoneId.of("Asia/Seoul"))

@Composable fun ChallengeComposer(api: Api, source: JsonObject?, close: () -> Unit, saved: () -> Unit, zone: ZoneId) {
    var title by rememberSaveable { mutableStateOf(source?.text("title").orEmpty()) }
    var description by rememberSaveable { mutableStateOf(source?.text("description").orEmpty()) }
    var start by rememberSaveable { mutableStateOf(source?.text("startsAt")?.let { localDate(it, zone).toString() } ?: LocalDate.now(zone).toString()) }
    var end by rememberSaveable { mutableStateOf(source?.text("endsAt")?.let { localDate(it, zone).toString() } ?: LocalDate.now(zone).plusDays(20).toString()) }
    var mode by rememberSaveable { mutableStateOf(source?.text("verificationMode") ?: "CHECK") }
    var criteria by rememberSaveable { mutableStateOf(source?.strings("verificationCriteria")?.takeIf { it.isNotEmpty() } ?: listOf("사진만 보고 오늘 실천을 완료했다고 판단할 수 있나요?", "사진이 챌린지 주제와 맞나요?", "재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?")) }
    var threshold by rememberSaveable { mutableStateOf(source?.text("completionThreshold") ?: "80") }
    var titles by rememberSaveable { mutableStateOf(listOf("firstPlaceTitle", "secondPlaceTitle", "thirdPlaceTitle").map { source?.text(it).orEmpty() }) }
    val action = rememberAction()
    var error by remember { mutableStateOf<String?>(null) }
    val payload = json("title" to title.trim(), "description" to description.trim(), "verificationMode" to mode, "completionThreshold" to threshold.toInt(), "firstPlaceTitle" to titles[0].ifBlank { null }, "secondPlaceTitle" to titles[1].ifBlank { null }, "thirdPlaceTitle" to titles[2].ifBlank { null }).apply {
        // Editing text must preserve the original instant, including its time of day.
        // The server rejects start-time changes after the first check-in.
        if(source == null || start != localDate(source.text("startsAt"), zone).toString()) addProperty("startsAt", dueInstant(start, "00:00", zone))
        if(source == null || end != localDate(source.text("endsAt"), zone).toString()) addProperty("endsAt", LocalDate.parse(end).atTime(23,59,59).atZone(zone).toInstant().toString())
        if(source == null) addProperty("kind", "COMMUNITY")
        if(mode == "PEER_PHOTO") add("verificationCriteria", com.google.gson.Gson().toJsonTree(criteria.map { it.trim() }))
    }
    val initialPayload = rememberSaveable(source?.text("id")) { payload.toString() }
    val submission = rememberDraftSubmission(source?.text("id"), "challenge")
    NativeSheet(if(source == null) "커뮤니티 챌린지 만들기" else "챌린지 편집", close, !action.busy, dirty = payload.toString() != initialPayload) {
        if(source == null) Text("500 포인트 · 개설 즉시 차감되며 취소해도 반환되지 않아요.")
        Field("챌린지 이름", title, { title = it }, 120, enabled = !action.busy)
        Field("함께할 약속", description, { description = it }, 1000, multiline = true, hint = "실천 방법을 10자 이상으로 적어주세요.", enabled = !action.busy)
        DateControl(start, { start = it; if(end < it) end = it }, "시작일", enabled = !action.busy)
        DateControl(end, { end = it }, "종료일", enabled = !action.busy)
        Choices("인증 방식", listOf("CHECK" to "간편 체크", "PEER_PHOTO" to "참여자 사진 인증"), mode, !action.busy, { mode = it })
        Text(if(mode == "CHECK") "누르면 바로 인증돼요. 사진은 기록용으로 선택할 수 있어요." else "참여자들이 익명으로 기준을 확인해요. 최소 참여자 8명부터 시작해요.", color = Muted)
        if(mode == "PEER_PHOTO") {
            criteria.forEachIndexed { index, value ->
                Field("기준 ${index + 1}", value, { next -> criteria = criteria.mapIndexed { i, old -> if(i == index) next else old } }, 120, hint = "5~120자", enabled = !action.busy)
                if(criteria.size > 1) TextButton({ criteria = criteria.filterIndexed { i, _ -> i != index } }, enabled = !action.busy) { Text("기준 ${index + 1} 삭제") }
            }
            if(criteria.size < 5) TextButton({ criteria = criteria + "" }, enabled = !action.busy) { Text("확인 기준 추가") }
        }
        Choices("완주 기준", listOf(60,70,80,90,100).map { it.toString() to "$it%" }, threshold, !action.busy, { threshold = it })
        titles.forEachIndexed { index, value -> Field("${index + 1}위 칭호", value, { next -> titles = titles.mapIndexed { i, old -> if(i == index) next else old } }, 120, enabled = !action.busy) }
        ErrorNotice(error); ActionFeedback(action)
        Primary(if(action.busy) "저장하는 중…" else if(source == null) "500 포인트로 만들기" else "변경 내용 저장", !action.busy) {
            error = when {
                title.trim().length < 2 -> "챌린지 이름을 2자 이상 입력해주세요."
                description.trim().length < 10 -> "함께할 약속을 10자 이상 입력해주세요."
                end < start -> "종료일은 시작일 이후로 선택해주세요."
                mode == "PEER_PHOTO" && criteria.any { it.trim().length < 5 } -> "사진 확인 기준을 각각 5자 이상 입력해주세요."
                else -> null
            }
            if(error == null) action.run { api.request(if(source == null) "challenges" else "challenges/${source.text("id")}", if(source == null) "POST" else "PATCH", payload, key = submission.keyFor(payload)); submission.succeeded(); saved(); close() }
        }
    }
}
