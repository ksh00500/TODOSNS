package kr.kro.mungsil.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import kr.kro.mungsil.data.*
import kr.kro.mungsil.push.Push

@Composable fun PushSettings(api: Api) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var revision by remember { mutableIntStateOf(0) }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) { revision++; Push.sync(context) } }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val action = rememberAction()
    val configured = Push.configured(context)
    val active = remember(revision) { Push.enabled(context) && Push.allowed(context) }
    fun enable() { action.run {
        if (!api.request("me/push-devices/config").obj().flag("enabled")) throw ApiException(503, "푸시 알림을 준비하고 있어요. 조금 뒤 다시 시도해주세요.")
        Push.channel(context)
        val token = FirebaseMessaging.getInstance().token.await()
        api.request("me/push-devices", "POST", json("installationId" to Push.installation(context), "token" to token))
        Push.setEnabled(context, true)
        revision++
        action.notice = "이 기기에서 새 소식을 알려드릴게요."
    } }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        revision++
        if (granted) enable() else action.notice = "알림 권한을 허용하지 않았어요. 앱 안의 알림함은 계속 사용할 수 있어요."
    }
    CloudCard {
        Text("푸시 알림", style = MaterialTheme.typography.titleMedium)
        Text(if (!configured) "푸시 알림을 준비하고 있어요. 앱 안의 알림함을 이용해주세요." else if (active) "이 기기에서 새 소식을 받고 있어요." else "앱을 닫아도 새로운 응원과 소식을 받을 수 있어요.")
        ActionFeedback(action)
        if (configured) {
            OutlinedButton({
                if (active) action.run {
                    Push.setEnabled(context, false); revision++
                    api.request("me/push-devices/remove", "POST", json("installationId" to Push.installation(context)))
                    action.notice = "이 기기의 푸시 알림을 껐어요."
                } else if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else if (!Push.allowed(context)) {
                    action.notice = "기기 설정에서 뭉실의 알림을 허용해주세요."
                } else enable()
            }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !action.busy) { Text(if (active) "이 기기 알림 끄기" else "새 소식 알림 받기") }
            TextButton({
                val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}"))
                context.startActivity(intent)
            }) { Text("기기 알림 설정 열기") }
        }
    }
}
