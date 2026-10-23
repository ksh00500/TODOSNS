package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CloudQueue
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*
import java.time.LocalDate

@Composable fun AuthScreen(api: Api, signedIn: (JsonObject) -> Unit, back: () -> Unit = {}, browse: () -> Unit) {
    var mode by rememberSaveable { mutableStateOf("login") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var nickname by rememberSaveable { mutableStateOf("") }
    var handle by rememberSaveable { mutableStateOf("") }
    var birth by rememberSaveable { mutableStateOf("") }
    var invite by rememberSaveable { mutableStateOf("") }
    var consent by rememberSaveable { mutableStateOf(false) }
    var validation by remember { mutableStateOf<String?>(null) }
    val action = rememberAction()
    var googleBusy by remember { mutableStateOf(false) }
    val busy = action.busy || googleBusy
    var legal by remember { mutableStateOf<String?>(null) }
    val config = rememberRemote(api) { api.request("auth/config", authenticated = false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ActionIcon("홈으로", Icons.AutoMirrored.Rounded.ArrowBack, !busy, back)
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) { CloudMark(Modifier.size(30.dp, 24.dp)); Text("뭉실", Modifier.padding(start = 8.dp), color = Brand, style = MaterialTheme.typography.titleLarge) }
            Spacer(Modifier.width(48.dp))
        }
        Text(when(mode) { "signup" -> "새로운 구름이 반가워요"; "reset" -> "계정을 다시 이어가요"; else -> "다시 만나 반가워요" }, color = Brand)
        Heading(when(mode) { "signup" -> "작은 실천을\n함께 시작해요."; "reset" -> "비밀번호 찾기"; else -> "오늘의 뭉실을\n이어가 볼까요?" }, when(mode) { "signup" -> "초대받은 사람들과 작은 실천을 나누며 천천히 나만의 구름을 키워보세요."; "reset" -> "가입한 이메일로 비밀번호 재설정 링크를 보내드려요."; else -> "내 TODO와 응원, 이어오던 루틴이 기다리고 있어요." })
        Field("이메일", email, { email = it }, 254, keyboard = KeyboardType.Email)
        if(mode != "reset") Field("비밀번호", password, { password = it }, 72, password = true, hint = if(mode == "signup") "8~72자로 입력해주세요." else null)
        if(mode == "signup") {
            Field("닉네임", nickname, { nickname = it }, 20, hint = "2~20자")
            Field("사용자 아이디", handle, { handle = it }, 20, hint = "영문 소문자, 숫자, 점, 밑줄 3~20자")
            Field("생년월일", birth, { birth = it }, 10, hint = "예: 1995-04-23", keyboard = KeyboardType.Ascii)
            if(config.data?.obj()?.flag("inviteRequired") != false) Field("초대 코드", invite, { invite = it }, 80)
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(consent, { consent = it }); Text("이용약관과 개인정보 처리방침을 확인했어요.", Modifier.weight(1f)) }
        }
        ErrorNotice(validation)
        ActionFeedback(action)
        if(mode == "signup") { if(config.loading) LinearProgressIndicator(Modifier.fillMaxWidth()); ErrorNotice(config.error) { config.reload() } }
        Primary(if(busy) "처리 중…" else when(mode) { "signup" -> "가입하고 인증 메일 받기"; "reset" -> "재설정 메일 받기"; else -> "로그인" }, !busy && (mode != "signup" || config.data != null)) {
            validation = when {
                !android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() -> "올바른 이메일을 입력해주세요."
                mode != "reset" && password.isBlank() -> "비밀번호를 입력해주세요."
                mode == "signup" && (password.length < 8 || nickname.trim().length < 2 || !handle.matches(Regex("^[a-z0-9._]{3,20}$"))) -> "비밀번호, 닉네임, 사용자 아이디의 형식을 확인해주세요."
                mode == "signup" && runCatching { LocalDate.parse(birth) }.isFailure -> "생년월일을 YYYY-MM-DD 형식으로 입력해주세요."
                mode == "signup" && !consent -> "이용약관과 개인정보 처리방침을 확인해주세요."
                else -> null
            }
            if(validation == null) action.run {
                when(mode) {
                    "login" -> { val user = api.signIn(email.trim(), password); password = ""; signedIn(user) }
                    "signup" -> {
                        val payload = json("email" to email.trim(), "password" to password, "nickname" to nickname.trim(), "handle" to handle, "birthDate" to birth)
                        if(invite.isNotBlank()) payload.addProperty("inviteCode", invite.trim())
                        val result = api.request("auth/signup", "POST", payload, authenticated = false).obj()
                        password = ""; mode = "login"
                        action.notice = if(result.flag("verificationEmailSent")) "인증 메일을 보냈어요. 메일의 인증을 마친 뒤 로그인해주세요." else "가입됐지만 인증 메일을 보내지 못했어요. 인증 메일 다시 보내기를 눌러주세요."
                    }
                    else -> { api.request("auth/forgot-password", "POST", json("email" to email.trim()), authenticated = false); action.notice = "해당 계정이 있다면 재설정 메일이 도착해요. 메일에서 변경 후 돌아와 로그인해주세요." }
                }
            }
        }
        if(mode == "login") {
            config.data?.obj()?.let { GoogleLogin(api, it, signedIn, action, busyChanged = { googleBusy = it }) }
            ErrorNotice(config.error) { config.reload() }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton({ mode = "signup"; validation = null }, enabled = !busy) { Text("회원가입") }
                TextButton({ mode = "reset"; validation = null }, enabled = !busy) { Text("비밀번호 찾기") }
            }
            TextButton({ action.run { api.request("auth/resend-verification", "POST", json("email" to email.trim()), authenticated = false); action.notice = "이메일을 확인해주세요. 스팸함도 살펴봐주세요." } }, enabled = !busy && email.isNotBlank()) { Text("인증 메일 다시 보내기") }
            OutlinedButton(browse, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !busy) { Text("먼저 둘러보기") }
        } else TextButton({ mode = "login"; validation = null }, enabled = !busy) { Text("로그인으로 돌아가기") }
        TextButton({ legal = "terms" }) { Text("이용약관") }
        TextButton({ legal = "privacy" }) { Text("개인정보 처리방침") }
    }
    legal?.let { kind -> NativeSheet("이용 안내", { legal = null }) { LegalContent(kind) } }
}
