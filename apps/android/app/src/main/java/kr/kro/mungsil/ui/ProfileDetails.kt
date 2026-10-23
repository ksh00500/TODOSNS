package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.gson.JsonParser
import kr.kro.mungsil.data.*

@Composable fun ConnectionsScreen(api: Api, id: String, direction: String, revision: Int, navigate: (String) -> Unit) {
    var selectedDirection by rememberSaveable(id, direction) { mutableStateOf(if(direction == "following") "following" else "followers") }
    val page = rememberPaged(api, "social/$selectedDirection/$id", true, revision)
    PageList {
        item { Heading("함께하는 구름"); Choices("연결 목록 종류", listOf("followers" to "팔로워", "following" to "팔로잉"), selectedDirection) { selectedDirection = it } }
        items(page.rows, key = { it.text("id") }) { person ->
            val available = person.text("handle").isNotBlank() && person.text("nickname").isNotBlank()
            Surface(shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()
                .clickable(enabled = available, role = Role.Button) { navigate("profile/${person.text("handle")}") }
                .semantics { contentDescription = if(available) "${person.text("nickname")}님의 프로필 보기" else "탈퇴 또는 접근할 수 없는 사용자" }) {
                Row(Modifier.padding(16.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Surface(Modifier.size(44.dp), color = Blush, shape = CircleShape) {
                        if(person.text("avatarUrl").isNotBlank()) coil.compose.AsyncImage(person.text("avatarUrl"), null, contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                        else Box(contentAlignment = Alignment.Center) { Text(person.text("nickname", "구름").take(1), color = Brand) }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(if(available) person.text("nickname") else "탈퇴 또는 접근할 수 없는 사용자", style = MaterialTheme.typography.titleMedium)
                        if(available) Text("@${person.text("handle")} · ${person.text("cloudRank")}", color = Muted)
                    }
                }
            }
        }
        item { if(page.loaded && page.rows.isEmpty() && page.error == null) EmptyState("아직 함께하는 구름이 없어요", "좋은 실천을 발견하면 가볍게 팔로우해보세요.") else PageStatus(page) }
    }
}

@Composable fun RankScreen(api: Api) {
    val remote = rememberRemote(api) { api.request("me") }
    val ranks = listOf("구름씨앗" to 0, "조각구름" to 100, "솜구름" to 300, "뭉게구름" to 800, "노을구름" to 2000, "별구름" to 5000)
    val profile = remote.data?.obj()
    PageList {
        remoteStatus(remote)
        if(profile != null) {
            val power = profile.number("lifetimePower")
            val current = ranks.last { power >= it.second }
            val next = ranks.firstOrNull { power < it.second }
            item { Heading("나의 성장", "작은 실천이 구름을 키워요.") }
            item { CloudCard {
                Text("현재 등급 · ${current.first}", style = MaterialTheme.typography.headlineMedium)
                Text("${power} 뭉실")
                LinearProgressIndicator(progress = { next?.let { (power.toFloat() / it.second).coerceIn(0f,1f) } ?: 1f }, modifier = Modifier.fillMaxWidth())
                Text(next?.let { "${it.first}까지 ${it.second - power} 뭉실" } ?: "가장 높은 구름에 도착했어요")
            } }
            item { CloudCard {
                Text("뭉실력은 이렇게 쌓여요", style = MaterialTheme.typography.titleLarge)
                Text("TODO 완료 · 하루 최대 5번, 한 번에 10 뭉실\n완료한 실천 게시 · 하루 최대 2번, 한 번에 5 뭉실\n응원과 댓글 · 하루 합산 최대 5번, 한 번에 1 뭉실\n내 실천 가져가기 · 다른 사람이 가져가면 한 번에 5 뭉실")
                Text("누적 뭉실력은 줄어들지 않아요. 사용할 수 있는 포인트와는 별도로 기록돼요.", color = Muted)
            } }
            items(ranks) { rank -> CloudCard { Text("${if(power >= rank.second) "✓" else "○"} ${rank.first}${if(rank == current) " · 현재" else ""}"); Text("${rank.second} 뭉실부터", color = Muted) } }
        }
    }
}

@Composable fun LegalContent(kind: String) {
    val context = LocalContext.current
    val document = remember(kind) { context.assets.open("legal.json").bufferedReader().use { JsonParser.parseReader(it).obj().child(if(kind == "privacy") "privacy" else "terms") } }
    Text(document.text("title"), style = MaterialTheme.typography.headlineMedium)
    document.list("blocks").forEach { block -> Text(block.text("text"), style = if(block.flag("heading")) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyMedium) }
}
@Composable fun LegalScreen(kind: String) { PageList { item { Column(verticalArrangement = Arrangement.spacedBy(16.dp)) { LegalContent(kind) } } } }
