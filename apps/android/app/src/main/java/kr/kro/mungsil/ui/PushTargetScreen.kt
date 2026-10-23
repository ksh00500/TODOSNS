package kr.kro.mungsil.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import kr.kro.mungsil.data.*
import kotlinx.coroutines.CancellationException

@Composable fun PushTargetScreen(api: Api, owner: String, id: String, navigate: (String) -> Unit) {
    var attempt by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    val onNavigate by rememberUpdatedState(navigate)
    LaunchedEffect(owner, id, attempt) {
        error = null
        try { onNavigate(resolvePushDestination(api, owner, id)) }
        catch(e: CancellationException) { throw e }
        catch(e: Exception) { error = friendlyError(e) }
    }
    PageList {
        item { Heading("새 소식을 확인하고 있어요") }
        item { if(error == null) LinearProgressIndicator() else ErrorNotice(error) { attempt++ } }
        item { TextButton({ onNavigate("notifications") }) { Text("알림 목록 보기") } }
    }
}
