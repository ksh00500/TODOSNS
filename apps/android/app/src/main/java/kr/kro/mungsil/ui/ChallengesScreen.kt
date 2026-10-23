package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kr.kro.mungsil.data.*
import java.time.Instant

private fun challengeDate(value: String, zone: java.time.ZoneId): String =
    runCatching { Instant.parse(value).atZone(zone).toLocalDate().toString() }.getOrDefault("일정 확인 필요")

@Composable fun ChallengesScreen(api: Api, auth: Boolean, revision: Int, navigate: (String) -> Unit, zone: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var group by rememberSaveable { mutableStateOf(if(auth) "JOINED" else "OFFICIAL") }
    var localRevision by remember { mutableIntStateOf(0) }
    val remote = rememberRemote(auth, revision, localRevision) { api.request(if(auth) "challenges" else "public/challenges", authenticated = auth) }
    PageList {
        item { Heading("함께 이어가는 실천", "서로의 꾸준함에 기대어 한 걸음 더.") }
        item { Choices("챌린지", listOf("JOINED" to "참여 중", "OFFICIAL" to "공식", "COMMUNITY" to "커뮤니티"), group, { group = it }); if(auth) TextButton({ creating = true }) { Text("챌린지 만들기") } }
        remoteStatus(remote)
        if(!remote.loading && remote.error == null && remote.data?.rows()?.none { if(group == "JOINED") it.flag("joined") else it.text("kind") == group } == true) item { EmptyState("새로운 챌린지를 준비하고 있어요", "나의 TODO를 실천하며 다음 시작을 기다려주세요.") }
        items(remote.data?.rows().orEmpty().filter { if(group == "JOINED") it.flag("joined") else it.text("kind") == group }, key = { it.text("id") }) { challenge -> CloudCard {
            Text(if(challenge.text("kind") == "OFFICIAL") "공식 챌린지" else "커뮤니티 챌린지", color = Brand)
            Text(challenge.text("title"), style = MaterialTheme.typography.titleLarge)
            Text(challenge.text("description"))
            Text("${challengeDate(challenge.text("startsAt"), zone)} ~ ${challengeDate(challenge.text("endsAt"), zone)} · ${challenge.child("_count").number("participants")}명", color = Muted)
            OutlinedButton({ navigate("challenge/${challenge.text("id")}") }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if(challenge.flag("joined")) "참여 중 · 자세히 보기" else "자세히 보기") }
        } }
        item { TextButton({ remote.reload() }) { Text("새로고침") } }
    }
    if(creating) ChallengeComposer(api, null, { creating = false }, { localRevision++ }, zone)
}

@Composable fun ChallengeDetailScreen(api: Api, id: String, auth: Boolean, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, login: () -> Unit, zone: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")) {
    val remote = rememberRemote(id, auth, revision) { api.request(if(auth) "challenges/$id" else "public/challenges/$id", authenticated = auth) }
    val ranking = rememberRemote(id, auth, revision) { api.request(if(auth) "challenges/$id/leaderboard" else "public/challenges/$id/leaderboard", authenticated = auth) }
    val challenge = remote.data?.takeIf { !remote.loading && remote.error == null }?.obj()
    val action = rememberAction()
    val me = if(auth) rememberRemote(api) { api.request("auth/me") } else null
    var editing by rememberSaveable { mutableStateOf(false) }
    var ending by remember { mutableStateOf(false) }
    var retryId by rememberSaveable { mutableStateOf<String?>(null) }
    var checking by rememberSaveable { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf(false) }
    var reviewing by rememberSaveable { mutableStateOf(false) }
    val joinSubmission = rememberDraftSubmission(id, "join")
    val reverifySubmission = rememberDraftSubmission(id, "reverify")
    PageList {
        remoteStatus(remote)
        if(challenge != null) {
            val window = challengeWindow(challenge)
            val ended = window == ChallengeWindow.ENDED
            val started = window == ChallengeWindow.ACTIVE
            item { Heading(challenge.text("title"), "${challengeDate(challenge.text("startsAt"), zone)} ~ ${challengeDate(challenge.text("endsAt"), zone)}") }
            item { Text(challenge.text("description")) }
            if(window != ChallengeWindow.UNKNOWN && !ended && me?.error == null && me?.data?.obj()?.text("id") == challenge.child("creator").text("id") && challenge.child("creator").text("id").isNotBlank()) item {
                Row { TextButton({ editing = true }, enabled = !action.busy) { Text("챌린지 편집") }; TextButton({ ending = true }, enabled = !action.busy) { Text("챌린지 종료") } }
            }
            item { CloudCard {
                Text("참여 ${challenge.child("_count").number("participants")}명 · ${if(challenge.text("verificationMode") == "PEER_PHOTO") "사진 인증" else "완료 체크"}")
                Text("완주 기준 ${challenge.number("completionThreshold")}%", color = Brand)
                if(challenge.text("verificationMode") == "PEER_PHOTO") Text("사진 인증은 ${challenge.number("minimumParticipants")}명부터 시작하며 참여자 검수를 거쳐 승인돼요.")
                challenge.strings("verificationCriteria").forEachIndexed { index, text -> Text("${index+1}. $text") }
                if(challenge.text("rewardLabel").isNotBlank()) { Text("보상 · ${challenge.text("rewardLabel")}"); Text(challenge.text("rewardTerms")) }
                if(challenge.text("titleAwarded").isNotBlank()) Text("받은 칭호 · ${challenge.text("titleAwarded")}")
                else listOf("firstPlaceTitle", "secondPlaceTitle", "thirdPlaceTitle").forEachIndexed { index, key -> if(challenge.text(key).isNotBlank()) Text("${index+1}위 · ${challenge.text(key)}") }
                if(challenge.text("myRewardStatus").isNotBlank()) Text("내 보상 상태 · ${challengeRewardLabel(challenge.text("myRewardStatus"), challenge.text("kind"))}", color = Muted)
            } }
            if(challenge.flag("joined")) item { CloudCard {
                Text("나의 성공률", style = MaterialTheme.typography.titleMedium)
                Text("${challenge.number("successRate")}% · ${challenge.number("myCheckInCount")}일 인증했어요", color = Brand)
                LinearProgressIndicator(progress = { (challenge.number("successRate") / 100f).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            } }
            item {
                ActionFeedback(action)
                when {
                    window == ChallengeWindow.UNKNOWN -> ErrorNotice("챌린지 일정을 확인하지 못했어요. 다시 불러와주세요.") { remote.reload() }
                    ended -> Text("종료된 챌린지예요.", color = Muted)
                    !auth -> Primary("로그인하고 참여", onClick = login)
                    !challenge.flag("joined") && !started -> Text("참여 접수 전이에요. 시작일에 참여할 수 있어요.", color = Muted)
                    !challenge.flag("joined") -> Primary("챌린지 시작하기", !action.busy) { action.run { api.request("challenges/$id/join", "POST", key = joinSubmission.keyFor(json("challengeId" to id))); joinSubmission.succeeded(); changed() } }
                    !started -> Text("시작일을 기다리고 있어요.", color = Muted)
                    challenge.flag("chatReadOnly") -> Text("현재 인증을 제출할 수 없어요. 참여 상태를 다시 확인해주세요.", color = Muted)
                    challenge.flag("todayCheckedIn") -> Text("오늘 인증을 제출했어요. 아래 기록에서 상태를 확인해주세요.", color = Brand)
                    challenge.text("verificationMode") == "PEER_PHOTO" && challenge.child("_count").number("participants") < challenge.number("minimumParticipants").coerceAtLeast(8) -> Text("사진 인증을 시작할 참여자를 기다리고 있어요.", color = Muted)
                    else -> Primary("오늘 인증하기", !action.busy) { retryId = null; checking = true }
                }
                if(auth && challenge.flag("joined")) Row {
                    TextButton({ navigate("chat/challenge/$id") }) { Text("대화방") }
                    if(!ended) TextButton({ leaving = true }, enabled = !action.busy) { Text("참여 취소") }
                }
                if(auth) TextButton({ report = true }) { Text("신고") }
                if(auth && challenge.flag("joined") && !ended && challenge.text("verificationMode") == "PEER_PHOTO" && challenge.child("_count").number("participants") >= challenge.number("minimumParticipants").coerceAtLeast(8)) TextButton({ reviewing = true }) { Text("다른 참여자의 사진 인증 도와주기") }
            }
            if(auth && challenge.flag("joined")) {
                item { Text("내 인증 기록 · 승인 ${challenge.number("myCheckInCount")}회", style = MaterialTheme.typography.titleLarge) }
                if(challenge.list("checkIns").isEmpty()) item { EmptyState("아직 인증 기록이 없어요", "오늘 첫 인증을 남겨보세요.") }
                items(challenge.list("checkIns"), key = { it.text("id") }) { check -> CloudCard {
                    Text("${check.text("checkInDate").take(10)} · ${when(check.text("status", "APPROVED")) { "APPROVED" -> "인증 통과"; "REJECTED" -> "다시 올려주세요"; else -> "참여자 확인 중 · ${check.number("validVotes")}/${check.number("reviewSize")}명" }}", fontWeight = FontWeight.Bold)
                    if(check.text("mediaUrl").isNotBlank()) Photo(check.text("mediaUrl"), "내 인증 사진")
                    Text(check.text("note").ifBlank { "오늘의 약속을 지켰어요." }); if(check.text("status") == "REJECTED") Text(check.text("reviewNote").ifBlank { "사진 인증 기준을 확인해주세요." })
                    if(challenge.text("verificationMode") == "PEER_PHOTO" && canRetryChallengeCheckIn(check, window, challenge.flag("joined"))) {
                        val deadline = Instant.parse(check.text("retryUntil")).atZone(zone).format(java.time.format.DateTimeFormatter.ofPattern("M월 d일 HH:mm"))
                        Text("${deadline}까지 · 오늘 최대 3회", color = Muted)
                        TextButton({ retryId = check.text("id"); checking = true }) { Text("새 사진 올리기") }
                        if(!check.flag("reverifyUsed")) TextButton({ action.run { api.request("challenge-verifications/check-ins/${check.text("id")}/reverify", "POST", key = reverifySubmission.keyFor(json("checkInId" to check.text("id"), "attempt" to check.number("attempt")))); reverifySubmission.succeeded(); changed() } }, enabled = !action.busy) { Text("같은 사진 재검증") }
                    }
                } }
            }
            item { Text("함께 쌓은 기록", style = MaterialTheme.typography.titleLarge); ranking.data?.obj()?.number("myRank")?.takeIf { it > 0 }?.let { Text("현재 내 순위 ${it}위", color = Brand) } }
            remoteStatus(ranking)
            if(!ranking.loading && ranking.error == null && ranking.data?.obj()?.list("items")?.isEmpty() == true) item { EmptyState("아직 순위가 없어요", "첫 인증이 승인되면 기록이 시작돼요.") }
            items(ranking.data?.obj()?.list("items").orEmpty(), key = { it.text("userId") }) { rank -> CloudCard {
                Text("${rank.number("rank")}위 · ${rank.child("user").text("nickname")}", style = MaterialTheme.typography.titleMedium)
                Text("${rank.number("approvedCheckIns")}회 인증 · 성공률 ${rank.number("successRate")}%", color = Muted)
                if(rank.text("titleAwarded").isNotBlank()) Text(rank.text("titleAwarded"), color = Brand)
            } }
        }
    }
    if(checking && challenge != null) {
        ChallengeCheckInSheet(api, id, challenge.text("verificationMode") != "CHECK", retryId, { checking = false }, changed)
    }
    if(editing && challenge != null) ChallengeComposer(api, challenge, { editing = false }, changed, zone)
    if(ending) ConfirmSheet("챌린지를 종료할까요?", "종료 후 인증과 대화 변경이 제한돼요. 개설 포인트는 반환되지 않아요.", "챌린지 종료", { ending = false }) { api.request("challenges/$id", "DELETE"); changed() }
    if(leaving) ConfirmSheet("챌린지 참여를 취소할까요?", "참여를 취소하면 이 챌린지의 인증 기록도 함께 삭제되고 되돌릴 수 없어요.", "참여와 인증 기록 삭제", { leaving = false }) { api.request("challenges/$id/join", "DELETE"); changed() }
    if(report) ReportSheet(api, "CHALLENGE", id, { report = false })
    if(reviewing) VerificationSheet(api, id, { reviewing = false })
}

private fun challengeRewardLabel(status: String, kind: String): String = when(status) {
    "APPROVED" -> if(kind == "COMMUNITY") "완주 확정" else "지급 승인"
    "PAID" -> "지급 완료"
    "REJECTED" -> "지급 제외"
    "REVIEWING" -> "검수 중"
    "ELIGIBLE" -> "보상 대상"
    "NOT_ELIGIBLE" -> "완주 조건 확인 중"
    else -> status
}
