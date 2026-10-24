@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import kr.kro.mungsil.R
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.input.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.*
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.google.gson.*
import kotlinx.coroutines.*
import kr.kro.mungsil.data.*
import java.time.*

val Cream = Color(0xFFFAF8F5)
val Ink = Color(0xFF202027)
val Muted = Color(0xFF66616C)
val Brand = Color(0xFF65558F)
val Aqua = Color(0xFFC3ECE9)
val Lavender = Color(0xFFE8DEFF)
val Blush = Color(0xFFFFDCE4)
val Canvas = Color(0xFFEEECEA)

val Jakarta = FontFamily(Font(R.font.jakarta_500, FontWeight(500)), Font(R.font.jakarta_650, FontWeight(650)), Font(R.font.jakarta_700, FontWeight(700)), Font(R.font.jakarta_720, FontWeight(720)), Font(R.font.jakarta_760, FontWeight(760)))

private fun type(size: Int, line: Int, weight: Int) = TextStyle(fontFamily = Jakarta, fontSize = size.sp, lineHeight = line.sp, fontWeight = FontWeight(weight))
val CloudTypography = Typography(
    displayLarge = type(32, 40, 760), headlineMedium = type(28, 36, 760),
    titleLarge = type(20, 28, 720), titleMedium = type(16, 23, 700),
    bodyLarge = type(14, 22, 500), bodyMedium = type(14, 22, 500),
    labelLarge = type(13, 18, 700), labelMedium = type(13, 18, 700), bodySmall = type(12, 17, 650))

@Composable fun MungsilTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Brand, onPrimary = Color.White,
        primaryContainer = Color(0xFFE8DEFF), onPrimaryContainer = Ink, secondaryContainer = Aqua,
        background = Cream, surface = Color.White, surfaceContainer = Cream, onSurface = Ink,
        onBackground = Ink, onSurfaceVariant = Muted, outlineVariant = Color(0xFFE5E0E6), error = Color(0xFFB3261E)),
        typography = CloudTypography, shapes = Shapes(small = RoundedCornerShape(14.dp), medium = RoundedCornerShape(18.dp), large = RoundedCornerShape(24.dp)), content = content)
}

@Composable fun CloudMark(modifier: Modifier = Modifier) {
    androidx.compose.foundation.Canvas(modifier.size(44.dp, 30.dp)) {
        val w = size.width; val h = size.height
        drawOval(Brand, androidx.compose.ui.geometry.Offset(w * .04f, h * .38f), androidx.compose.ui.geometry.Size(w * .32f, h * .47f))
        drawOval(Brand, androidx.compose.ui.geometry.Offset(w * .23f, h * .02f), androidx.compose.ui.geometry.Size(w * .52f, h * .80f))
        drawOval(Brand, androidx.compose.ui.geometry.Offset(w * .60f, h * .27f), androidx.compose.ui.geometry.Size(w * .38f, h * .58f))
        drawRoundRect(Brand, androidx.compose.ui.geometry.Offset(w * .05f, h * .52f), androidx.compose.ui.geometry.Size(w * .92f, h * .40f), androidx.compose.ui.geometry.CornerRadius(h,h))
    }
}

@Composable fun Heading(title: String, subtitle: String? = null) {
    Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    subtitle?.let { Text(it, color = Muted, style = MaterialTheme.typography.bodyMedium) }
}
@Composable fun CloudCard(inset: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(inset), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}
@Composable fun Primary(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Button({ focus.clearFocus(); keyboard?.hide(); onClick() }, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled, shape = RoundedCornerShape(14.dp)) { Text(text) }
}
@Composable fun ActionIcon(label: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick, enabled = enabled, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) { Icon(icon, label) }
}
@Composable fun Field(label: String, value: String, change: (String) -> Unit, max: Int = 500, password: Boolean = false, multiline: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, hint: String? = null, enabled: Boolean = true, imeAction: ImeAction = ImeAction.Default, onSubmit: (() -> Unit)? = null) {
    var show by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        // Keep the full label outside the outline cutout at large font scales.
        // The editable control announces the same name without a second focus stop.
        Text(label, Modifier.clearAndSetSemantics {}, style = MaterialTheme.typography.labelLarge)
        OutlinedTextField(value, { if (it.length <= max) change(it) }, Modifier.fillMaxWidth().semantics { contentDescription = label }, enabled = enabled,
        singleLine = !multiline, minLines = if (multiline) 3 else 1,
        visualTransformation = if (password && !show) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if(password) KeyboardType.Password else keyboard, imeAction = imeAction),
        keyboardActions = if(onSubmit == null) KeyboardActions.Default else KeyboardActions(onDone = { onSubmit() }, onSearch = { onSubmit() }),
        trailingIcon = if(password) {{ ActionIcon(if(show) "비밀번호 숨기기" else "비밀번호 보기", if(show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility) { show = !show } }} else null,
        supportingText = hint?.let { { Text(it) } }, shape = RoundedCornerShape(14.dp))
    }
}
@Composable fun ErrorNotice(message: String?, retry: (() -> Unit)? = null) {
    if (message != null) Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        Column(Modifier.padding(14.dp)) { Text(message, color = MaterialTheme.colorScheme.onErrorContainer); retry?.let { TextButton(it) { Text("다시 시도") } } }
    }
}
@Composable fun EmptyState(title: String, body: String) {
    CloudCard { Icon(Icons.Rounded.CloudQueue, null, Modifier.size(40.dp), tint = Brand); Text(title, fontWeight = FontWeight.Bold); Text(body, color = Muted) }
}
@Composable fun PageList(state: LazyListState = rememberLazyListState(), content: LazyListScope.() -> Unit) {
    val inset = if(LocalConfiguration.current.screenWidthDp <= 360) 18.dp else 20.dp
    LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(horizontal = inset, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}

/** All native sheets share IME/inset handling, one body scroll and modal focus semantics. */
@Composable fun NativeSheet(title: String, close: () -> Unit, dismissible: Boolean = true, dirty: Boolean = false, discardDetail: String = "저장하지 않은 내용이 사라져요.", content: @Composable ColumnScope.() -> Unit) {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    DisposableEffect(Unit) { onDispose { focus.clearFocus(); keyboard?.hide() } }
    var discard by remember { mutableStateOf(false) }
    val requestClose = { if(dismissible) { if(dirty) discard = true else close() }; Unit }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { if(it == SheetValue.Hidden && dirty && dismissible) discard = true; it != SheetValue.Hidden || (dismissible && !dirty) })
    ModalBottomSheet(onDismissRequest = requestClose, sheetState = sheetState, containerColor = Cream, dragHandle = null) {
        BoxWithConstraints(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).imePadding()) {
            // A 400dp window with the keyboard can leave only ~64dp. Keep the
            // body at the same composition location while reclaiming header room.
            val compact = maxHeight < 180.dp
            Column(Modifier.fillMaxWidth().semantics { if(compact) paneTitle = title }) {
                if(!compact) Row(Modifier.fillMaxWidth().padding(start = 20.dp, top = 8.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    ActionIcon("닫기", Icons.Rounded.Close, dismissible, requestClose)
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = if(compact) 4.dp else 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
            }
        }
    }
    if(discard) ConfirmSheet("작성을 그만둘까요?", discardDetail, "작성 내용 버리기", { discard = false }) { discard = false; close() }
}

/** Non-sensitive product drafts only. Never use for credentials or authentication links. */
@Composable fun rememberJsonState(): MutableState<JsonObject?> = rememberSaveable(
    stateSaver = androidx.compose.runtime.saveable.Saver<JsonObject?, String>(
        save = { it?.toString().orEmpty() }, restore = { it.takeIf(String::isNotBlank)?.let { value -> JsonParser.parseString(value).asJsonObject } })
) { mutableStateOf(null) }

@Composable fun TimeControl(value: String, change: (String) -> Unit) {
    TimeControl(value, true, change)
}
@Composable fun TimeControl(value: String, enabled: Boolean, change: (String) -> Unit) {
    var opened by remember { mutableStateOf(false) }
    OutlinedButton({ opened = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Text("시간 · $value") }
    if(opened && enabled) {
        var hour by remember { mutableStateOf(value.substringBefore(':').padStart(2, '0')) }
        var minute by remember { mutableStateOf(value.substringAfter(':', "00")) }
        NativeSheet("시간 선택", { opened = false }) {
            Choices("시", (0..23).map { it.toString().padStart(2, '0') to "${it}시" }, hour, { hour = it })
            Choices("분", ((0..55 step 5).map { it.toString().padStart(2, '0') } + minute).distinct().sorted().map { it to "${it}분" }, minute, { minute = it })
            Primary("시간 적용") { change("$hour:$minute"); opened = false }
        }
    }
}

class ActionState(private val scope: CoroutineScope) {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null)
    fun clearFeedback() { if(!busy) { error = null; notice = null } }
    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; notice = null
        scope.launch { try { block() } catch(e: CancellationException) { throw e } catch(e: Exception) { error = friendlyError(e) } finally { busy = false } }
    }
}
@Composable fun rememberAction(): ActionState { val scope = rememberCoroutineScope(); return remember(scope) { ActionState(scope) } }
@Composable fun ActionFeedback(action: ActionState) {
    ErrorNotice(action.error)
    action.notice?.let { Text(it, color = Brand, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
    if (action.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
}

class RemoteState {
    var data by mutableStateOf<JsonElement?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var version by mutableIntStateOf(0)
    fun reload() { version++ }
}
data class RemoteSnapshot(val data: JsonElement?, val error: String?, val loading: Boolean, private val source: RemoteState) {
    fun reload() = source.reload()
}
@Composable fun rememberRemote(vararg keys: Any?, load: suspend () -> JsonElement): RemoteSnapshot {
    val state = remember(*keys) { RemoteState() }
    val loader by rememberUpdatedState(load)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(state, state.version) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            state.loading = true; state.error = null
            try { state.data = loader() } catch(e: CancellationException) { throw e } catch(e: Exception) { state.error = friendlyError(e) } finally { state.loading = false }
            awaitCancellation()
        }
    }
    // Observe here, not only inside LazyListScope's cached non-composable builder.
    return RemoteSnapshot(state.data, state.error, state.loading, state)
}
fun LazyListScope.remoteStatus(remote: RemoteSnapshot) {
    if(remote.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
    if(remote.error != null) item { ErrorNotice(remote.error) { remote.reload() } }
}

@Composable fun Choices(label: String, options: List<Pair<String, String>>, value: String, change: (String) -> Unit) {
    Choices(label, options, value, true, change)
}
@Composable fun Choices(label: String, options: List<Pair<String, String>>, value: String, enabled: Boolean, change: (String) -> Unit) {
    Text(label, fontWeight = FontWeight.SemiBold)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (id, name) -> FilterChip(value == id, { change(id) }, { Text(name) }, Modifier.heightIn(min = 48.dp), enabled = enabled, leadingIcon = if(value==id) {{ Icon(Icons.Rounded.Check, null, Modifier.size(18.dp)) }} else null) }
    }
}
@Composable fun ChoiceControl(label: String, options: List<Pair<String, String>>, value: String, change: (String) -> Unit) {
    ChoiceControl(label, options, value, true, change)
}
@Composable fun ChoiceControl(label: String, options: List<Pair<String, String>>, value: String, enabled: Boolean, change: (String) -> Unit) {
    var opened by rememberSaveable { mutableStateOf(false) }
    Text(label, fontWeight = FontWeight.SemiBold)
    OutlinedButton({ opened = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Text(options.firstOrNull { it.first == value }?.second ?: "선택해주세요") }
    if(opened && enabled) NativeSheet("$label 선택", { opened = false }) {
        Choices(label, options, value) { change(it); opened = false }
    }
}
val baseCategories = listOf("생활", "건강", "운동", "공부", "독서", "마음", "커리어", "취미")
val repeatOptions = listOf("" to "반복 없음", "FREQ=DAILY" to "매일", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" to "평일", "FREQ=WEEKLY;BYDAY=SA,SU" to "주말", "FREQ=WEEKLY" to "매주")
fun repeatLabel(rule: String): String {
    val canonical = when(rule.uppercase()) { "DAILY" -> "FREQ=DAILY"; "WEEKLY" -> "FREQ=WEEKLY"; "WEEKDAYS" -> "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; "WEEKENDS" -> "FREQ=WEEKLY;BYDAY=SA,SU"; else -> rule.uppercase() }
    return repeatOptions.firstOrNull { it.first == canonical }?.second ?: "원본 반복 유지"
}
fun repeatChoices(rule: String): List<Pair<String, String>> {
    if(repeatOptions.any { it.first == rule }) return repeatOptions
    val label = repeatLabel(rule)
    return if(label == "원본 반복 유지") repeatOptions + (rule to label)
        else repeatOptions.map { if(it.second == label) rule to label else it }
}

@Composable fun DateControl(value: String, change: (String) -> Unit, label: String = "날짜", displayText: String? = null, enabled: Boolean = true) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    OutlinedButton({ expanded = !expanded }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Icon(Icons.Rounded.CalendarMonth, null); Spacer(Modifier.width(8.dp)); Text(displayText ?: "$label · $value") }
    if(expanded && enabled) NativeSheet("$label 선택", { expanded = false }) {
        val selectedDate = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
        var monthText by rememberSaveable { mutableStateOf(YearMonth.from(selectedDate).toString()) }
        val month = YearMonth.parse(monthText)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ActionIcon("이전 달", Icons.AutoMirrored.Rounded.ArrowBack) { monthText = month.minusMonths(1).toString() }
            Text("${month.year}년 ${month.monthValue}월", Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            ActionIcon("다음 달", Icons.Rounded.ArrowForward) { monthText = month.plusMonths(1).toString() }
        }
        Row { listOf("월", "화", "수", "목", "금", "토", "일").forEach { Text(it, Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center, color = Muted) } }
        val offset = month.atDay(1).dayOfWeek.value - 1
        for(week in 0 until (offset + month.lengthOfMonth() + 6)/7) {
            Row(Modifier.fillMaxWidth()) { for(day in 0..6) {
                val number = week * 7 + day - offset + 1
                if(number in 1..month.lengthOfMonth()) {
                    val date = month.atDay(number).toString()
                    TextButton({ change(date); expanded = false }, Modifier.weight(1f).heightIn(min = 48.dp).semantics { selected = date == value; contentDescription = "${month.monthValue}월 ${number}일" }, contentPadding = PaddingValues(0.dp), colors = ButtonDefaults.textButtonColors(containerColor = if(date == value) Aqua else Color.Transparent)) { Text(number.toString()) }
                } else Spacer(Modifier.weight(1f))
            } }
        }
    }
}

@Composable fun ConfirmSheet(title: String, detail: String, confirm: String, close: () -> Unit, operation: suspend () -> Unit) {
    val action = rememberAction()
    NativeSheet(title, close, !action.busy) { Text(detail); ActionFeedback(action); Primary(if(action.busy) "처리 중…" else confirm, !action.busy) { action.run { operation(); close() } }; TextButton(close, enabled = !action.busy) { Text("돌아가기") } }
}
