package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*
import java.time.LocalDate

@Composable fun GoogleLogin(api: Api, config: JsonObject, signedIn: (JsonObject) -> Unit, action: ActionState, busyChanged: (Boolean) -> Unit = {}, requestToken: suspend (android.content.Context, String) -> String? = ::googleIdToken) {
    val context = LocalContext.current
    val model: GoogleLoginModel = viewModel(key = "google-login")
    val state by model.state.collectAsStateWithLifecycle()
    val profile = state.profileRequired
    val busy = action.busy || state.busy
    val onSignedIn by rememberUpdatedState(signedIn)
    LaunchedEffect(state.account) { state.account?.let { model.consumeAccount(); onSignedIn(it) } }
    LaunchedEffect(state.busy) { busyChanged(state.busy) }
    var handle by rememberSaveable { mutableStateOf("") }
    var birth by rememberSaveable { mutableStateOf("") }
    var invite by rememberSaveable { mutableStateOf("") }
    var consent by rememberSaveable { mutableStateOf(false) }
    var validation by remember { mutableStateOf<String?>(null) }
    var showDiagnostics by rememberSaveable { mutableStateOf(false) }
    if (!config.flag("googleAuthEnabled")) return
    fun start(useAlternative: Boolean) { model.start(api) {
        if(useAlternative) googleAccountPicker(context, config.text("googleClientId"))
        else requestToken(context, config.text("googleClientId"))
    } }
    OutlinedButton({ start(false) }, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !busy) { Text("Google로 계속하기") }
    if(state.stage.isNotBlank()) Text(state.stage, color = Brand, modifier = Modifier.fillMaxWidth())
    if(!profile) ErrorNotice(state.error)
    if(state.error != null && !profile && state.diagnostics.isNotEmpty()) TextButton({ showDiagnostics = true }) { Text("로그인 확인 정보") }
    if(showDiagnostics) NativeSheet("로그인 확인 정보", { showDiagnostics = false }) {
        Text("계정을 선택했는데 진행되지 않을 때 이 정보를 알려주세요.")
        Text("뭉실 ${kr.kro.mungsil.BuildConfig.VERSION_NAME} (${kr.kro.mungsil.BuildConfig.VERSION_CODE})")
        state.diagnostics.forEachIndexed { index, step -> Text("${index + 1}. $step") }
        Text("계정 정보와 인증 토큰은 포함되지 않아요.", color = Muted)
    }
    if(state.alternative && !profile) TextButton({ start(true) }, enabled = !busy) { Text("다른 방식으로 Google 계정 선택") }
    if (profile) NativeSheet("Google 가입 마무리", { model.cancel() }, dismissible = !busy) {
        Text("계정을 만들기 위해 아래 정보를 확인해주세요.")
        Field("사용자 아이디", handle, { handle = it }, 20, hint = "영문 소문자, 숫자, 점, 밑줄 3~20자")
        Field("생년월일", birth, { birth = it }, 10, keyboard = KeyboardType.Ascii, hint = "예: 1995-04-23")
        if (config.flag("inviteRequired")) Field("초대 코드", invite, { invite = it }, 80)
        Row { Checkbox(consent, { consent = it }); Text("로그인 화면의 이용약관과 개인정보 처리방침을 확인했어요.", Modifier.weight(1f)) }
        ErrorNotice(validation ?: state.error)
        if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Primary("Google 계정으로 가입 완료", !busy) {
            validation = when {
                !handle.matches(Regex("^[a-z0-9._]{3,20}$")) -> "사용자 아이디 형식을 확인해주세요."
                runCatching { LocalDate.parse(birth) }.isFailure -> "생년월일을 YYYY-MM-DD 형식으로 입력해주세요."
                !consent -> "이용약관과 개인정보 처리방침을 확인해주세요."
                else -> null
            }
            if (validation == null) model.submit(api, handle, birth, invite.trim())
        }
    }
}
