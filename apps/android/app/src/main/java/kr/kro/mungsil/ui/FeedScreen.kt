@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.google.gson.*
import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import java.time.*

class PagedState(private val api: Api, private val path: String, private val auth: Boolean, private val params: Map<String, String>, private val scope: CoroutineScope) {
    var rows by mutableStateOf<List<JsonObject>>(emptyList()); private set
    var cursor by mutableStateOf<String?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var loading by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    private var lastMore = false
    private var job: Job? = null
    fun cancel() { job?.cancel() }
    fun retry() = load(lastMore)
    fun load(more: Boolean = false) {
        if(loading || (more && cursor == null)) return
        loading = true; error = null; lastMore = more
        job = scope.launch {
            try {
                val response = api.request(path, query = params + mapOf("limit" to "20") + (if(more) mapOf("cursor" to cursor!!) else emptyMap()), authenticated = auth)
                if(!response.isJsonObject || response.asJsonObject.get("items")?.isJsonArray != true) throw ApiException(502, "목록 응답을 확인하지 못했어요. 다시 불러와주세요.")
                val page = response.asJsonObject
                rows = if(more) mergeRows(rows, page.list("items")) else page.list("items")
                cursor = page.text("nextCursor").ifBlank { null }; loaded = true
            } catch(e: CancellationException) { throw e } catch(e: Exception) { error = friendlyError(e) } finally { loading = false }
        }
    }
}
data class PageSnapshot(val rows: List<JsonObject>, val cursor: String?, val error: String?, val loading: Boolean, val loaded: Boolean, private val source: PagedState) {
    fun load(more: Boolean = false) = source.load(more)
    fun retry() = source.retry()
}
@Composable fun rememberPaged(api: Api, path: String, auth: Boolean, revision: Int, params: Map<String, String> = emptyMap(), enabled: Boolean = true): PageSnapshot {
    val scope = rememberCoroutineScope()
    val page = remember(api, path, auth, revision, params, enabled) { PagedState(api, path, auth, params, scope) }
    LaunchedEffect(page) { if(enabled) page.load() }
    DisposableEffect(page) { onDispose { page.cancel() } }
    // Immutable snapshots invalidate cached LazyListScope content on response arrival.
    return PageSnapshot(page.rows, page.cursor, page.error, page.loading, page.loaded, page)
}
@Composable fun PageStatus(page: PageSnapshot) {
    if(page.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    ErrorNotice(page.error) { page.retry() }
    if(!page.loading && page.error == null && page.cursor != null) OutlinedButton({ page.load(true) }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("더 보기") }
    if(page.loaded && page.error == null && page.rows.isEmpty()) Text("아직 기록이 없어요.", color = Muted)
}

@Composable fun Photo(url: String, label: String, modifier: Modifier = Modifier, originalHeight: Boolean = false, scale: ContentScale = ContentScale.FillWidth) {
    var failed by remember(url) { mutableStateOf(false) }
    var attempt by remember(url) { mutableIntStateOf(0) }
    if(failed) ErrorNotice("사진을 불러오지 못했어요.") { attempt++; failed = false }
    else key(url, attempt) { AsyncImage(ImageRequest.Builder(LocalContext.current).data(url).diskCachePolicy(CachePolicy.DISABLED).build(), label,
        modifier.fillMaxWidth().then(if(originalHeight) Modifier else Modifier.heightIn(max = 420.dp)), contentScale = scale, onError = { failed = true }) }
}
@Composable fun PhotoPicker(api: Api, mediaId: String?, changed: (String?) -> Unit, enabled: Boolean = true, pending: (Boolean) -> Unit = {}, excluded: () -> Unit = {}, draft: PhotoDraft = rememberPhotoDraft()) {
    val context = LocalContext.current
    val action = rememberAction()
    val selected = draft.selectedUri?.let(Uri::parse)
    var attempt by remember { mutableIntStateOf(0) }
    var progress by remember { mutableFloatStateOf(0f) }
    val progressScope = rememberCoroutineScope()
    val onChanged by rememberUpdatedState(changed)
    val onPending by rememberUpdatedState(pending)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if(uri != null) { draft.selectedUri = uri.toString(); attempt++; onChanged(null); onPending(true) } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if(success) draft.cameraUri?.let { draft.selectedUri = it; attempt++; onChanged(null); onPending(true) }
    }
    selected?.let { Photo(it.toString(), "선택한 사진") }
    if(mediaId != null) Text("사진 첨부 완료", color = Brand)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton({ picker.launch("image/*") }, enabled = enabled && !action.busy) { Text(if(selected == null) "사진 선택" else "사진 변경") }
        OutlinedButton({ action.run {
            val directory = java.io.File(context.cacheDir, "camera").apply { mkdirs() }
            val file = java.io.File.createTempFile("capture-", ".jpg", directory)
            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
            draft.cameraUri = uri.toString(); camera.launch(uri)
        } }, enabled = enabled && !action.busy) { Text("촬영") }
        if(selected != null || mediaId != null) TextButton({ draft.selectedUri = null; action.clearFeedback(); onChanged(null); onPending(false); excluded() }, enabled = enabled && !action.busy) { Text("사진 제외") }
    }
    LaunchedEffect(draft.selectedUri, attempt) {
        if(mediaId != null) { onPending(false); return@LaunchedEffect }
        val uri = selected ?: return@LaunchedEffect
        onChanged(null); onPending(true); progress = 0f
        action.run {
            val (bytes, mime) = withContext(Dispatchers.IO) {
                val mime = context.contentResolver.getType(uri) ?: ""
                if(mime !in listOf("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")) throw ApiException(400, "JPG, PNG, WebP, HEIC 사진을 선택해주세요.")
                val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while(true) { val read = input.read(buffer); if(read < 0) break; if(out.size() + read > 10_000_000) throw ApiException(400, "사진은 10MB 이하로 선택해주세요."); out.write(buffer, 0, read) }; out.toByteArray()
                } ?: throw ApiException(400, "사진을 읽지 못했어요. 다시 선택해주세요.")
                bytes to mime
            }
            onChanged(api.upload(bytes, mime) { value -> progressScope.launch { progress = value } }); onPending(false)
        }
    }
    ActionFeedback(action)
    if(action.busy) Text("사진 업로드 ${(progress * 100).toInt()}%", color = Muted)
    if(action.error != null && selected != null) TextButton({ attempt++ }, enabled = enabled && !action.busy) { Text("사진 업로드 다시 시도") }
}

@Composable fun FeedScreen(api: Api, authenticated: Boolean, revision: Int, navigate: (String) -> Unit, login: () -> Unit = {}, zone: ZoneId = ZoneId.of("Asia/Seoul")) {
    val owner = LocalTodoDraftOwner.current
    key(owner,authenticated,api.sessionVersion) { FeedScreenContent(api,authenticated,revision,navigate,login,zone) }
}
@Composable private fun FeedScreenContent(api: Api, authenticated: Boolean, revision: Int, navigate: (String) -> Unit, login: () -> Unit, zone: ZoneId) {
    var category by rememberSaveable { mutableStateOf("전체") }
    var mode by rememberSaveable { mutableStateOf("recent") }
    var filter by remember { mutableStateOf(false) }
    val page = rememberPaged(api, if(authenticated) "feed" else "public/feed", authenticated, revision, mapOf("category" to category, "mode" to mode))
    PageList {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("좋은 실천을 가볍게 둘러보세요", color = Muted, style = MaterialTheme.typography.bodySmall); Heading("탐색") }
            ActionIcon("피드 필터", Icons.Rounded.Tune) { filter = true }
            ActionIcon("실천 · 사람 · 해시태그 검색", Icons.Rounded.Search) { navigate("search") }
        } }
        if(category != "전체" || mode != "recent") item { Text("$category · ${if(mode == "mix") "추천" else "최신"}", color = Muted); TextButton({ category = "전체"; mode = "recent" }) { Text("필터 초기화") } }
        items(page.rows, key = { it.text("id") }) { post -> InteractiveFeedCard(api, post, authenticated, zone, navigate, login) }
        item { PageStatus(page) }
        item { TextButton({ page.load() }) { Text("새로고침") } }
    }
    if(filter) {
        var draftCategory by remember { mutableStateOf(category) }
        var draftMode by remember { mutableStateOf(mode) }
        NativeSheet("피드 필터", { filter = false }) {
            Choices("카테고리", (listOf("전체") + baseCategories).map { it to it }, draftCategory, { draftCategory = it })
            Choices("정렬", listOf("recent" to "최신순", "mix" to "추천순"), draftMode, { draftMode = it })
            TextButton({ draftCategory = "전체"; draftMode = "recent" }) { Text("필터 초기화") }
            Primary("실천 보기") {
                filter = false
                if(draftMode == "mix" && !authenticated) login() else { category = draftCategory; mode = draftMode }
            }
        }
    }
}

@Composable fun InteractiveFeedCard(api: Api, post: JsonObject, auth: Boolean, zone: ZoneId, navigate: (String) -> Unit, login: () -> Unit) {
    val owner = LocalTodoDraftOwner.current
    key(owner,api.sessionVersion,post.text("id")) { InteractiveFeedCardContent(api,post,auth,zone,navigate,login) }
}
@Composable private fun InteractiveFeedCardContent(api: Api, post: JsonObject, auth: Boolean, zone: ZoneId, navigate: (String) -> Unit, login: () -> Unit) {
    var importing by rememberSaveable { mutableStateOf(false) }
    val action = rememberAction()
    FeedCard(post, navigate, detail = true) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CheerControl(api,post,auth,login)
            TextButton({ navigate("post/${post.text("id")}") }, Modifier.heightIn(min = 48.dp)) { Text("댓글 ${post.number("commentCount")}") }
        }
        if(post.child("todoList").text("id").isNotBlank() || post.list("todos").firstOrNull()?.text("id")?.isNotBlank() == true) {
            Primary("나도 할래요") { if(auth) importing = true else login() }
        } else {
            Text("가져올 실천 정보를 확인하지 못했어요.", color = Muted)
            OutlinedButton({ navigate("post/${post.text("id")}") }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("원본 정보 확인") }
        }
        ActionFeedback(action)
    }
    if(importing) {
        val list = post.child("todoList")
        if(list.text("id").isNotBlank()) RoutineImportSheet(api, zone, list, { importing = false }) { action.notice = "루틴을 내 TODO로 가져왔어요." }
        else post.list("todos").firstOrNull()?.let { TodoForm(api, zone, it, LocalDate.now(zone).toString(), true, { importing = false }) { action.notice = "내 TODO로 가져왔어요." } }
    }
}

@Composable private fun CheerControl(api: Api, post: JsonObject, auth: Boolean, login: () -> Unit, changed: () -> Unit = {}) {
    val owner = LocalTodoDraftOwner.current
    val cheer = rememberCheerState(owner,post)
    val scope = rememberCoroutineScope()
    val session = remember(api,owner) { api.sessionVersion }
    val pending = cheer.submission
    Column {
        val label = if(pending.busy || cheer.inspecting) "응원 확인 중…" else if(pending.uncertain) "응원 결과 확인" else "${if(cheer.cheered) "♥ 응원 취소" else "♡ 응원"} ${cheer.count}"
        TextButton({
            if(!auth) login()
            else if(pending.uncertain) cheer.beginResolution()?.let { receipt -> scope.launch {
                try { val (value,count) = resolveCheer(api,post.text("id"),receipt,session); if(cheer.resolved(receipt,value,count)) changed() }
                catch(e: CancellationException) { cheer.inspectionFailed(e); throw e }
                catch(e: Exception) { cheer.inspectionFailed(e) }
            } }
            else cheer.begin()?.let { write -> scope.launch {
                try { val value = sendCheer(api,post.text("id"),write,session); if(cheer.succeeded(write,value)) changed() }
                catch(e: CancellationException) { cheer.failed(write,e); throw e }
                catch(e: Exception) { cheer.failed(write,e) }
            } }
        }, modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = label },
            enabled = !pending.busy && !cheer.inspecting && !pending.denied && (!auth || owner.isNotBlank())) { Text(label) }
        ErrorNotice(pending.error)
        if(pending.error != null) TextButton({ if(cheer.beginInspection()) scope.launch {
            try { val (value,count) = inspectCheer(api,post.text("id"),session); cheer.inspected(value,count); changed() }
            catch(e: CancellationException) { cheer.inspectionFailed(e); throw e }
            catch(e: Exception) { cheer.inspectionFailed(e) }
        } },enabled = !pending.busy && !cheer.inspecting) { Text(if(cheer.inspecting) "상태 조회 중…" else "현재 응원 상태 조회") }
        ErrorNotice(cheer.inspectionError)
    }
}

@Composable fun FeedCard(post: JsonObject, navigate: (String) -> Unit, detail: Boolean = false, actions: (@Composable () -> Unit)? = null) {
    val author = post.child("author")
    val title = post.child("todoList").text("title").ifBlank { post.list("todos").firstOrNull()?.text("title") ?: "오늘의 실천" }
    Surface(shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(Modifier.size(44.dp).clickable(role = Role.Button, onClickLabel = "${author.text("nickname")}님의 프로필") { navigate("profile/${author.text("handle")}") }, shape = CircleShape, color = Blush) {
                    if(author.text("avatarUrl").isNotBlank()) AsyncImage(author.text("avatarUrl"), "프로필 사진", contentScale = ContentScale.Crop)
                    else Box(contentAlignment = Alignment.Center) { Text(author.text("nickname", "구름").take(1), color = Brand) }
                }
                Column(Modifier.weight(1f).heightIn(min = 44.dp).clickable(role = Role.Button, onClickLabel = "${author.text("nickname")}님의 프로필") { navigate("profile/${author.text("handle")}") }, verticalArrangement = Arrangement.Center) {
                    Text(author.text("nickname", "사용자"), style = MaterialTheme.typography.labelLarge, color = Ink)
                    val created = runCatching { Instant.parse(post.text("createdAt")).atZone(ZoneId.of("Asia/Seoul")).format(java.time.format.DateTimeFormatter.ofPattern("M월 d일")) }.getOrDefault("")
                    Text("@${author.text("handle")} · $created", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if(author.text("cloudRank").isNotBlank()) Text(author.text("cloudRank"), color = Brand, style = MaterialTheme.typography.bodySmall)
                }
            }
            val photo = post.text("mediaUrl", post.text("thumbnailUrl"))
            if(photo.isNotBlank()) FeedPhoto(photo, title) { navigate("post/${post.text("id")}") }
            else Surface(color = Butter, shape = RoundedCornerShape(18.dp), modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = "$title 기록 보기") { navigate("post/${post.text("id")}") }) {
                // Text-only records grow with content and font scale, rather than
                // forcing a large title into a fixed photo-shaped placeholder.
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(if(post.child("todoList").text("id").isNotBlank()) "✓ ${post.child("todoList").list("items").size}개로 만든 루틴" else "✓ 오늘 완료한 TODO", color = Muted, style = MaterialTheme.typography.labelLarge)
                    Text(title, style = MaterialTheme.typography.headlineMedium, color = Ink)
                }
            }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if(photo.isNotBlank()) Text(title, style = MaterialTheme.typography.titleLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    post.list("todos").firstOrNull()?.text("category")?.takeIf(String::isNotBlank)?.let { category ->
                        Surface(color = Sky, shape = MaterialTheme.shapes.small) { Text(category, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = Brand) }
                    }
                    Text(if(post.child("todoList").text("id").isNotBlank()) "루틴" else if(post.list("todos").isNotEmpty()) "단일 TODO" else "실천 기록", style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                if(post.text("caption").isNotBlank()) Text(post.text("caption"))
                if(post.strings("hashtags").isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { post.strings("hashtags").forEach { tag -> TextButton({ navigate("search?query=${Uri.encode("#$tag")}") }, modifier = Modifier.heightIn(min = 48.dp), shape = MaterialTheme.shapes.small, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp), colors = ButtonDefaults.textButtonColors(containerColor = Sky)) { Text("#$tag") } } }
                if(post.number("copyCount") > 0) Text("✓ ${post.number("copyCount")}명이 자신의 하루에 담았어요", color = Color(0xFF2F6B66), style = MaterialTheme.typography.bodySmall)
                actions?.invoke()
                if(!detail) OutlinedButton({ navigate("post/${post.text("id")}") }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("기록 보기") }
            }
        }
    }
}

@Composable fun PostScreen(api: Api, id: String, auth: Boolean, user: JsonObject, zone: ZoneId, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, login: () -> Unit) {
    val owner = if(auth) user.text("id") else ""
    key(owner,api.sessionVersion,id) { CompositionLocalProvider(LocalTodoDraftOwner provides owner) {
        PostScreenContent(api,id,auth,user,zone,revision,changed,navigate,login)
    } }
}
@Composable private fun PostScreenContent(api: Api, id: String, auth: Boolean, user: JsonObject, zone: ZoneId, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, login: () -> Unit) {
    val context = LocalContext.current
    val base = if(auth) "feed/posts/$id" else "public/posts/$id"
    val remote = rememberRemote(id, revision, auth) { api.request(base, authenticated = auth) }
    val comments = rememberPaged(api, "$base/comments", auth, revision)
    val post = remote.data?.obj()
    val action = rememberAction()
    val commentAction = rememberAction()
    var body by rememberSaveable(id) { mutableStateOf("") }
    var importing by rememberJsonState()
    var importList by rememberSaveable { mutableStateOf(false) }
    var report by remember { mutableStateOf<Pair<String, String>?>(null) }
    var remove by remember { mutableStateOf<Pair<String, String>?>(null) }
    val commentKey = rememberSaveable(body, id) { newKey() }
    PageList {
        remoteStatus(remote)
        if(post != null) {
            item { FeedCard(post, navigate, detail = true) }
            if(post.child("todoList").text("id").isNotBlank()) item { Primary("루틴 가져오기") { if(auth) importList = true else login() } }
            else items(post.list("todos"), key = { "copy/${it.text("id")}" }) { todo -> Primary("${todo.text("title")} · 나도 할래요") { if(auth) importing = todo else login() } }
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CheerControl(api,post,auth,login,changed)
                    TextButton({ context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(android.content.Intent.EXTRA_TEXT, "https://mungsil.kro.kr/posts/$id") }, "실천 공유")) }, Modifier.heightIn(min = 48.dp)) { Text("공유") }
                    if(auth) TextButton({ report = "POST" to id }, Modifier.heightIn(min = 48.dp)) { Text("신고") }
                    if(auth && post.child("author").text("id") == user.text("id")) TextButton({ remove = "feed/posts/$id" to "게시물" }, Modifier.heightIn(min = 48.dp)) { Text("게시물 삭제") }
                }
                ActionFeedback(action)
            }
            item { Heading("댓글", "짧은 응원이 큰 힘이 돼요.") }
            items(comments.rows, key = { "comment/${it.text("id")}" }) { comment -> CloudCard {
                Text(comment.child("author").text("nickname"), fontWeight = FontWeight.SemiBold)
                Text(comment.text("body"))
                if(auth) Row { TextButton({ report = "COMMENT" to comment.text("id") }) { Text("신고") }; if(comment.child("author").text("id") == user.text("id")) TextButton({ remove = "feed/comments/${comment.text("id")}" to "댓글" }) { Text("삭제") } }
            } }
            item { PageStatus(comments) }
            item {
                if(auth) {
                    Field("응원 댓글", body, { body = it }, 300, multiline = true, enabled = !commentAction.busy)
                    ActionFeedback(commentAction)
                    OutlinedButton({ commentAction.run { api.request("feed/posts/$id/comments", "POST", json("body" to body.trim()), key = commentKey); body = ""; changed() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !commentAction.busy && body.isNotBlank()) { Text("댓글 남기기") }
                } else OutlinedButton(login) { Text("로그인하고 응원하기") }
            }
        }
    }
    importing?.let { TodoForm(api, zone, it, LocalDate.now(zone).toString(), true, { importing = null }) { action.notice = "내 TODO로 가져왔어요."; changed() } }
    if(importList && post != null) RoutineImportSheet(api, zone, post.child("todoList"), { importList = false }) { changed(); action.notice = "루틴을 내 TODO로 가져왔어요." }
    report?.let { ReportSheet(api, it.first, it.second, { report = null }) }
    remove?.let { target -> ConfirmSheet("${target.second}을 삭제할까요?", "삭제하면 되돌릴 수 없어요.", "삭제", { remove = null }) { api.request(target.first, "DELETE"); changed(); if(target.second == "게시물") navigate("") } }
}

@Composable fun RoutineImportSheet(api: Api, zone: ZoneId, list: JsonObject, close: () -> Unit, saved: () -> Unit) {
    val owner = LocalTodoDraftOwner.current
    key(owner,list.text("id"),api.sessionVersion) { RoutineImportContent(api,zone,list,owner,close,saved) }
}
@Composable private fun RoutineImportContent(api: Api, zone: ZoneId, list: JsonObject, owner: String, close: () -> Unit, saved: () -> Unit) {
    val form = rememberRoutineImportState(owner,list,zone)
    val draft = form.draft
    val writeState = form.submission
    val scope = rememberCoroutineScope()
    val session = remember(api,owner) { api.sessionVersion }
    val preview = form.previewItems()
    NativeSheet("루틴 가져오기",close,!writeState.busy,dirty = form.dirty,
        discardDetail = if(writeState.uncertain) "이미 내 TODO로 저장됐을 수 있어요. 닫아도 저장은 취소되지 않아요. 그룹과 일정을 확인해주세요." else "가져오기 설정이 사라져요. 원본 루틴은 바뀌지 않아요.") {
        ImportSourceSummary(form.sourceTitle, routine = true, count = form.source.size)
        Field("루틴 이름",draft.title,{ value -> form.update { it.copy(title = value) } },100,enabled = form.editable)
        DateControl(draft.date,{ value -> form.update { it.copy(date = value) } },"시작 날짜",enabled = form.editable)
        TimeControl(draft.time,form.editable) { value -> form.update { it.copy(time = value) } }
        Text("시간대 · ${form.zoneId}",color = Muted)
        Choices("반복 정책",listOf("KEEP" to "원본 유지","NONE" to "반복 없음","CUSTOM" to "항목별 설정"),draft.mode,form.editable) { value -> form.update { it.copy(mode = value) } }
        if(draft.mode == "CUSTOM") {
            Text("모드를 바꿔도 항목별로 편집한 내용은 유지돼요.",color = Muted)
            TextButton(form::resetItems,enabled = form.editable) { Text("원본으로 초기화") }
        }
        Text("가져올 일정 미리보기", style = MaterialTheme.typography.titleMedium)
        Text("원본이 바뀌면 서버의 현재 내용을 기준으로 가져와요.", color = Muted, style = MaterialTheme.typography.bodySmall)
        if(preview == null) ErrorNotice("일정 미리보기를 확인하지 못했어요. 시작 날짜와 원본 일정을 확인해주세요.")
        (preview ?: draft.items).forEachIndexed { index, item ->
            HorizontalDivider()
            Text("${index + 1}. ${form.source.first { it.id == item.id }.title}",fontWeight = FontWeight.Bold)
            if(draft.mode == "CUSTOM") {
                Field("할 일",item.title,{ value -> form.updateItem(item.id) { it.copy(title = value) } },120,enabled = form.editable)
                DateControl(item.date,{ value -> form.updateItem(item.id) { it.copy(date = value) } },enabled = form.editable)
                TimeControl(item.time,form.editable) { value -> form.updateItem(item.id) { it.copy(time = value) } }
                Choices("반복",repeatChoices(item.repeatRule),item.repeatRule,form.editable) { value -> form.updateItem(item.id) { it.copy(repeatRule = value) } }
            } else if(preview != null) {
                Text("${item.date} · ${item.time}", color = Ink)
                Text("${item.category} · ${repeatLabel(item.repeatRule)}", color = Muted)
            }
        }
        if(form.source.isEmpty()) EmptyState("가져올 TODO가 없어요","원본 루틴의 항목을 다시 확인해주세요.")
        ErrorNotice(form.validation)
        ErrorNotice(writeState.error)
        if(owner.isBlank()) ErrorNotice("로그인 상태를 확인한 뒤 다시 열어주세요.")
        if(writeState.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Primary(if(writeState.busy) "가져오는 중…" else if(writeState.uncertain) "가져오기 결과 확인" else "내 TODO로 가져오기",
            !writeState.busy && !writeState.denied && owner.isNotBlank() && form.source.isNotEmpty()) {
            form.begin()?.let { write -> scope.launch {
                val completed = try { sendRoutineImport(api,form.id,form.owner,write,session); writeState.succeeded(write) }
                    catch(e: CancellationException) { writeState.failed(write,e); throw e }
                    catch(e: Exception) { writeState.failed(write,e); false }
                if(completed) { saved(); close() }
            } }
        }
    }
}

@Composable fun ReportSheet(api: Api, type: String, id: String, close: () -> Unit, reported: () -> Unit = close) {
    var reason by rememberSaveable(type, id) { mutableStateOf("") }
    val action = rememberAction()
    val submission = rememberDraftSubmission(type, id)
    val payload = json("targetType" to type, "targetId" to id, "reason" to reason.trim())
    NativeSheet("신고하기", close, !action.busy, dirty = reason.isNotBlank()) {
        Field("신고 사유", reason, { reason = it }, 500, multiline = true, hint = "3자 이상으로 상황을 알려주세요.", enabled = !action.busy)
        ActionFeedback(action)
        Primary("신고 접수", reason.trim().length >= 3 && !action.busy) { action.run { api.request("social/report", "POST", payload, key = submission.keyFor(payload)); submission.succeeded(); reported() } }
    }
}
