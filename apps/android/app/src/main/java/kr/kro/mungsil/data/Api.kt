package kr.kro.mungsil.data

import com.google.gson.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.*
import java.util.UUID
import java.util.concurrent.TimeUnit

fun json(vararg values: Pair<String, Any?>): JsonObject = GsonBuilder().serializeNulls().create().toJsonTree(mapOf(*values)).asJsonObject
fun JsonElement.obj(): JsonObject = if (isJsonObject) asJsonObject else JsonObject()
fun JsonElement.rows(): List<JsonObject> = if (isJsonArray) asJsonArray.map { it.obj() } else emptyList()
fun JsonObject.text(key: String, fallback: String = ""): String = get(key)?.takeUnless { it.isJsonNull }?.let { if (it.isJsonPrimitive) it.asString else null } ?: fallback
fun JsonObject.flag(key: String): Boolean = text(key) == "true"
fun JsonObject.number(key: String): Int = text(key).toIntOrNull() ?: 0
fun JsonObject.child(key: String): JsonObject = get(key)?.obj() ?: JsonObject()
fun JsonObject.list(key: String): List<JsonObject> = get(key)?.rows() ?: emptyList()
fun JsonObject.strings(key: String): List<String> = get(key)?.takeIf { it.isJsonArray }?.asJsonArray?.map { it.asString } ?: emptyList()
fun mergeRows(old: List<JsonObject>, incoming: List<JsonObject>): List<JsonObject> =
    (old + incoming).associateBy { it.text("id", it.text("userId")) }.values.toList()

fun dayRange(date: LocalDate, zone: ZoneId): Pair<String, String> =
    date.atStartOfDay(zone).toInstant().toString() to date.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1).toString()
fun localDate(value: String, zone: ZoneId): LocalDate = runCatching { Instant.parse(value).atZone(zone).toLocalDate() }.getOrDefault(LocalDate.now(zone))
fun localTime(value: String, zone: ZoneId): String = runCatching { Instant.parse(value).atZone(zone).toLocalTime().withSecond(0).withNano(0).toString() }.getOrDefault("09:00")
fun dueInstant(date: String, time: String, zone: ZoneId): String = LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(zone).toInstant().toString()
fun newKey(): String = UUID.randomUUID().toString()

interface SessionStore { fun read(): String?; fun write(value: String?) }
class ApiException(val status: Int, override val message: String, val code: String? = null, val requestId: String? = null, val stage: String? = null) : IOException(message)
fun friendlyError(error: Throwable): String = when (error) {
    is ApiException -> error.message + (error.requestId?.let { "\n문의 번호: $it" } ?: "")
    is IOException -> "연결을 확인한 뒤 다시 시도해주세요. 작성한 내용은 그대로 남아 있어요."
    else -> "처리하지 못했어요. 잠시 후 다시 시도해주세요."
}

/** Tokens never reach URLs, logs, image requests or ordinary preferences. */
class Api(val baseUrl: String, private val store: SessionStore) {
    private val root = baseUrl.toHttpUrl()
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    private val sessionMutex = Mutex()
    @Volatile var accessToken: String? = null
        private set
    @Volatile private var epoch = 0L
    var onExpired: (() -> Unit)? = null
    private val lock = Any()
    private var refreshToken: String? = store.read()

    private data class Reply(val value: JsonElement, val refresh: String?)

    private suspend fun exchange(path: String, method: String, body: JsonObject?, query: Map<String, String>, token: String?, cookie: String? = null, key: String? = null): Reply = withContext(Dispatchers.IO) {
        require(!path.startsWith("/") && !path.contains("://") && !path.contains(".."))
        val url = root.resolve(path)!!.newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (cookie != null) builder.header("Cookie", "mungsil_refresh=$cookie")
        if (key != null) builder.header("Idempotency-Key", key)
        builder.method(method, if (method == "GET") null else (body ?: json()).toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        http.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val value = runCatching { JsonParser.parseString(raw) }.getOrDefault(JsonNull.INSTANCE)
            if (!response.isSuccessful) {
                val message = value.obj().get("message")?.let { if (it.isJsonArray) it.asJsonArray.joinToString("\n") { part -> part.asString } else if(it.isJsonPrimitive) it.asString else null }
                throw ApiException(response.code, when {
                    response.code >= 500 -> "서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요."
                    response.code == 401 && path == "auth/google" -> "Google 계정을 확인하지 못했어요. 다시 선택해주세요. 계속 실패하면 앱 버전과 문의 번호를 알려주세요."
                    response.code == 401 && path == "auth/login" -> message?.takeIf { it.any { c -> c in '가'..'힣' } } ?: "이메일과 비밀번호를 확인해주세요."
                    response.code == 401 -> "로그인이 만료됐어요. 다시 로그인해주세요."
                    response.code == 429 -> "요청이 많아요. 잠시 기다린 뒤 다시 시도해주세요."
                    else -> message?.takeIf { it.any { char -> char in '가'..'힣' } } ?: "요청을 처리하지 못했어요. 입력 내용과 권한을 확인해주세요."
                }, value.obj().text("code").takeIf { it.isNotBlank() }, response.header("x-request-id")?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,80}")) }, if(path.startsWith("auth/")) path else "request")
            }
            Reply(value, Cookie.parseAll(url, response.headers).firstOrNull { it.name == "mungsil_refresh" }?.value)
        }
    }

    private fun accept(reply: Reply, expectedEpoch: Long): JsonObject = synchronized(lock) {
        if (epoch != expectedEpoch) throw ApiException(401, "로그인 상태가 바뀌었어요. 다시 시도해주세요.")
        val result = reply.value.obj()
        val nextAccess = result.text("accessToken").takeIf { it.isNotBlank() } ?: throw ApiException(502, "로그인 응답을 확인하지 못했어요. 다시 시도해주세요.", "SESSION_RESPONSE_INVALID", stage = "session")
        val nextRefresh = reply.refresh?.takeIf { it.isNotBlank() } ?: throw ApiException(502, "로그인 유지 정보를 받지 못했어요. 다시 시도해주세요.", "SESSION_COOKIE_MISSING", stage = "session")
        if(result.child("user").text("id").isBlank()) throw ApiException(502, "사용자 정보를 확인하지 못했어요. 다시 시도해주세요.", "SESSION_USER_MISSING", stage = "session")
        store.write(nextRefresh)
        accessToken = nextAccess
        refreshToken = nextRefresh
        result.child("user")
    }

    suspend fun signIn(email: String, password: String): JsonObject = sessionMutex.withLock {
        val generation = epoch
        accept(exchange("auth/login", "POST", json("email" to email, "password" to password), emptyMap(), null), generation)
    }

    suspend fun signInGoogle(idToken: String, handle: String? = null, birthDate: String? = null, inviteCode: String? = null): JsonObject = sessionMutex.withLock {
        val generation = epoch
        val body = json("idToken" to idToken)
        handle?.let { body.addProperty("handle", it) }
        birthDate?.let { body.addProperty("birthDate", it) }
        inviteCode?.takeIf { it.isNotBlank() }?.let { body.addProperty("inviteCode", it) }
        accept(exchange("auth/google", "POST", body, emptyMap(), null), generation)
    }

    suspend fun verifyEmail(token: String): JsonObject = sessionMutex.withLock {
        val generation = epoch
        accept(exchange("auth/verify-email", "POST", json("token" to token), emptyMap(), null), generation)
    }

    suspend fun restore(): Boolean = sessionMutex.withLock {
        if (refreshToken == null) return@withLock false
        refreshLocked()
        true
    }

    private suspend fun refreshLocked() {
        val generation = epoch
        val refresh = refreshToken ?: throw ApiException(401, "다시 로그인해주세요.")
        try { accept(exchange("auth/refresh", "POST", json(), emptyMap(), null, refresh), generation) }
        catch (error: ApiException) {
            if (error.status == 401 && generation == epoch) { clear(); onExpired?.invoke() }
            throw error
        }
    }

    suspend fun request(path: String, method: String = "GET", body: JsonObject? = null, query: Map<String, String> = emptyMap(), authenticated: Boolean = true, key: String? = null): JsonElement {
        val generation = epoch
        val token = if (authenticated) accessToken else null
        val mutationKey = if (method != "GET" && authenticated) key ?: newKey() else null
        try {
            val reply = exchange(path, method, body, query, token, key = mutationKey)
            if (authenticated && generation != epoch) throw ApiException(401, "로그인 상태가 바뀌었어요. 다시 시도해주세요.")
            return reply.value
        } catch (error: ApiException) {
            if (error.status != 401 || !authenticated || generation != epoch) throw error
            sessionMutex.withLock { if (accessToken == token && generation == epoch) refreshLocked() }
            val reply = exchange(path, method, body, query, accessToken, key = mutationKey)
            if (generation != epoch) throw ApiException(401, "다시 로그인해주세요.")
            return reply.value
        }
    }

    suspend fun logout() {
        // Keep credentials on a transport failure so the user can retry server revocation.
        sessionMutex.withLock {
            exchange("auth/logout", "POST", json(), emptyMap(), accessToken, refreshToken)
            clear()
        }
    }
    fun clear() = synchronized(lock) { epoch++; accessToken = null; refreshToken = null; store.write(null) }

    suspend fun upload(bytes: ByteArray, mime: String, progress: (Float) -> Unit = {}): String {
        require(bytes.isNotEmpty() && bytes.size <= 10_000_000)
        require(mime in listOf("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"))
        val signed = request("me/media/presign", "POST", json("filename" to "photo.${mime.substringAfter('/')}" , "mimeType" to mime, "size" to bytes.size)).obj()
        val uploadUrl = signed.text("uploadUrl").toHttpUrl()
        require(uploadUrl.isHttps) { "Secure upload required" }
        withContext(Dispatchers.IO) {
            val body = object : RequestBody() {
                override fun contentType() = mime.toMediaType()
                override fun contentLength() = bytes.size.toLong()
                override fun writeTo(sink: okio.BufferedSink) {
                    var offset = 0
                    while(offset < bytes.size) { val count = minOf(8192, bytes.size-offset); sink.write(bytes, offset, count); offset += count; progress(offset.toFloat()/bytes.size) }
                }
            }
            http.newCall(Request.Builder().url(uploadUrl).put(body).build()).execute().use {
                if (!it.isSuccessful) throw IOException("Upload failed")
            }
        }
        val id = signed.text("mediaId")
        request("me/media/complete", "POST", json("mediaId" to id))
        return id
    }
}
