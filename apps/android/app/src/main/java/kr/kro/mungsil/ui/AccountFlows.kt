package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.data.*

@Composable fun EmailLinkScreen(api: Api, link: AppLink, signedIn: (JsonObject) -> Unit, done: () -> Unit) {
    val verify = link.route == "verify-email"
    val action = rememberAction()
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var complete by remember { mutableStateOf(false) }
    var validation by remember { mutableStateOf<String?>(null) }
    PageList {
        item { Heading(if(verify) "이메일 인증" else "새 비밀번호를 정해주세요") }
        if(link.token == null) item { ErrorNotice("사용할 수 없는 링크예요. 로그인 화면에서 새 메일을 요청해주세요.") }
        else if(complete) item { Text("비밀번호를 변경했어요. 새 비밀번호로 로그인해주세요.") }
        else item {
            if(!verify) {
                Field("새 비밀번호", password, { password = it }, 72, password = true, hint = "8~72자로 입력해주세요.")
                Field("새 비밀번호 확인", confirmation, { confirmation = it }, 72, password = true)
            } else Text("인증을 완료하면 관심사를 고르고 실천을 시작할 수 있어요.")
            ErrorNotice(validation); ActionFeedback(action)
            Primary(if(verify) "이메일 인증 완료" else "비밀번호 변경", !action.busy) {
                validation = if(!verify && (password.length !in 8..72 || password != confirmation)) "8~72자의 동일한 비밀번호를 입력해주세요." else null
                if(validation == null) action.run {
                    if(verify) { val user = api.verifyEmail(link.token); signedIn(user); done() }
                    else { api.request("auth/reset-password", "POST", json("token" to link.token, "password" to password), authenticated = false); password = ""; confirmation = ""; complete = true }
                }
            }
        }
        item { TextButton(done, enabled = !action.busy) { Text("돌아가기") } }
    }
}

@Composable fun OnboardingScreen(api: Api, done: () -> Unit) {
    var interests by rememberSaveable { mutableStateOf(listOf<String>()) }
    val action = rememberAction()
    PageList {
        item { Heading("어떤 실천을 좋아하세요?", "관심사를 2개 이상 골라주세요. 나중에 바꿀 수 있어요.") }
        item { InterestChoices(interests) { interests = it } }
        item { ActionFeedback(action); Primary("나의 실천 시작하기", interests.size >= 2 && !action.busy) { action.run { api.request("me", "PATCH", json("interests" to interests, "onboardingCompleted" to true)); done() } } }
        item { TextButton(done, enabled = !action.busy) { Text("나중에 선택할게요") } }
    }
}

@Composable fun InterestChoices(values: List<String>, change: (List<String>) -> Unit) {
    baseCategories.chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        pair.forEach { name -> FilterChip(name in values, { change(if(name in values) values - name else values + name) }, { Text(name) }, Modifier.weight(1f).heightIn(min = 52.dp)) }
    } }
}
