@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.kro.mungsil.data.*
import java.time.ZoneId

@Composable fun SearchScreen(api: Api, auth: Boolean, initial: String, zone: ZoneId, navigate: (String) -> Unit, login: () -> Unit, viewerId: String = "") {
    var input by rememberSaveable(initial) { mutableStateOf(initial) }
    var query by rememberSaveable(initial) { mutableStateOf(initial) }
    var type by rememberSaveable(initial) { mutableStateOf(if(initial.startsWith("@")) "users" else "all") }
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val prefs = remember { context.getSharedPreferences("search", android.content.Context.MODE_PRIVATE) }
    var recent by remember { mutableStateOf(prefs.getString("recent", "").orEmpty().split('\n').filter { it.isNotBlank() }.take(6)) }
    fun search(value: String) {
        focus.clearFocus(); keyboard?.hide()
        query = value.trim().take(60); input = query; type = if(query.startsWith("@")) "users" else "all"
        if(query.isNotBlank()) { recent = (listOf(query) + recent.filter { it != query }).take(6); prefs.edit().putString("recent", recent.joinToString("\n")).apply() }
    }
    val model: SearchModel = viewModel(key = "search-$viewerId-$auth", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = SearchModel(SearchRepository(api)) as T
    })
    LaunchedEffect(query, auth, viewerId) { model.search(query, auth) }
    LaunchedEffect(model) { model.suggestions() }
    val state = model.state.collectAsStateWithLifecycle().value
    val currentQuery = query
    val currentType = type
    val recentQueries = recent.toList()
    val resultState = state.results.takeIf { state.query == currentQuery } ?: SearchSection(loading = currentQuery.isNotBlank())
    val data = resultState.data
    val suggestions = state.suggestions.data.orEmpty()
    PageList {
        item { Heading("검색", "사용자, 실천, 루틴, #해시태그 검색") }
        item { Field("통합 검색", input, { input = it }, 60, imeAction = ImeAction.Search, onSubmit = { search(input) }); Row { TextButton({ search(input) }) { Text("검색") }; if(input.isNotBlank()) TextButton({ search("") }) { Text("검색어 지우기") } } }
        if(currentQuery.isBlank()) {
            if(recentQueries.isNotEmpty()) item { Text("최근 검색", style = MaterialTheme.typography.titleLarge); FlowRow { recentQueries.forEach { value -> TextButton({ search(value) }) { Text(value) } } }; TextButton({ recent = emptyList(); prefs.edit().remove("recent").apply() }) { Text("모두 지우기") } }
            if(state.suggestions.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if(state.suggestions.error != null) item { ErrorNotice(state.suggestions.error) { model.suggestions() } }
            item { Text("요즘 많이 찾는 태그", style = MaterialTheme.typography.titleLarge) }
            items(suggestions, key = { it.id }) { tag -> TextButton({ search("#${tag.name}") }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("#${tag.name} · ${tag.posts}개 게시물") } }
            if(state.suggestions.data != null && suggestions.isEmpty()) item { EmptyState("아직 인기 태그가 없어요", "새로운 실천이 게시되면 여기에서 소개할게요.") }
        } else {
            if(resultState.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if(resultState.error != null) item { ErrorNotice(resultState.error) { model.search(currentQuery, auth) } }
            if(data != null) {
                item { CloudCard { Text("‘$currentQuery’ 검색 결과", style = MaterialTheme.typography.titleMedium); Text("${data.counts.getValue("all")}개의 공개 결과를 찾았어요", color = Muted) } }
                item { Choices("검색 결과 종류", listOf("all" to "통합", "users" to "사용자", "posts" to "실천", "routines" to "루틴", "tags" to "해시태그", "challenges" to "챌린지").map { it.first to "${it.second} ${data.counts.getValue(it.first)}" }, currentType, { type = it }) }
                if(data.counts.getValue("all") == 0) item { EmptyState("검색 결과가 없어요", "다른 단어를 쓰거나 #해시태그로 찾아보세요.") }
                else if(data.counts.getValue(currentType) == 0) item { EmptyState("이 종류의 결과는 없어요", "통합 결과에서 다른 종류를 확인해보세요.") }
                else {
                    if(currentType in listOf("all", "users") && data.users.isNotEmpty()) {
                        item { SearchHeading("사용자", data.counts.getValue("users"), currentType == "all") { type = "users" } }
                        items(data.users, key = { "user/${it.id}" }) { person ->
                            Surface(Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClickLabel = "${person.nickname}님의 프로필") { navigate("profile/${person.handle}") }, shape = MaterialTheme.shapes.medium) {
                                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Surface(Modifier.size(44.dp), color = Blush, shape = CircleShape) { Box(contentAlignment = Alignment.Center) { Text(person.nickname.take(1), color = Brand) } }
                                    Column(Modifier.weight(1f)) { Text(person.nickname, style = MaterialTheme.typography.titleMedium); Text("@${person.handle} · ${person.rank}", color = Muted) }
                                    Text("›", color = Brand)
                                }
                            }
                        }
                    }
                    if(currentType in listOf("all", "tags") && data.tags.isNotEmpty()) {
                        item { SearchHeading("해시태그", data.counts.getValue("tags"), currentType == "all") { type = "tags" } }
                        items(data.tags, key = { "tag/${it.id}" }) { tag -> TextButton({ search("#${tag.name}") }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("#${tag.name} · ${tag.posts}개 공개 게시물") } }
                    }
                    if(currentType in listOf("all", "posts") && data.posts.isNotEmpty()) {
                        item { SearchHeading("실천", data.counts.getValue("posts"), currentType == "all") { type = "posts" } }
                        items(if(currentType == "all") data.posts.take(3) else data.posts, key = { "post/${it.text("id")}" }) { post -> InteractiveFeedCard(api, post, auth, zone, navigate, login) }
                    }
                    if(currentType in listOf("all", "routines") && data.routines.isNotEmpty()) {
                        item { SearchHeading("루틴", data.counts.getValue("routines"), currentType == "all") { type = "routines" } }
                        items(if(currentType == "all") data.routines.take(2) else data.routines, key = { "routine/${it.text("id")}" }) { post -> InteractiveFeedCard(api, post, auth, zone, navigate, login) }
                    }
                    if(currentType in listOf("all", "challenges") && data.challenges.isNotEmpty()) {
                        item { SearchHeading("챌린지", data.counts.getValue("challenges"), currentType == "all") { type = "challenges" } }
                        items(data.challenges, key = { "challenge/${it.id}" }) { challenge ->
                            Surface(Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClickLabel = "${challenge.title} 챌린지 보기") { navigate("challenge/${challenge.id}") }, shape = MaterialTheme.shapes.medium) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(challenge.title, style = MaterialTheme.typography.titleMedium)
                                    Text("${if(challenge.kind == "OFFICIAL") "공식" else "커뮤니티"} · ${challenge.participants}명 참여", color = Muted)
                                    Text(challenge.description)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
@Composable private fun SearchHeading(title: String, count: Int, more: Boolean, open: () -> Unit) {
    Column { Text(title, style = MaterialTheme.typography.titleLarge); Text("${count}개 결과", color = Muted)
        if(more) TextButton(open, modifier = Modifier.heightIn(min = 44.dp)) { Text("$title 더보기") }
    }
}
