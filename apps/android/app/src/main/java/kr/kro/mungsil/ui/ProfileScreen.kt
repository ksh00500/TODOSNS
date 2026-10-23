package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.progressSemantics
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import kr.kro.mungsil.BuildConfig
import kr.kro.mungsil.data.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable fun ProfileScreen(api: Api, revision: Int, changed: () -> Unit, navigate: (String) -> Unit) {
    val factory = remember(api) { object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = ProfileModel(ProfileRepository(api)) as T
    } }
    val model: ProfileModel = viewModel(factory = factory)
    // Capture the immutable value before LazyListScope caches its item intervals.
    val state = model.state.collectAsStateWithLifecycle().value
    LaunchedEffect(revision) { model.load() }
    var editing by rememberSaveable { mutableStateOf(false) }
    var badgeId by rememberSaveable { mutableStateOf<String?>(null) }
    val profile = state.profile.data
    val badges = profile?.let { profileBadges(it, state.groups.data?.size) }.orEmpty()
    val columns = if(LocalDensity.current.fontScale >= 1.6f) 1 else 2
    val previewColumns = if(LocalConfiguration.current.screenWidthDp <= 370) 1 else columns
    PageList {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("마이", Modifier.weight(1f), style = MaterialTheme.typography.headlineMedium)
            ActionIcon("프로필 편집", Icons.Rounded.Edit, profile != null) { editing = true }
            ActionIcon("설정", Icons.Rounded.Settings) { navigate("settings") }
        } }
        if(state.profile.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if(state.profile.error != null) item { ErrorNotice(state.profile.error, model::load) }
        if(profile == null) item { HistoryEntry(navigate) }
        if(profile != null) {
            item { Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.padding(top = 8.dp, bottom = 8.dp).size(96.dp), contentAlignment = Alignment.Center) {
                    Surface(color = Color.White, shape = CircleShape, border = BorderStroke(4.dp, Aqua), shadowElevation = 4.dp) {
                        Box(Modifier.size(96.dp).padding(8.dp).clip(CircleShape).background(Color(0xFFFFDCE4)), contentAlignment = Alignment.Center) {
                            if(profile.avatar.isNotBlank()) Photo(profile.avatar, "내 프로필 사진", Modifier.fillMaxSize(), scale = androidx.compose.ui.layout.ContentScale.Crop)
                            else Text(profile.nickname.take(1), Modifier.clearAndSetSemantics {}, style = MaterialTheme.typography.headlineMedium)
                        }
                    }
                    CloudMark(Modifier.align(Alignment.BottomEnd).size(35.dp, 24.dp))
                }
                Text(profile.nickname, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
                Text("@${profile.handle}", color = Muted)
                Text(profile.bio.ifBlank { "작은 실천을 오래 이어가는 중이에요." }, textAlign = TextAlign.Center, color = Muted)
                Row(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ProfileNumber("게시물", profile.posts, Modifier.weight(1f)) { navigate("profile/${profile.handle}") }
                    ProfileNumber("팔로워", profile.followers, Modifier.weight(1f)) { navigate("connections/${profile.id}/followers") }
                    ProfileNumber("팔로잉", profile.following, Modifier.weight(1f)) { navigate("connections/${profile.id}/following") }
                }
            } }
            item { val growth = profileGrowth(profile.power)
                Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, Color(0xFFDDD3FF)), shape = RoundedCornerShape(20.dp), shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "등급 상세 보기") { navigate("rank") }) {
                    Row(Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        if(columns > 1) CloudMark(Modifier.size(48.dp, 32.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("나의 뭉실 등급", color = Brand, style = MaterialTheme.typography.labelMedium)
                            if(columns == 1) { Text(profile.rank, style = MaterialTheme.typography.titleMedium); Text("${profile.power} 뭉실", color = Brand) }
                            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(profile.rank, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                                Text("${profile.power} 뭉실", color = Brand, style = MaterialTheme.typography.labelMedium)
                            }
                            Box(Modifier.fillMaxWidth().height(7.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).progressSemantics(growth.progress)) {
                                Box(Modifier.fillMaxHeight().fillMaxWidth(growth.progress).clip(CircleShape).background(Brand))
                            }
                            Text(if(growth.next == null) "가장 높은 구름에 도착했어요" else "다음 구름까지 ${growth.remaining} 뭉실", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Rounded.ChevronRight, null, Modifier.size(18.dp), tint = Muted)
                    }
                }
            }
            item { val stats = listOf("완료한 실천" to profile.completed, "받은 응원" to profile.cheers, "가져간 실천" to profile.copies)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { stats.chunked(if(columns == 1) 1 else 3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEach { (label, count) ->
                        Box(Modifier.weight(1f)) { CloudCard(inset = 10.dp) {
                            val tone = when(label) { "받은 응원" -> Color(0xFFFFDCE4); else -> Aqua }
                            Surface(color = tone, shape = RoundedCornerShape(13.dp)) { Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) { Icon(when(label) { "완료한 실천" -> Icons.Rounded.LocalFireDepartment; "받은 응원" -> Icons.Rounded.FavoriteBorder; else -> Icons.Rounded.ContentCopy }, null, Modifier.size(22.dp), tint = Ink) } }
                            Text(label, color = Muted, style = MaterialTheme.typography.bodySmall); Text(count.toString(), style = MaterialTheme.typography.titleMedium)
                        } }
                    } }
                } }
            }
            item { HistoryEntry(navigate) }
            item { ProfileSectionHeading("나의 TODO 그룹", state.groups.data?.let { "${it.size}개의 그룹" }) { TextButton({ navigate("groups") }) { Text("그룹 관리") } } }
            if(state.groups.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if(state.groups.error != null) item { ErrorNotice(state.groups.error, model::retryGroups) }
            if(state.groups.data?.isEmpty() == true) item { EmptyState("아직 만든 TODO 그룹이 없어요.", "여러 TODO를 나만의 그룹으로 묶어보세요.") }
            items(state.groups.data.orEmpty().take(3).chunked(previewColumns), key = { "profile-group-${it.first().id}" }) { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { row.forEach { group ->
                Surface(color = Aqua, shape = RoundedCornerShape(18.dp), modifier = Modifier.weight(1f)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${group.items}개의 TODO", color = Muted)
                        Text(group.title, style = MaterialTheme.typography.titleMedium)
                        Text(group.description.ifBlank { "꾸준히 이어가는 나만의 루틴" })
                        Text("${group.copies}명이 가져감", color = Muted)
                    }
                }
                }; if(row.size < previewColumns) Spacer(Modifier.weight(1f)) }
            }
            item { ProfileSectionHeading("게시한 실천", state.posts.data?.let { "${it.size}개의 최근 기록" }) {} }
            if(state.posts.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if(state.posts.error != null) item { ErrorNotice(state.posts.error, model::retryPosts) }
            if(state.posts.data?.isEmpty() == true) item { EmptyState("아직 게시한 실천이 없어요.", "완료한 TODO를 게시하면 이곳에 기록돼요.") }
            items(state.posts.data.orEmpty().chunked(previewColumns), key = { "profile-posts-${it.first().id}" }) { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { post -> Surface(shape = RoundedCornerShape(18.dp), modifier = Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = "게시물 상세 보기") { navigate("post/${post.id}") }) {
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if(post.image.isNotBlank()) Photo(post.image, "게시한 실천 사진", Modifier.fillMaxWidth().aspectRatio(180f / 116f).clip(RoundedCornerShape(13.dp)))
                            else Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(13.dp)) { Box(Modifier.fillMaxWidth().aspectRatio(180f / 116f), contentAlignment = Alignment.Center) { CloudMark() } }
                            Text(post.title.ifBlank { "실천 기록" }, fontWeight = FontWeight.Bold)
                            Text("${post.cheers}개의 응원", color = Muted)
                        }
                    } }
                    if(row.size < previewColumns) Spacer(Modifier.weight(1f))
                }
            }
            item { ProfileSectionHeading("나의 배지", "실천으로 얻은 기록") {} }
            items(badges.chunked(if(columns == 1) 1 else 3), key = { "profile-badges-${it.first().id}" }) { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEach { badge ->
                    val status = when(badge.unlocked) { true -> "획득"; false -> "도전 중"; null -> if(state.groups.loading) "확인 중" else "확인 필요" }
                    Surface(color = if(badge.unlocked == true) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(18.dp), modifier = Modifier.weight(1f).heightIn(min = 60.dp).clickable(role = Role.Button) { badgeId = badge.id }.semantics { contentDescription = "${badge.title} 배지 상세 보기, $status" }) {
                        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(if(badge.challengeId != null || badge.id == "routine-maker") Icons.Rounded.EmojiEvents else Icons.Rounded.WorkspacePremium, null, tint = Brand)
                            Text(badge.title, textAlign = TextAlign.Center, fontWeight = FontWeight.Bold)
                            Text(status, color = Muted)
                        }
                    }
                }; repeat((if(columns == 1) 1 else 3) - row.size) { Spacer(Modifier.weight(1f)) } }
            }
            item { TextButton({ navigate("blocks") }) { Text("차단한 사용자") }; TextButton(model::load) { Text("새로고침") } }
        }
    }
    badges.firstOrNull { it.id == badgeId }?.let { badge -> NativeSheet("배지 이야기", { badgeId = null }) {
        Text(when(badge.unlocked) { true -> "내가 얻은 배지"; false -> "아직 도전 중인 배지"; null -> "그룹 기록을 확인한 뒤 획득 여부를 알려드릴게요." })
        Text(badge.title, style = MaterialTheme.typography.titleLarge)
        Text(badge.description); Text("만든 곳 · ${badge.issuer}")
        Text("${if(badge.unlocked == true) "획득 기록" else "획득 조건"} · ${badge.condition}")
        badge.challengeId?.let { id -> Text("관련 챌린지 · ${badge.challengeTitle}"); TextButton({ badgeId = null; navigate("challenge/$id") }) { Text("챌린지 내용 보기") } }
    } }
    if(editing && profile != null) {
        var nickname by rememberSaveable { mutableStateOf(profile.nickname) }
        var bio by rememberSaveable { mutableStateOf(profile.bio) }
        var interests by rememberSaveable { mutableStateOf(profile.interests) }
        var photo by rememberSaveable { mutableStateOf<String?>(null) }
        var photoPending by remember { mutableStateOf(false) }
        val action = rememberAction()
        val payload = json("nickname" to nickname.trim(), "bio" to bio, "interests" to interests).apply { photo?.let { addProperty("avatarMediaId", it) } }
        val key = remember(payload.toString()) { newKey() }
        NativeSheet("프로필 편집", { editing = false }, !action.busy, dirty = nickname != profile.nickname || bio != profile.bio || interests != profile.interests || photo != null || photoPending) {
            Field("닉네임", nickname, { nickname = it }, 20)
            Field("소개", bio, { bio = it }, 160, multiline = true)
            Text("관심사"); InterestChoices(interests) { interests = it }
            PhotoPicker(api, photo, { photo = it }, !action.busy, { photoPending = it })
            ActionFeedback(action)
            Primary("저장", nickname.trim().length >= 2 && !action.busy && !photoPending) { action.run { api.request("me", "PATCH", payload, key = key); changed(); editing = false } }
        }
    }

}

@Composable private fun HistoryEntry(navigate: (String) -> Unit) {
    CloudCard {
        Text("실천 기록", style = MaterialTheme.typography.titleMedium)
        Text("완료한 날짜별로 나의 실천을 확인해요.", color = Muted)
        Primary("완료 기록 보기") { navigate("history") }
    }
}

@Composable private fun ProfileNumber(label: String, count: Int, modifier: Modifier, open: () -> Unit) {
    Surface(color = Color.White, shape = RoundedCornerShape(14.dp), shadowElevation = 2.dp, modifier = modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = open)) {
    Column(Modifier.padding(horizontal = 8.dp, vertical = 15.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(count.toString(), style = MaterialTheme.typography.titleMedium); Text(label, textAlign = TextAlign.Center, color = Muted)
    } }
}
@Composable private fun ProfileSectionHeading(title: String, subtitle: String?, action: @Composable () -> Unit) {
    if(LocalDensity.current.fontScale >= 1.6f) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge); subtitle?.let { Text(it, color = Muted) }; action()
    } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(title, style = MaterialTheme.typography.titleLarge); subtitle?.let { Text(it, color = Muted) } }
        action()
    }
}

@Composable fun PublicProfileScreen(api: Api, handle: String, auth: Boolean, me: JsonObject, revision: Int, changed: () -> Unit, navigate: (String) -> Unit, login: () -> Unit) {
    val model: PublicProfileModel = viewModel(key = "public-profile-$handle-${me.text("id")}-$auth", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = PublicProfileModel(PublicProfileRepository(api)) as T
    })
    LaunchedEffect(handle, auth, me.text("id"), revision) { model.load(handle, auth, me.text("id")) }
    val state = model.state.collectAsStateWithLifecycle().value
    val person = state.person.data
    val relation = state.relation.data
    val posts = rememberPaged(api, "public/users/$handle/posts", auth, revision, enabled = person != null)
    val action = rememberAction()
    var block by rememberSaveable { mutableStateOf(false) }
    var report by rememberSaveable { mutableStateOf(false) }
    val followSubmission = rememberDraftSubmission(handle, "follow")
    val requestSubmission = rememberDraftSubmission(handle, "request")
    val largeFont = LocalDensity.current.fontScale >= 1.5f
    val zone = runCatching { java.time.ZoneId.of(me.text("timezone", "Asia/Seoul")) }.getOrDefault(java.time.ZoneId.of("Asia/Seoul"))
    PageList {
        if(state.person.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if(state.person.error != null) item { ErrorNotice(state.person.error) { model.load(handle, auth, me.text("id")) } }
        if(person != null) {
            item { CloudCard(20.dp) {
                Surface(Modifier.size(82.dp).align(Alignment.CenterHorizontally), color = Blush, shape = CircleShape) {
                    if(person.avatarUrl.isBlank()) Box(contentAlignment = Alignment.Center) { Text(person.nickname.take(1), style = MaterialTheme.typography.headlineMedium, color = Brand) }
                    else coil.compose.AsyncImage(person.avatarUrl, "${person.nickname}님의 프로필 사진", contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                }
                Text(person.nickname, Modifier.fillMaxWidth(), style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                Text("@${person.handle}", Modifier.fillMaxWidth(), color = Muted, textAlign = TextAlign.Center)
                Text(person.bio.ifBlank { "작은 실천을 오래 이어가는 중이에요." }, Modifier.fillMaxWidth(), color = Muted, textAlign = TextAlign.Center)
                if(largeFont) {
                    Text("게시물 ${person.posts}")
                    ProfileNumber("팔로워", relation?.followers ?: person.followers, Modifier.fillMaxWidth()) { if(auth) navigate("connections/${person.id}/followers") else login() }
                    ProfileNumber("팔로잉", relation?.followingCount ?: person.following, Modifier.fillMaxWidth()) { if(auth) navigate("connections/${person.id}/following") else login() }
                } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f).padding(vertical = 15.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(person.posts.toString(), style = MaterialTheme.typography.titleLarge); Text("게시물", color = Muted) }
                    ProfileNumber("팔로워", relation?.followers ?: person.followers, Modifier.weight(1f)) { if(auth) navigate("connections/${person.id}/followers") else login() }
                    ProfileNumber("팔로잉", relation?.followingCount ?: person.following, Modifier.weight(1f)) { if(auth) navigate("connections/${person.id}/following") else login() }
                }
                if(person.id != me.text("id")) {
                    if(state.relation.loading) Text("관계를 확인하고 있어요.", color = Muted)
                    ErrorNotice(state.relation.error, model::retryRelation)
                    if(relation?.blocked == true) Text("이 관계에서는 팔로우와 메시지를 사용할 수 없어요.", color = Muted)
                    val allowed = !auth || relation != null && !relation.blocked
                    val follow: () -> Unit = { if(!auth) login() else action.run {
                        val payload = json("userId" to person.id)
                        val response = api.request("social/follow", "POST", payload, key = followSubmission.keyFor(payload)).obj()
                        if(response.get("following")?.isJsonPrimitive != true || response.text("following") !in listOf("true", "false")) throw ApiException(502, "팔로우 결과를 확인하지 못했어요. 다시 확인해주세요.")
                        followSubmission.succeeded(); changed(); model.load(handle, auth, me.text("id"))
                    }; Unit }
                    val message: () -> Unit = { if(!auth) login() else action.run {
                        val payload = json("receiverId" to person.id)
                        val response = api.request("messages/requests", "POST", payload, key = requestSubmission.keyFor(payload)).obj()
                        when(response.text("kind")) {
                            "CONVERSATION" -> { if(response.text("conversationId").isBlank()) throw ApiException(502, "대화 정보를 확인하지 못했어요. 다시 시도해주세요."); requestSubmission.succeeded(); navigate("chat/direct/${response.text("conversationId")}") }
                            "REQUEST" -> { requestSubmission.succeeded(); action.notice = "메시지 요청을 보냈어요. 상대방이 수락하면 대화를 시작할 수 있어요." }
                            else -> throw ApiException(502, "대화 요청 결과를 확인하지 못했어요. 다시 시도해주세요.")
                        }
                    }; Unit }
                    if(largeFont) {
                        Primary(if(relation?.following == true) "팔로잉" else "팔로우", allowed && !action.busy, follow)
                        OutlinedButton(message, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = allowed && !action.busy) { Text("메시지") }
                    } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(follow, Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "팔로우 상태 변경" }, enabled = allowed && !action.busy) { Text(if(relation?.following == true) "팔로잉" else "팔로우") }
                        OutlinedButton(message, Modifier.weight(1f).heightIn(min = 48.dp), enabled = allowed && !action.busy) { Text("메시지") }
                    }
                    if(auth) Row { TextButton({ report = true }, enabled = !action.busy) { Text("신고") }; TextButton({ block = true }, enabled = !action.busy) { Text("차단") } }
                    ActionFeedback(action)
                } else TextButton({ navigate("me") }) { Text("내 프로필 관리") }
            } }
            item { Surface(color = Lavender, shape = MaterialTheme.shapes.medium) { Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("뭉실 등급", color = Muted); Text(person.rank, style = MaterialTheme.typography.titleLarge); Text("${person.power} 뭉실을 차곡차곡 쌓았어요.")
            } } }
            item { Heading("게시한 실천"); Text("${person.posts}개의 기록", color = Muted) }
            items(posts.rows, key = { it.text("id") }) { InteractiveFeedCard(api, it, auth, zone, navigate, login) }
            item {
                if(posts.loaded && posts.rows.isEmpty() && posts.error == null) EmptyState("아직 게시한 실천이 없어요", "첫 실천이 올라오면 이곳에서 볼 수 있어요.")
                else PageStatus(posts)
            }
        }
    }
    if(block && person != null) ConfirmSheet("이 사용자를 차단할까요?", "서로 팔로우가 해제되고 대화의 새 전송이 제한돼요. 기존 대화 기록은 유지돼요.", "차단", { block = false }) { api.request("social/block", "POST", json("userId" to person.id)); changed(); navigate("") }
    if(report && person != null) ReportSheet(api, "USER", person.id, { report = false })
}

@Composable fun BlocksScreen(api: Api, revision: Int, changed: () -> Unit) {
    val page = rememberPaged(api, "social/blocks", true, revision)
    var selected by rememberJsonState()
    PageList {
        item { Heading("차단한 사용자", "내가 차단한 사용자만 표시돼요.") }
        items(page.rows, key = { it.text("userId") }) { block -> CloudCard {
            Text(block.child("user").text("nickname", "탈퇴 또는 접근할 수 없는 사용자"))
            TextButton({ selected = block }) { Text("차단 해제") }
        } }
        item { PageStatus(page) }
    }
    selected?.let { block -> ConfirmSheet("차단을 해제할까요?", "팔로우 관계는 자동으로 복원되지 않으며 대화 기록은 유지돼요.", "차단 해제", { selected = null }) { api.request("social/blocks/${block.text("userId")}", "DELETE"); changed() } }
}

fun notificationRoute(item: JsonObject): String? {
    val href = item.text("href")
    return when {
        Regex("^/posts/[^/]+$").matches(href) -> "post/${href.substringAfterLast('/')}"
        Regex("^/messages/[^/]+$").matches(href) -> "chat/direct/${href.substringAfterLast('/')}"
        href == "/messages" -> "inbox"
        Regex("^/challenges/[^/]+/chat$").matches(href) -> "chat/challenge/${href.split('/')[2]}"
        Regex("^/challenges/[^/]+$").matches(href) -> "challenge/${href.substringAfterLast('/')}"
        Regex("^/(users|people)/[^/]+$").matches(href) -> "profile/${href.substringAfterLast('/')}"
        else -> null
    }
}
@Composable fun NotificationsScreen(api: Api, revision: Int, changed: () -> Unit, navigate: (String) -> Unit) {
    val page = rememberPaged(api, "me/notifications", true, revision)
    val action = rememberAction()
    PageList {
        item { Heading("나에게 온 소식", "열어보기 전까지 읽지 않은 상태로 남아요.") }
        item { TextButton({ action.run { api.request("me/notifications/read", "POST"); changed() } }, enabled = !action.busy) { Text("모두 읽음") }; ActionFeedback(action) }
        items(page.rows, key = { it.text("id") }) { notification -> CloudCard {
            Text("${if(notification.text("readAt").isBlank()) "새 소식 · " else ""}${notification.text("title")}", fontWeight = FontWeight.Bold)
            Text(notification.text("body")); Text(displayTime(notification.text("createdAt")), color = Muted)
            TextButton({ action.run { api.request("me/notifications/${notification.text("id")}/read", "POST"); changed(); notificationRoute(notification)?.let(navigate) } }, enabled = !action.busy) { Text(if(notificationRoute(notification) == null) "읽음 표시" else "내용 보기") }
        } }
        item { PageStatus(page) }
    }
}

@Composable fun SettingsScreen(api: Api, signedOut: () -> Unit, navigate: (String) -> Unit = {}) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val action = rememberAction()
    var deleting by remember { mutableStateOf(false) }
    var logoutAll by remember { mutableStateOf(false) }
    PageList {
        item { Heading("설정", "뭉실 ${BuildConfig.VERSION_NAME}") }
        item { PushSettings(api) }
        item { CloudCard {
            TextButton({ navigate("legal/privacy") }) { Text("개인정보 처리방침") }
            TextButton({ navigate("legal/terms") }) { Text("이용약관") }
        } }
        item { ActionFeedback(action) }
        item { OutlinedButton({ action.run { api.logout(); clearGoogleCredential(context); signedOut() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !action.busy) { Text("이 기기에서 로그아웃") } }
        item { TextButton({ logoutAll = true }, enabled = !action.busy) { Text("모든 기기에서 로그아웃") } }
        item { TextButton({ deleting = true }, enabled = !action.busy) { Text("계정 탈퇴", color = MaterialTheme.colorScheme.error) } }
    }
    if(logoutAll) ConfirmSheet("모든 기기의 연결을 종료할까요?", "다른 기기에서도 다시 로그인해야 해요.", "모두 로그아웃", { logoutAll = false }) { api.request("auth/logout-all", "POST"); api.clear(); clearGoogleCredential(context); signedOut() }
    if(deleting) ConfirmSheet("정말 탈퇴할까요?", "확정 즉시 로그인할 수 없고 TODO, 게시 기록과 뭉실 등급의 삭제가 시작돼요. 이 작업은 되돌릴 수 없어요.", "탈퇴 확정 및 삭제 시작", { deleting = false }) { api.request("auth/delete-account", "POST"); api.clear(); clearGoogleCredential(context); signedOut() }
}
