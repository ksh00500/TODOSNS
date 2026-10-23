package kr.kro.mungsil.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import kr.kro.mungsil.data.*

@Composable fun ChallengeCheckInSheet(api: Api, challengeId: String, photoRequired: Boolean, retryId: String?, close: () -> Unit, saved: () -> Unit,
    photoPicker: @Composable (Api, String?, (String?) -> Unit, Boolean, (Boolean) -> Unit, PhotoDraft) -> Unit = { source, media, update, enabled, pending, draft ->
        PhotoPicker(source, media, update, enabled, pending, draft = draft)
    }) {
    var note by rememberSaveable(challengeId, retryId) { mutableStateOf("") }
    var media by rememberSaveable(challengeId, retryId) { mutableStateOf<String?>(null) }
    var photoPending by rememberSaveable(challengeId, retryId) { mutableStateOf(false) }
    val photo = rememberPhotoDraft(challengeId, retryId)
    val incompletePhoto = photoPending || (photo.selectedUri != null && media == null)
    val requiresPhoto = photoRequired || retryId != null
    val submission = rememberDraftSubmission(challengeId, retryId)
    val action = rememberAction()
    val payload = json().apply {
        note.trim().takeIf(String::isNotBlank)?.let { addProperty("note", it) }
        media?.let { addProperty("mediaId", it) }
    }
    NativeSheet(if(retryId == null) "오늘의 챌린지 인증" else "새 사진으로 다시 인증", close, !action.busy,
        dirty = note.isNotEmpty() || media != null || incompletePhoto) {
        Text(if(requiresPhoto) "인증 사진을 선택해주세요" else "사진 추가 (선택)")
        Text("10MB 이하 · 업로드 후 안전하게 확인해요", color = Muted)
        photoPicker(api, media, { media = it }, !action.busy, { photoPending = it }, photo)
        Field("오늘의 한마디 (선택)", note, { note = it }, 180, multiline = true, hint = "오늘 실천은 어땠나요?", enabled = !action.busy)
        if(photoRequired) Text("사진은 작성자 정보 없이 같은 챌린지 참여자에게 표시되고, 기준별 투표로 자동 판정돼요.", color = Muted)
        ActionFeedback(action)
        if(incompletePhoto) Text("사진 첨부를 완료하거나 사진을 제외해주세요.", color = Muted)
        Primary(if(action.busy) "인증하는 중…" else if(retryId == null) "오늘 인증 남기기" else "새 사진으로 다시 요청",
            !action.busy && !incompletePhoto && (!requiresPhoto || media != null)) {
            action.run {
                api.request(retryId?.let { "challenge-verifications/check-ins/$it/resubmit" } ?: "challenges/$challengeId/check-in", "POST", payload, key = submission.keyFor(payload))
                submission.succeeded(); saved(); close()
            }
        }
    }
}
