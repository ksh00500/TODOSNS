package kr.kro.mungsil.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.tasks.await
import kr.kro.mungsil.BuildConfig
import kr.kro.mungsil.MainActivity
import kr.kro.mungsil.R
import kr.kro.mungsil.data.*
import java.util.UUID
import java.util.concurrent.TimeUnit

/** One Api instance serializes refresh for foreground UI and background push workers. */
object SessionApi {
    @Volatile private var instance: Api? = null
    fun get(context: Context): Api = instance ?: synchronized(this) {
        instance ?: Api(BuildConfig.API_URL, SecureSessionStore(context.applicationContext)).also { instance = it }
    }
}

object Push {
    const val CHANNEL = "mungsil_activity"
    private fun prefs(context: Context) = context.getSharedPreferences("push", Context.MODE_PRIVATE)
    fun configured(context: Context) = FirebaseApp.getApps(context).isNotEmpty()
    fun user(context: Context): String = prefs(context).getString("user", "").orEmpty()
    fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)
    fun allowed(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        (Build.VERSION.SDK_INT < 26 || context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    fun installation(context: Context): String = synchronized(this) {
        prefs(context).getString("installation", null) ?: UUID.randomUUID().toString().also {
            prefs(context).edit().putString("installation", it).commit()
        }
    }
    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "뭉실 새 소식", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "응원, 댓글, 대화 등 새로운 소식을 알려드려요."
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            })
    }
    @Synchronized fun bind(context: Context, userId: String) {
        if (user(context) != userId) {
            prefs(context).edit().putString("user", userId).putBoolean("enabled", false).remove("lastEvent").commit()
            NotificationManagerCompat.from(context).cancelAll()
        }
        sync(context)
    }
    @Synchronized fun clear(context: Context) {
        prefs(context).edit().remove("user").putBoolean("enabled", false).remove("lastEvent").commit()
        NotificationManagerCompat.from(context).cancelAll()
        if (configured(context)) FirebaseMessaging.getInstance().isAutoInitEnabled = false
    }
    fun setEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean("enabled", value).commit()
        if (!value) NotificationManagerCompat.from(context).cancelAll()
        if (configured(context)) FirebaseMessaging.getInstance().isAutoInitEnabled = value
        sync(context)
    }
    fun sync(context: Context) {
        if (!configured(context) || user(context).isBlank()) return
        val request = OneTimeWorkRequestBuilder<PushWorker>().setInputData(workDataOf("kind" to "sync", "userId" to user(context)))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("push-registration", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
    @Synchronized fun show(context: Context, userId: String, eventId: String, notificationId: String = "") {
        if (user(context) != userId || !enabled(context) || !allowed(context) || prefs(context).getString("lastEvent", "") == eventId) return
        channel(context)
        val intent = Intent(context, MainActivity::class.java).putExtra("pushUser", userId).putExtra("pushNotification", notificationId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 10, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("뭉실에 새 소식이 있어요").setContentText("앱에서 새로운 응원과 소식을 확인해보세요.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentIntent(pending).setAutoCancel(true)
            .setOnlyAlertOnce(true).build()
        // One generic summary, no message body or sender identity in the OS notification.
        try { NotificationManagerCompat.from(context).notify(10, notification) }
        catch (_: SecurityException) { return }
        prefs(context).edit().putString("lastEvent", eventId).apply()
    }
}

class MungsilMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { Push.sync(this) }
    override fun onMessageReceived(message: RemoteMessage) {
        val owner = message.data["userId"].orEmpty()
        val id = message.data["notificationId"].orEmpty()
        val event = message.data["eventId"].orEmpty()
        if (owner != Push.user(this) || !Push.enabled(this) || !Push.allowed(this) || !id.matches(Regex("^[a-zA-Z0-9_-]{1,100}$")) || event.length !in 1..160) return
        val request = OneTimeWorkRequestBuilder<PushWorker>().setInputData(workDataOf("kind" to "receive", "userId" to owner, "notificationId" to id, "eventId" to event))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .apply { if (Build.VERSION.SDK_INT >= 31) setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST) }.build()
        WorkManager.getInstance(this).enqueueUniqueWork("push-$event", ExistingWorkPolicy.KEEP, request)
    }
}

class PushWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val owner = inputData.getString("userId").orEmpty()
        if (owner.isBlank() || owner != Push.user(context)) return Result.success()
        val api = SessionApi.get(context)
        try {
            if (api.accessToken == null && !api.restore()) { Push.clear(context); return Result.success() }
            if (api.request("auth/me").obj().text("id") != owner || Push.user(context) != owner) return Result.success()
            if (inputData.getString("kind") == "receive") {
                if (!Push.enabled(context) || !Push.allowed(context)) return Result.success()
                val id = inputData.getString("notificationId").orEmpty()
                api.request("me/push-devices/notifications/$id") // Re-check session, ownership and unread state, without marking read.
                Push.show(context, owner, inputData.getString("eventId").orEmpty(), id)
            } else if (!Push.enabled(context) || !Push.allowed(context)) {
                api.request("me/push-devices/remove", "POST", json("installationId" to Push.installation(context)))
            } else {
                val token = FirebaseMessaging.getInstance().token.await()
                if (Push.user(context) != owner || !Push.enabled(context) || !Push.allowed(context)) return Result.success()
                api.request("me/push-devices", "POST", json("installationId" to Push.installation(context), "token" to token))
            }
            return Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: ApiException) {
            if (e.status == 401) { Push.clear(context); return Result.success() }
            if (e.status in listOf(400, 403, 404)) return Result.success()
        } catch (_: Exception) { /* Retry without logging tokens or provider payloads. */ }
        return if (runAttemptCount < 8) Result.retry() else Result.failure()
    }
}
