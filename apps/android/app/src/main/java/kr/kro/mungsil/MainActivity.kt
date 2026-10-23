package kr.kro.mungsil

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.*
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.Role
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.navigation.compose.*
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.*
import java.time.ZoneId
import kr.kro.mungsil.push.Push
import kr.kro.mungsil.push.SessionApi

class MainActivity : ComponentActivity() {
    private var pushNotification by mutableStateOf("")
    private var pushUser by mutableStateOf("")
    private var appLink by mutableStateOf<AppLink?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pushUser = intent.getStringExtra("pushUser").orEmpty(); pushNotification = intent.getStringExtra("pushNotification").orEmpty(); appLink = parseAppLink(intent.dataString)
        enableEdgeToEdge(SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        setContent { MungsilTheme { val model: AppModel = viewModel(); NativeApp(model.api, model.session, model.user, model.error, model::restore, model::signedIn, model::signedOut, pushUser, { pushUser = ""; pushNotification = ""; intent.removeExtra("pushUser"); intent.removeExtra("pushNotification") }, appLink, { appLink = null; intent.data = null }, pushNotification) } }
    }
    override fun onNewIntent(intent: android.content.Intent) { super.onNewIntent(intent); setIntent(intent); pushUser = intent.getStringExtra("pushUser").orEmpty(); pushNotification = intent.getStringExtra("pushNotification").orEmpty(); appLink = parseAppLink(intent.dataString) }
    override fun onResume() { super.onResume(); Push.sync(this) }
}

class AppModel(application: Application) : AndroidViewModel(application) {
    val api = SessionApi.get(application)
    var session by mutableIntStateOf(0); private set
    var user by mutableStateOf(JsonObject()); private set
    var error by mutableStateOf<String?>(null); private set
    init {
        api.onExpired = { viewModelScope.launch { signedOut() } }
        restore()
    }
    fun restore() {
        session = 0; error = null
        viewModelScope.launch {
            try { if(api.restore()) signedIn(api.request("auth/me").obj()) else signedOut() }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(e is ApiException && e.status == 401) signedOut() else error = friendlyError(e) }
        }
    }
    fun signedIn(value: JsonObject) { user = value; session = 2; error = null; Push.bind(getApplication(), value.text("id")) }
    fun signedOut() {
        user = JsonObject(); session = 1; error = null; Push.clear(getApplication())
        // Credential Manager state is cleared on explicit logout, not every guest startup.
    }
    override fun onCleared() { api.onExpired = null; super.onCleared() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun NativeApp(api: Api, session: Int, user: JsonObject, startupError: String?, restore: () -> Unit, signedIn: (JsonObject) -> Unit, signedOut: () -> Unit, pushUser: String = "", consumePush: () -> Unit = {}, appLink: AppLink? = null, consumeLink: () -> Unit = {}, pushNotification: String = "") {
    val labels = listOf("오늘", "탐색", "TODO", "챌린지", "마이")
    val roots = listOf("today", "explore", "todos", "challenges", "me")
    val icons = listOf(Icons.Rounded.Home, Icons.Rounded.Explore, Icons.Rounded.CalendarMonth, Icons.Rounded.EmojiEvents, Icons.Rounded.PersonOutline)
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val pattern = entry?.destination?.route ?: "today"
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var guest by rememberSaveable { mutableStateOf(false) }
    var loginRequested by rememberSaveable { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var pendingRoute by rememberSaveable { mutableStateOf<String?>(null) }
    var onboardingReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingPushId by rememberSaveable { mutableStateOf("") }
    var pendingPush by rememberSaveable { mutableStateOf("") }
    var emailLink by remember { mutableStateOf<AppLink?>(null) }
    var previousSession by remember { mutableIntStateOf(session) }
    LaunchedEffect(pattern) { roots.indexOf(when { pattern == "history" -> "me"; pattern.startsWith("schedule/") -> "todos"; else -> pattern }).takeIf { it >= 0 }?.let { tab = it } }
    val authenticated = session == 2
    val zone = remember(user.text("timezone")) { runCatching { ZoneId.of(user.text("timezone", "Asia/Seoul")) }.getOrDefault(ZoneId.of("Asia/Seoul")) }
    val changed: () -> Unit = { revision++ }
    val navigate: (String) -> Unit = { target -> if(target.isBlank()) nav.popBackStack() else nav.navigate(target) { launchSingleTop = true } }
    val requireLogin = { loginRequested = true; Unit }
    val finishLogin: (JsonObject) -> Unit = { value ->
        if(value.get("onboardingCompletedAt")?.isJsonNull == true) { onboardingReturn = pendingRoute; pendingRoute = "onboarding" }
        signedIn(value); loginRequested = false; guest = false
    }
    LaunchedEffect(appLink) {
        appLink?.let { link ->
            if(link.route in listOf("verify-email", "reset-password")) emailLink = link else { pendingRoute = link.route; guest = true }
            consumeLink()
        }
    }
    LaunchedEffect(pushUser) { if(pushUser.isNotBlank()) { pendingPush = pushUser; pendingPushId = pushNotification.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,100}")) }.orEmpty(); consumePush(); if(!authenticated) loginRequested = true } }
    LaunchedEffect(session, entry, pendingRoute, pendingPush) {
        if(session == 2) {
            loginRequested = false
            if(entry != null) {
                if(pendingPush.isNotEmpty()) { if(pendingPush == user.text("id")) navigate(if(pendingPushId.isNotBlank()) "push/$pendingPushId" else "notifications"); pendingPush = ""; pendingPushId = "" }
                pendingRoute?.let { navigate(it); pendingRoute = null }
            }
        } else if(session == 1 && previousSession == 2) {
            pendingRoute = null; pendingPush = ""; guest = false; loginRequested = true
            roots.forEach { nav.clearBackStack(it) }
            nav.navigate("today") { popUpTo(nav.graph.id) { inclusive = true }; launchSingleTop = true }
        } else if(session == 1 && guest && entry != null) {
            pendingRoute?.let { navigate(it); pendingRoute = null }
        }
        previousSession = session
    }
    val badge = if(authenticated) rememberRemote(revision, pattern) { api.request("me/notifications/unread-count") } else null
    val chatBadge = if(authenticated) rememberRemote(revision, pattern) { api.request("messages/unread-count") } else null
    BackHandler(emailLink != null || loginRequested) { if(emailLink != null) emailLink = null else loginRequested = false }
    CompositionLocalProvider(LocalTodoDraftOwner provides if(authenticated) user.text("id") else "") {
    Surface(Modifier.fillMaxSize(), color = Canvas) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Surface(Modifier.widthIn(max = 430.dp).fillMaxSize(), color = Cream) {
                when {
                    session == 0 -> Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Heading("뭉실", "나의 속도로, 오늘의 작은 실천")
                        if(startupError == null) LinearProgressIndicator(Modifier.fillMaxWidth()) else ErrorNotice(startupError, restore)
                    }
                    emailLink != null -> Column(Modifier.safeDrawingPadding().imePadding()) {
                        EmailLinkScreen(api, emailLink!!, finishLogin) { emailLink = null }
                    }
                    !authenticated && !guest && !loginRequested -> WelcomeScreen(requireLogin) { guest = true; pendingRoute = "explore" }
                    !authenticated && (!guest || loginRequested) -> AuthScreen(api, finishLogin, back = { loginRequested = false }) { guest = true; loginRequested = false; if(entry == null) pendingRoute = "explore" else if(pattern == "today") navigate("explore") }
                    else -> Scaffold(containerColor = Cream, topBar = {
                        CenterAlignedTopAppBar(title = { Text(if(pattern in roots) "뭉실" else routeTitle(pattern), color = if(pattern in roots) Brand else Ink) },
                            navigationIcon = { if(pattern !in roots) ActionIcon("뒤로", Icons.AutoMirrored.Rounded.ArrowBack) { nav.popBackStack() } else Box(Modifier.padding(start = 20.dp)) { CloudMark(Modifier.size(30.dp, 24.dp)) } },
                            actions = { if(authenticated) {
                                BadgedBox(badge = { val n = chatBadge?.data?.obj()?.number("count") ?: 0; if(n > 0) Badge { Text(n.coerceAtMost(99).toString()) } }) { ActionIcon("대화함", Icons.AutoMirrored.Rounded.Chat) { navigate("inbox") } }
                                BadgedBox(badge = { val n = badge?.data?.obj()?.number("count") ?: 0; if(n > 0) Badge { Text(n.coerceAtMost(99).toString()) } }) { ActionIcon("알림", Icons.Rounded.NotificationsNone) { navigate("notifications") } }
                            } else TextButton(requireLogin) { Text("로그인") } }, expandedHeight = 56.dp, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface))
                    }, bottomBar = { if(!pattern.startsWith("chat/") && pattern != "onboarding") Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(24.dp), shadowElevation = 8.dp, modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 12.dp, vertical = 8.dp)) {
                        // Large text needs wider tab cells; preserve all five names and targets.
                        val columns = if(LocalDensity.current.fontScale >= 1.6f) 3 else 5
                        Column(Modifier.fillMaxWidth().padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { roots.indices.toList().chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) { row.forEach { index ->
                            Surface(color = if(tab == index) Aqua else MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(18.dp), modifier = Modifier.weight(1f)) { Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(tab == index, role = Role.Tab, onClick = {
                            tab = index
                            nav.navigate(roots[index]) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }
                        }).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(icons[index], null, Modifier.size(22.dp), tint = if(tab == index) Brand else Muted); Text(labels[index], color = if(tab == index) Brand else Muted, style = MaterialTheme.typography.bodySmall) } }
                        } } } }
                    } }) { padding ->
                        NavHost(nav, startDestination = "today", modifier = Modifier.padding(padding).consumeWindowInsets(padding).imePadding()) {
                            val destinations = roots + listOf("push/{id}", "search?query={query}", "post/{id}", "challenge/{id}", "profile/{handle}", "chat/{kind}/{id}", "inbox", "notifications", "blocks", "settings", "categories", "groups", "rank", "onboarding", "connections/{id}/{direction}", "legal/{kind}", "schedule/{date}?zone={zone}", "history")
                            destinations.forEach { destination -> composable(destination, arguments = when {
                                destination.startsWith("search?") -> listOf(androidx.navigation.navArgument("query") { defaultValue = "" })
                                destination.startsWith("schedule/") -> listOf(androidx.navigation.navArgument("zone") { defaultValue = "" })
                                else -> emptyList()
                            }) { backStack ->
                                val id = backStack.arguments?.getString("id").orEmpty()
                                val public = destination in listOf("explore", "challenges", "push/{id}", "search?query={query}", "post/{id}", "challenge/{id}", "profile/{handle}", "legal/{kind}")
                                if(!authenticated && !public) Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { EmptyState("나의 실천을 시작해볼까요?", "로그인하면 이 화면으로 돌아와 기록을 이어갈 수 있어요."); Primary("로그인", onClick = requireLogin) }
                                else when(destination) {
                                    "today", "todos", "schedule/{date}?zone={zone}" -> {
                                        val scheduleZone = backStack.arguments?.getString("zone")?.takeIf(String::isNotBlank)?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: zone
                                        TodosScreen(api, scheduleZone, destination == "today", revision, changed, navigate, backStack.arguments?.getString("date"), user.text("nickname", "뭉실"))
                                    }
                                    "explore" -> FeedScreen(api, authenticated, revision, navigate, requireLogin, zone)
                                    "search?query={query}" -> SearchScreen(api, authenticated, backStack.arguments?.getString("query").orEmpty(), zone, navigate, requireLogin, user.text("id"))
                                    "challenges" -> ChallengesScreen(api, authenticated, revision, navigate, zone)
                                    "me" -> ProfileScreen(api, revision, changed, navigate)
                                    "history" -> HistoryScreen(api, zone, revision, navigate)
                                    "post/{id}" -> PostScreen(api, id, authenticated, user, zone, revision, changed, navigate, requireLogin)
                                    "challenge/{id}" -> ChallengeDetailScreen(api, id, authenticated, revision, changed, navigate, requireLogin, zone)
                                    "profile/{handle}" -> PublicProfileScreen(api, backStack.arguments?.getString("handle").orEmpty(), authenticated, user, revision, changed, navigate, requireLogin)
                                    "chat/{kind}/{id}" -> ChatScreen(api, "${backStack.arguments?.getString("kind")}/$id", zone)
                                    "inbox" -> InboxScreen(api, revision, changed, navigate)
                                    "push/{id}" -> PushTargetScreen(api, user.text("id"), id) { route -> nav.popBackStack(); navigate(route) }
                                    "notifications" -> NotificationsScreen(api, revision, changed, navigate)
                                    "blocks" -> BlocksScreen(api, revision, changed)
                                    "settings" -> SettingsScreen(api, { signedOut(); guest = false }, navigate)
                                    "categories" -> CategoriesScreen(api, revision, changed, navigate, zone)
                                    "groups" -> GroupsScreen(api, zone, revision, changed, navigate)
                                    "rank" -> RankScreen(api)
                                    "onboarding" -> OnboardingScreen(api) { changed(); nav.popBackStack(); onboardingReturn?.let(navigate); onboardingReturn = null }
                                    "connections/{id}/{direction}" -> ConnectionsScreen(api, id, backStack.arguments?.getString("direction").orEmpty(), revision, navigate)
                                    "legal/{kind}" -> LegalScreen(backStack.arguments?.getString("kind").orEmpty())
                                }
                            } }
                        }
                    }
                }
            }
        }
    }
    }
}
private fun routeTitle(route: String): String = when(route.substringBefore('/')) {
    "post" -> "실천 기록"; "challenge" -> "챌린지"; "profile" -> "프로필"; "chat" -> "대화"; "inbox" -> "대화함"
    "push", "notifications" -> "알림"; "blocks" -> "차단한 사용자"; "settings" -> "설정"; "categories" -> "카테고리"; "groups" -> "그룹"
    "history" -> "완료 기록"; "schedule" -> "TODO 일정"; "rank" -> "뭉실 등급"; "connections" -> "함께하는 사람들"; "onboarding" -> "나의 관심사"; "legal" -> "이용 안내"; else -> "뭉실"
}
