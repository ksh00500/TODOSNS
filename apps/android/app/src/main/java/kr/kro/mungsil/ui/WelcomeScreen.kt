package kr.kro.mungsil.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The public entry mirrors the web landing; product records come only from the API. */
@Composable fun WelcomeScreen(start: () -> Unit, browse: () -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            CloudMark(Modifier.size(30.dp, 24.dp))
            Text("뭉실", Modifier.weight(1f).padding(start = 8.dp), color = Brand, style = MaterialTheme.typography.titleLarge)
            TextButton(browse) { Text("실천 둘러보기") }
        }
        PageList {
            item { Spacer(Modifier.height(16.dp)); Text("오늘의 작은 실천이 내일의 습관으로", color = Brand) }
            item { Text("좋아요로 끝나지 않는\n건강한 루틴 SNS", style = MaterialTheme.typography.displayLarge) }
            item { Text("해낸 일을 기록하고, 서로 가볍게 응원하고,\n마음에 든 습관은 내 TODO로 가져오세요.", color = Muted) }
            item { Primary("무료로 시작하기", onClick = start); TextButton(browse, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("공개 루틴 둘러보기") } }
            item { CloudCard { Text("오늘 할 일을 가볍게", style = MaterialTheme.typography.titleMedium); Text("복잡한 계획보다 지금 실천할 수 있는 일에 집중해요.") } }
            item { CloudCard { Text("비교 대신 응원", style = MaterialTheme.typography.titleMedium); Text("숫자 경쟁 없이 서로의 작은 성취를 다정하게 북돋아요.") } }
            item { CloudCard { Text("좋은 습관을 내 하루로", style = MaterialTheme.typography.titleMedium); Text("마음에 든 TODO와 루틴을 그대로 가져와 실천해요.") } }
        }
    }
}
