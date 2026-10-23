package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Help
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import kr.kro.mungsil.data.*

@Composable fun VerificationSheet(api: Api, id: String, close: () -> Unit) {
    val model: VerificationModel = viewModel(key = "verification-$id-${System.identityHashCode(api)}", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = VerificationModel(VerificationRepository(api)) as T
    })
    LaunchedEffect(model) { model.load(id) }
    val remote = model.state.collectAsStateWithLifecycle().value
    val item = remote.data?.items?.firstOrNull()
    val action = rememberAction()
    // Loading has no item identity. Do not reset a restored draft on that interim state.
    var reviewIdentity by rememberSaveable(id) { mutableStateOf("") }
    var step by rememberSaveable(id) { mutableIntStateOf(0) }
    var answers by rememberSaveable(id) { mutableStateOf(arrayListOf<String>()) }
    val submission = rememberDraftSubmission(id, "verification")
    var expanded by remember { mutableStateOf(false) }
    var reporting by remember { mutableStateOf(false) }
    val sameItem = item != null && reviewIdentity == item.identity
    val currentAnswers = if(sameItem) answers.toList() else emptyList()
    val currentStep = if(sameItem) step.coerceIn(0, item!!.criteria.lastIndex) else 0
    fun select(value: String) {
        val current = item ?: return
        reviewIdentity = current.identity; step = currentStep
        answers = ArrayList(current.criteria.indices.map { if(it == currentStep) value else currentAnswers.getOrNull(it).orEmpty() })
    }
    NativeSheet("사진 인증 함께 확인하기", close, !action.busy, dirty = currentAnswers.any(String::isNotBlank)) {
        CloudCard {
            Text("사진만 보고 익명으로 확인해요", style = MaterialTheme.typography.titleMedium)
            Text("작성자와 현재 투표 수는 보이지 않아요. 확실하지 않다면 판단하기 어려워요를 선택해도 괜찮아요.", color = Muted)
        }
        if(remote.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        ErrorNotice(remote.error) { model.load(id) }
        if(item != null) {
            val photoReady = VerificationPhoto(item, { model.load(id) }, { expanded = true })
            TextButton({ reporting = true }, enabled = !action.busy) { Icon(Icons.Rounded.Flag, null); Text("이 사진 신고") }
            Text("${currentStep+1}/${item.criteria.size} · ${item.criteria[currentStep]}", Modifier.semantics { contentDescription = "확인 기준 ${currentStep+1}/${item.criteria.size}" }, style = MaterialTheme.typography.titleMedium)
            LinearProgressIndicator(progress = { (currentStep+1).toFloat() / item.criteria.size }, modifier = Modifier.fillMaxWidth())
            listOf(Triple("MET", "확인돼요", "기준에 맞는 내용이 보여요"), Triple("NOT_MET", "확인되지 않아요", "기준과 다른 내용이 보여요"), Triple("UNSURE", "판단하기 어려워요", "사진만으로는 확신하기 어려워요")).forEach { (value, label, body) ->
                val chosen = currentAnswers.getOrNull(currentStep) == value
                OutlinedButton({ select(value) }, Modifier.fillMaxWidth().heightIn(min = 60.dp).semantics { selected = chosen }, enabled = !action.busy && photoReady,
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = if(chosen) Lavender else MaterialTheme.colorScheme.surface)) {
                    Icon(when(value) { "MET" -> Icons.Rounded.CheckCircle; "NOT_MET" -> Icons.Rounded.Cancel; else -> Icons.AutoMirrored.Rounded.Help }, null)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text(if(chosen) "선택 · $label" else label, style = MaterialTheme.typography.titleMedium); Text(body, style = MaterialTheme.typography.bodyMedium) }
                }
            }
            ActionFeedback(action)
            if(currentStep > 0) TextButton({ step = currentStep - 1 }, enabled = !action.busy) { Text("이전 기준") }
            val last = currentStep == item.criteria.lastIndex
            val allAnswered = item.criteria.indices.all { currentAnswers.getOrNull(it) in listOf("MET", "NOT_MET", "UNSURE") }
            Primary(if(action.busy) "의견을 보내는 중…" else if(last) "익명으로 의견 보내기" else "다음 기준",
                !action.busy && photoReady && !currentAnswers.getOrNull(currentStep).isNullOrBlank() && (!last || allAnswered)) {
                if(!last) step = currentStep+1 else action.run {
                    val payload = json("answers" to item.criteria.indices.map { mapOf("criterionIndex" to it, "result" to currentAnswers[it]) })
                    val identityPayload = json("identity" to item.identity, "vote" to payload)
                    api.request("challenge-verifications/${item.id}/vote", "POST", payload, key = submission.keyFor(identityPayload))
                    submission.succeeded(); reviewIdentity = ""; answers = arrayListOf(); step = 0; model.load(id)
                }
            }
        } else if(!remote.loading && remote.error == null) EmptyState("지금 확인할 사진이 없어요", "참여 가능한 새 인증이 생기면 다시 보여드릴게요. 지금까지 ${remote.data?.contributions ?: 0}회 도왔어요.")
    }
    if(expanded && item != null) NativeSheet("인증 사진 크게 보기", { expanded = false }) {
        VerificationPhoto(item, { model.load(id) }, {}, original = true)
    }
    if(reporting && item != null) ReportSheet(api, "CHALLENGE_CHECK_IN", item.id, { reporting = false }, reported = { reporting = false; close() })
}

@Composable private fun VerificationPhoto(item: VerificationItem, reload: () -> Unit, expand: () -> Unit, original: Boolean = false): Boolean {
    var ready by remember(item.identity, item.mediaUrl) { mutableStateOf(false) }
    var failed by remember(item.identity, item.mediaUrl) { mutableStateOf(false) }
    var attempt by remember(item.identity, item.mediaUrl) { mutableIntStateOf(0) }
    var ratio by remember(item.identity, item.mediaUrl) { mutableFloatStateOf(4f/3f) }
    val context = LocalContext.current
    if(item.mediaUrl == null) ErrorNotice("인증 사진을 확인할 수 없어요. 사진이 있는 인증을 다시 불러와주세요.", reload)
    else if(failed) ErrorNotice("인증 사진을 불러오지 못했어요. 사진을 확인한 뒤 판정해주세요.") { failed = false; attempt++ }
    else key(item.identity, item.mediaUrl, attempt) {
        val request = remember(item.mediaUrl, attempt) { ImageRequest.Builder(context).data(item.mediaUrl).diskCachePolicy(CachePolicy.DISABLED).build() }
        AsyncImage(request, if(original) "참여자 인증 사진 원본" else "${item.title} 참여자 인증 사진",
            Modifier.fillMaxWidth().then(if(original) Modifier.aspectRatio(ratio) else Modifier), contentScale = if(original) androidx.compose.ui.layout.ContentScale.Fit else androidx.compose.ui.layout.ContentScale.FillWidth,
            onSuccess = { result ->
                val drawable = result.result.drawable
                if(drawable.intrinsicWidth > 0 && drawable.intrinsicHeight > 0) ratio = drawable.intrinsicWidth.toFloat() / drawable.intrinsicHeight
                ready = true
            }, onError = { ready = false; failed = true })
        if(!ready) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
    if(!original) OutlinedButton(expand, Modifier.fillMaxWidth().heightIn(min = 44.dp), enabled = ready) { Icon(Icons.Rounded.OpenInFull, null); Text("인증 사진 크게 보기") }
    return ready
}
