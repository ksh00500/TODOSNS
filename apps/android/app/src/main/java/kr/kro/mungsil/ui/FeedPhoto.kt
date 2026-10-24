package kr.kro.mungsil.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest

/** Feed media owns its feedback: a failed image must not hide the record or import. */
@Composable internal fun FeedPhoto(url: String, title: String, open: () -> Unit) {
    var failed by remember(url) { mutableStateOf(false) }
    var loading by remember(url) { mutableStateOf(true) }
    var attempt by remember(url) { mutableIntStateOf(0) }
    if(failed) Surface(color = QuietSurface, modifier = Modifier.fillMaxWidth()) {
        // Error text and retry grow with font scale, outside a fixed photo ratio.
        Column(Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("사진을 불러오지 못했어요.", style = MaterialTheme.typography.titleMedium)
            Text("본문은 아래에서 계속 읽을 수 있어요.", color = Muted)
            OutlinedButton({ attempt++; loading = true; failed = false }, Modifier.heightIn(min = 48.dp)) { Text("사진 다시 불러오기") }
        }
    } else Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f)
        .clickable(role = Role.Button, onClickLabel = "$title 기록 보기", onClick = open)) {
        key(url, attempt) {
            AsyncImage(ImageRequest.Builder(LocalContext.current).data(url).diskCachePolicy(CachePolicy.DISABLED).build(),
                if(loading) null else "실천 인증 사진", Modifier.fillMaxSize().semantics {
                    stateDescription = if(loading) "사진 불러오는 중" else "사진 표시 완료"
                }, contentScale = ContentScale.Crop,
                onLoading = { loading = true }, onSuccess = { loading = false }, onError = { loading = false; failed = true })
        }
        if(loading) Surface(color = QuietSurface, modifier = Modifier.matchParentSize()) {
            Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                Text("사진을 불러오고 있어요.", color = Muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
    }
}
