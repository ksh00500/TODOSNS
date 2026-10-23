package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.lifecycle.repeatOnLifecycle
import com.google.gson.JsonObject
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kr.kro.mungsil.data.*
import java.net.URI

@Composable fun InboxScreen(api: Api, revision: Int, changed: () -> Unit, navigate: (String) -> Unit) {
    val rooms = rememberRemote(revision) { api.request("messages/inbox") }
    val requests = rememberRemote(revision) { api.request("messages/requests") }
    var showing by remember { mutableStateOf(false) }
    PageList {
        item { Heading("나의 대화함", "함께하는 사람들과 안부를 나눠요.") }
        item { OutlinedButton({ showing = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("메시지 요청 ${requests.data?.rows()?.size ?: 0}개") } }
        remoteStatus(requests); remoteStatus(rooms)
        if(rooms.data?.rows()?.isEmpty() == true) item { EmptyState("아직 시작한 대화가 없어요", "상대 프로필에서 메시지를 요청할 수 있어요.") }
        items(rooms.data?.rows().orEmpty(), key = { it.text("id") }) { room -> CloudCard {
            Text("${if(room.text("kind") == "DIRECT") "1:1" else "챌린지"}${if(room.flag("readOnly")) " · 종료됨" else ""}", color = Muted)
            Text(room.text("title"), style = MaterialTheme.typography.titleMedium)
            Text(if(room.child("lastMessage").flag("deleted")) "삭제된 메시지" else room.child("lastMessage").text("body", "새로운 대화를 시작해보세요."))
            TextButton({ navigate(if(room.text("kind") == "DIRECT") "chat/direct/${room.text("id")}" else "chat/challenge/${room.text("href").split('/').getOrNull(2)}") }) { Text("대화 보기 · 안 읽음 ${room.number("unreadCount")}") }
        } }
        item { TextButton({ rooms.reload(); requests.reload() }) { Text("새로고침") } }
    }
    if(showing) {
        val action = rememberAction()
        NativeSheet("메시지 요청", { showing = false }, !action.busy) {
            requests.data?.rows().orEmpty().forEach { request ->
                Text(request.child("sender").text("nickname"), fontWeight = FontWeight.Bold)
                Row {
                    TextButton({ action.run { val result = api.request("messages/requests/${request.text("id")}/accept", "POST").obj(); changed(); showing = false; navigate("chat/direct/${result.text("conversationId")}") } }, enabled = !action.busy) { Text("수락") }
                    TextButton({ action.run { api.request("messages/requests/${request.text("id")}", "DELETE"); changed() } }, enabled = !action.busy) { Text("거절") }
                }
            }
            if(requests.data?.rows()?.isEmpty() == true) Text("새 요청이 없어요.")
            ActionFeedback(action)
        }
    }
}

/** REST remains authoritative. Every reconnect reconciles all already loaded messages. */
@Composable fun ChatScreen(api: Api, route: String, zone: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul"),
    photoPicker: @Composable (Api, String?, (String?) -> Unit, (Boolean) -> Unit, () -> Unit) -> Unit = { source, media, update, pending, excluded -> PhotoPicker(source, media, update, pending = pending, excluded = excluded) }) {
    val challenge = route.startsWith("challenge/")
    val id = route.substringAfter('/')
    val path = if(challenge) "challenges/$id/chat" else "messages/$id"
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateAsState()
    var messages by remember(route) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var room by remember(route) { mutableStateOf(JsonObject()) }
    var cursor by remember(route) { mutableStateOf<String?>(null) }
    var error by remember(route) { mutableStateOf<String?>(null) }
    var loading by remember(route) { mutableStateOf(true) }
    var initialized by remember(route) { mutableStateOf(false) }
    var signal by remember(route) { mutableIntStateOf(0) }
    var connected by remember(route) { mutableStateOf(false) }
    var token by remember(route) { mutableStateOf(api.accessToken) }
    var newCount by remember(route) { mutableIntStateOf(0) }
    var body by rememberSaveable(route) { mutableStateOf("") }
    var reply by remember(route) { mutableStateOf<JsonObject?>(null) }
    var selected by remember(route) { mutableStateOf<JsonObject?>(null) }
    var editing by remember(route) { mutableStateOf<JsonObject?>(null) }
    var history by remember(route) { mutableStateOf<String?>(null) }
    var managing by remember(route) { mutableStateOf<JsonObject?>(null) }
    var settings by remember(route) { mutableStateOf(false) }
    var members by remember(route) { mutableStateOf(false) }
    var readError by remember(route) { mutableStateOf<String?>(null) }
    var readAttempt by remember(route) { mutableIntStateOf(0) }
    var removing by remember(route) { mutableStateOf<JsonObject?>(null) }
    var report by remember(route) { mutableStateOf<String?>(null) }
    val photos = rememberSaveable(route, saver = ChatPhotos.StateSaver) { ChatPhotos() }
    val photoStates = rememberSaveableStateHolder()
    val photoPending = photos.incomplete
    var pendingPhotos by remember(route) { mutableStateOf(emptySet<String>()) }
    var viewingPhoto by remember(route) { mutableStateOf<JsonObject?>(null) }
    var linkError by remember(route) { mutableStateOf<String?>(null) }
    val uriHandler = LocalUriHandler.current
    var attach by rememberSaveable(route) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val atBottom by remember { derivedStateOf { !listState.canScrollForward } }
    val mutex = remember(route) { Mutex() }
    val action = rememberAction()
    val muted = runCatching { java.time.Instant.parse(room.text("mutedUntil")).isAfter(java.time.Instant.now()) }.getOrDefault(false)
    val writable = initialized && if(challenge) !room.flag("readOnly") && !muted else room.flag("canSend")
    val refresh: suspend (Boolean) -> Unit = { older -> mutex.withLock {
        loading = true
        try {
            val wasBottom = atBottom
            val previousIds = messages.map { it.text("id") }.toSet()
            val oldest = messages.firstOrNull()?.text("id")
            val query = mutableMapOf("limit" to "50")
            if(older && cursor != null) query["cursor"] = cursor!!
            var page = api.request(path, query = query).obj()
            val currentRoom = page.child("room")
            var fresh = page.list("items")
            if(!older) {
                // A reconnect can span more than one page; stop only once history overlaps.
                while(oldest != null && fresh.none { it.text("id") == oldest } && page.text("nextCursor").isNotBlank()) {
                    page = api.request(path, query = mapOf("limit" to "50", "cursor" to page.text("nextCursor"))).obj()
                    fresh = mergeRows(page.list("items"), fresh)
                }
            }
            room = currentRoom
            cursor = page.text("nextCursor").ifBlank { null }
            messages = if(older) mergeRows(fresh, messages) else fresh
            messages = messages.sortedWith(compareBy<JsonObject> { it.text("createdAt") }.thenBy { it.text("id") })
            if(!older) {
                val added = fresh.count { it.text("id") !in previousIds }
                if(!initialized || wasBottom) {
                    newCount = 0
                    if(messages.isNotEmpty()) scope.launch { delay(50); listState.scrollToItem(messages.size) }
                } else newCount += added
            }
            token = api.accessToken; initialized = true; error = null
        } catch(e: CancellationException) { throw e }
        catch(e: Exception) {
            error = friendlyError(e)
            if(e is ApiException && e.status in listOf(401, 403, 404)) { messages = emptyList(); room = JsonObject(); initialized = false }
        } finally { loading = false }
    } }
    val currentRefresh by rememberUpdatedState(refresh)
    LaunchedEffect(route) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while(isActive) { currentRefresh(false); delay(10_000) } } }
    LaunchedEffect(signal) { if(signal > 0 && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) currentRefresh(false) }
    val conversationId = room.text("conversationId")
    DisposableEffect(conversationId, token, lifecycleState) {
        var socket: Socket? = null
        if(conversationId.isNotBlank() && token != null && lifecycleState.isAtLeast(Lifecycle.State.STARTED)) {
            val root = URI(api.baseUrl)
            val url = "${root.scheme}://${root.authority}/chat"
            socket = IO.socket(url, IO.Options.builder().setAuth(mapOf("token" to token!!)).setReconnection(true).build())
            val active = socket
            active.on(Socket.EVENT_CONNECT) { active.emit("join", conversationId); scope.launch { connected = true; signal++ } }
            active.on(Socket.EVENT_DISCONNECT) { scope.launch { connected = false } }
            active.on(Socket.EVENT_CONNECT_ERROR) { scope.launch { connected = false } }
            listOf("message.created", "message.updated", "message.deleted", "reaction.updated", "room.closed").forEach { event -> active.on(event) { scope.launch { signal++ } } }
            active.connect()
        }
        onDispose { socket?.off(); socket?.disconnect(); connected = false }
    }
    val latestId = messages.lastOrNull()?.text("id")
    LaunchedEffect(atBottom, latestId, lifecycleState, readAttempt) {
        if(atBottom && latestId != null && lifecycleState.isAtLeast(Lifecycle.State.STARTED)) {
            newCount = 0
            try { api.request("$path/read", "POST", json("messageId" to latestId)); readError = null }
            catch(e: CancellationException) { throw e } catch(e: Exception) { readError = "읽음 위치를 저장하지 못했어요. 다시 시도해주세요." }
        }
    }
    val payload = json("body" to body.trim()).apply { reply?.let { addProperty("replyToId", it.text("id")) }; if(photos.mediaIds.isNotEmpty()) add("mediaIds", com.google.gson.Gson().toJsonTree(photos.mediaIds)) }
    val sendKey = rememberSaveable(route, payload.toString()) { newKey() }
    // Capture one immutable list and its empty-state decision before constructing
    // LazyListScope. Reading the state delegate inside its cached builder can
    // change the interval count while Compose is measuring a previous index.
    val displayedMessages = messages
    val showEmpty = initialized && displayedMessages.isEmpty()
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Text(if(challenge) room.text("title", "챌린지 대화") else room.child("otherUser").text("nickname", "1:1 대화"), fontWeight = FontWeight.Bold)
            Text(if(connected) "연결됨" else "주기적으로 대화를 확인하고 있어요.", color = Muted, style = MaterialTheme.typography.labelMedium)
            ErrorNotice(error) { scope.launch { currentRefresh(false) } }
            ErrorNotice(readError) { readAttempt++ }
            ErrorNotice(linkError)
            if(challenge) Row { TextButton({ settings = true }) { Text("방 알림") }; TextButton({ members = true }) { Text("참여자") } }
            if(loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "older") { if(cursor != null) TextButton({ scope.launch { currentRefresh(true) } }, enabled = !loading) { Text("이전 메시지 보기") } }
            itemsIndexed(displayedMessages, key = { _, it -> it.text("id") }) { index, message ->
                val day = localDate(message.text("createdAt"), zone)
                if(index == 0 || day != localDate(displayedMessages[index-1].text("createdAt"), zone)) Text(day.format(java.time.format.DateTimeFormatter.ofPattern("yyyy년 M월 d일")), Modifier.fillMaxWidth().padding(vertical = 8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center, color = Muted, style = MaterialTheme.typography.bodySmall)
                var expanded by remember(message.text("id")) { mutableStateOf(false) }
                val collapsed = message.flag("blocked") && !expanded
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if(message.flag("isMine")) Arrangement.End else Arrangement.Start) {
                Surface(onClick = { if(collapsed) expanded = true else selected = message }, shape = MaterialTheme.shapes.medium, color = if(message.flag("isMine")) Aqua else MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth(0.88f)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val contentVisible = !collapsed && message.text("deletedAt").isBlank() && message.text("hiddenAt").isBlank()
                        Text(if(message.flag("isMine")) "나" else message.child("sender").text("nickname", "안내"), fontWeight = FontWeight.SemiBold)
                        if(contentVisible && message.child("replyTo").text("id").isNotBlank()) Text("↳ ${message.child("replyTo").text("body", "삭제된 메시지")}", color = Muted)
                        Text(if(collapsed) "차단한 사용자의 메시지 · 눌러서 보기" else if(message.text("deletedAt").isNotBlank() || message.text("hiddenAt").isNotBlank()) "삭제되거나 숨겨진 메시지예요." else message.text("body"))
                        if(contentVisible) message.list("media").chunked(2).forEachIndexed { rowIndex, row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEachIndexed { photoIndex, media ->
                                val url = media.text("url")
                                val thumbnail = media.text("thumbnailUrl").ifBlank { url }
                                Surface(shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "대화 사진 크게 보기") { viewingPhoto = media }) {
                                    Photo(thumbnail, "대화 사진 ${rowIndex * 2 + photoIndex + 1}", Modifier.aspectRatio(1f), scale = androidx.compose.ui.layout.ContentScale.Crop)
                                }
                            }; if(row.size == 1 && message.list("media").size > 1) Spacer(Modifier.weight(1f)) }
                        }
                        if(contentVisible) message.list("links").forEach { link ->
                            val url = link.text("url")
                            val parsed = runCatching { URI(url) }.getOrNull()
                            if(parsed?.scheme in listOf("http", "https") && !parsed?.host.isNullOrBlank()) {
                                OutlinedButton({ try { uriHandler.openUri(url); linkError = null } catch(_: Exception) { linkError = "링크를 열지 못했어요. 브라우저 설정을 확인해주세요." } }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                    Column { Text(parsed!!.host.removePrefix("www."), fontWeight = FontWeight.Bold); Text(url, style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                        if(!collapsed && message.list("reactions").isNotEmpty()) Text(message.list("reactions").joinToString(" · ") { "${reactionName(it.text("type"))} ${it.number("count")}" }, color = Brand)
                        Text(runCatching { java.time.Instant.parse(message.text("createdAt")).atZone(zone).format(java.time.format.DateTimeFormatter.ofPattern("a h:mm", java.util.Locale.KOREAN)) }.getOrDefault("") + if(message.text("editedAt").isNotBlank()) " · 수정됨" else "", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
                }
            }
            if(showEmpty) item(key = "empty") { EmptyState("첫 안부를 건네보세요", "서로의 작은 실천을 응원해요.") }
        }
        if(newCount > 0) TextButton({ scope.launch { listState.scrollToItem(messages.size); newCount = 0 } }, Modifier.fillMaxWidth()) { Text("새 메시지 ${newCount}개 · 아래로") }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ActionFeedback(action)
            if(writable) {
                if(reply != null) TextButton({ reply = null }) { Text("답장: ${reply!!.text("body").take(60)} · 취소") }
                if(photoPending) Text("사진 업로드를 완료하거나 첨부 화면에서 사진을 제외해주세요.", color = Muted)
                if(photos.entries.isNotEmpty()) TextButton({ attach = true }, enabled = !action.busy) { Text("사진 ${photos.entries.size}장 · 첨부 관리") }
                Field("메시지", body, { body = it }, 2000, enabled = !action.busy)
                Row {
                    TextButton({ if(photos.entries.isEmpty()) photos.add(); attach = true }, enabled = !action.busy) { Text("사진") }
                    Button({ action.run { api.request("$path/messages", "POST", payload, key = sendKey); body = ""; reply = null; photos.entries.forEach { photoStates.removeState(it.key) }; photos.clear(); currentRefresh(false) } }, Modifier.weight(1f).heightIn(min = 48.dp), enabled = !action.busy && !photoPending && pendingPhotos.isEmpty() && (body.isNotBlank() || photos.mediaIds.isNotEmpty())) { Text("전송") }
                }
            } else if(initialized) Text("${if(room.flag("blocked")) "차단 관계로" else "종료되었거나 권한이 제한되어"} 메시지를 변경할 수 없어요. 기존 기록은 볼 수 있어요.", color = Muted)
        }
    }
    selected?.let { message ->
        val unavailable = message.text("deletedAt").isNotBlank() || message.text("hiddenAt").isNotBlank()
        NativeSheet("메시지", { selected = null }) {
            if(writable && !unavailable) {
                TextButton({ reply = message; selected = null }) { Text("답장") }
                listOf("LIKE", "HELPFUL", "CHEER", "EMPATHY", "SEEN").forEach { type ->
                    val reactionKey = remember(message.toString(), type) { newKey() }
                    TextButton({ action.run { api.request("$path/messages/${message.text("id")}/reactions", "POST", json("type" to type), key = reactionKey); selected = null; currentRefresh(false) } }, enabled = !action.busy) { Text(reactionName(type)) }
                }
            }
            if(challenge && writable && message.flag("canEdit")) TextButton({ editing = message; selected = null }) { Text("수정") }
            if(challenge && message.text("editedAt").isNotBlank()) TextButton({ history = message.text("id"); selected = null }) { Text("수정 기록") }
            if(challenge && message.flag("canModerate")) TextButton({ managing = message; selected = null }) { Text("메시지 관리") }
            if(writable && message.flag("canDelete")) TextButton({ removing = message; selected = null }) { Text("삭제") }
            if(!message.flag("isMine") && !unavailable && message.text("kind") != "SYSTEM") TextButton({ report = message.text("id"); selected = null }) { Text("신고") }
        }
    }
    if(settings) ChatSettingsSheet(api, path, room.text("notificationLevel", "ALL"), { settings = false }) { signal++ }
    if(members) ChatMembersSheet(api, path, room.flag("canManage"), { members = false })
    managing?.let { message -> MessageModerationSheet(api, path, message, { managing = null }) { signal++ } }
    editing?.let { message ->
        var text by rememberSaveable(message.text("id")) { mutableStateOf(message.text("body")) }
        val editAction = rememberAction()
        NativeSheet("메시지 수정", { editing = null }, !editAction.busy, dirty = text != message.text("body")) {
            Field("메시지", text, { text = it }, 2000, multiline = true)
            ActionFeedback(editAction)
            Primary("수정 저장", !editAction.busy && (text.isNotBlank() || message.list("media").isNotEmpty())) { editAction.run { api.request("$path/messages/${message.text("id")}", "PATCH", json("body" to text.trim())); editing = null; currentRefresh(false) } }
        }
    }
    history?.let { messageId ->
        val remote = rememberRemote(messageId) { api.request("$path/messages/$messageId/revisions") }
        NativeSheet("메시지 수정 기록", { history = null }) {
            if(remote.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            ErrorNotice(remote.error) { remote.reload() }
            remote.data?.rows()?.forEach { Text(it.text("body", "내용 없음")); Text(displayTime(it.text("createdAt")), color = Muted) }
        }
    }
    removing?.let { message -> ConfirmSheet("메시지를 삭제할까요?", "삭제하면 내용을 되돌릴 수 없어요.", "삭제", { removing = null }) { api.request("$path/messages/${message.text("id")}", "DELETE"); currentRefresh(false) } }
    report?.let { ReportSheet(api, "MESSAGE", it, { report = null }) }
    if(attach) NativeSheet("사진 첨부", {
        photos.entries.filter { it.mediaId == null }.forEach { photoStates.removeState(it.key); photos.remove(it.key) }
        pendingPhotos = emptySet(); attach = false
    }, dirty = photoPending) {
        Text("사진은 최대 4장까지 보낼 수 있어요.")
        photos.entries.forEachIndexed { index, entry ->
            key(entry.key) { photoStates.SaveableStateProvider(entry.key) {
                Text("사진 ${index + 1}", style = MaterialTheme.typography.titleMedium)
                photoPicker(api, entry.mediaId, { photos.update(entry.key, it) }, { pending -> pendingPhotos = if(pending) pendingPhotos + entry.key else pendingPhotos - entry.key }, { photoStates.removeState(entry.key); photos.remove(entry.key); pendingPhotos = pendingPhotos - entry.key })
                TextButton({ photoStates.removeState(entry.key); photos.remove(entry.key); pendingPhotos = pendingPhotos - entry.key }) { Text("사진 ${index + 1} 첨부 삭제") }
            } }
        }
        OutlinedButton({ photos.add() }, enabled = photos.entries.size < 4) { Text("첨부할 사진 추가") }
        if(photoPending) Text("업로드를 완료하거나 실패한 사진을 제외해주세요.", color = Muted)
        Primary("대화로 돌아가기", !photoPending && pendingPhotos.isEmpty()) { attach = false }
    }
    viewingPhoto?.let { media -> NativeSheet("대화 사진", { viewingPhoto = null }) {
        val width = media.number("width"); val height = media.number("height")
        val aspect = if(width > 0 && height > 0) Modifier.aspectRatio(width.toFloat() / height) else Modifier
        Photo(media.text("url"), "대화 사진 원본", aspect, originalHeight = true, scale = androidx.compose.ui.layout.ContentScale.Fit)
    } }
}
private fun reactionName(type: String) = when(type) { "LIKE" -> "좋아요"; "HELPFUL" -> "도움돼요"; "CHEER" -> "응원해요"; "EMPATHY" -> "공감해요"; else -> "확인했어요" }
