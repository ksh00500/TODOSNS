@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package kr.kro.mungsil

import android.os.Build
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kr.kro.mungsil.ui.*
import org.junit.*
import org.junit.Assert.*
import java.io.File

/** Real IME/coordinate touch on a disposable emulator, not a physical-device setting change. */
class CompactSheetTest {
    @get:Rule val compose = createComposeRule()
    private fun shell(command: String) = InstrumentationRegistry.getInstrumentation().uiAutomation
        .executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().use { reader -> reader.readText().trim() } }

    @Test fun actualImeLeavesInputAndSaveTouchableWithoutLosingDraft() {
        Assume.assumeTrue("Disposable emulator only", Build.HARDWARE in listOf("ranchu", "goldfish"))
        val old = shell("settings get secure show_ime_with_hard_keyboard")
        var value by mutableStateOf(""); var saved by mutableStateOf(false); var ime = 0
        try {
            shell("settings put secure show_ime_with_hard_keyboard 1")
            compose.setContent { MungsilTheme { NativeSheet("작은 화면 입력", {}, dirty = value.isNotEmpty()) {
                val inset = WindowInsets.ime.getBottom(LocalDensity.current)
                SideEffect { ime = inset }
                Text("합성 입력 · 프로덕션 요청 없음")
                Field("실천 제목", value, { value = it })
                Primary("입력 저장") { saved = true }
            } } }
            compose.onNodeWithContentDescription("실천 제목").performScrollTo().performClick()
            compose.waitUntil(30_000) { ime > 0 }
            compose.onNodeWithContentDescription("실천 제목").performScrollTo().performTextInput("키보드와 작은 화면")
            compose.waitForIdle()
            assertTrue("Focused input must retain a 44px visible touch region", compose.onNodeWithContentDescription("실천 제목").fetchSemanticsNode().boundsInRoot.height >= 44f)
            compose.onNodeWithText("입력 저장").performScrollTo().assertIsDisplayed()
            assertTrue("Save must retain a 44px visible touch region", compose.onNodeWithText("입력 저장").fetchSemanticsNode().boundsInRoot.height >= 44f)
            // Insets can arrive before the separate OS keyboard window draws.
            Thread.sleep(1000)
            compose.waitForIdle()
            assertTrue("The keyboard must remain open for the coordinate tap", ime > 0)
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val folder = File(instrumentation.targetContext.getExternalFilesDir(null),"native-verification/compact-ime").apply { mkdirs() }
            // Capture SurfaceFlinger's composited frame, including the separate IME.
            val image = instrumentation.uiAutomation.executeShellCommand("screencap -p")
            File(folder,"save-above-keyboard.png").outputStream().use { output ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(image).use { it.copyTo(output) }
            }
            val bitmap = checkNotNull(android.graphics.BitmapFactory.decodeFile(File(folder,"save-above-keyboard.png").path))
            check(bitmap.width >= 320 && bitmap.height >= 360); bitmap.recycle()
            // Coordinate injection, not a semantics OnClick bypass behind the IME.
            compose.onNodeWithText("입력 저장").performClick()
            compose.waitUntil(10_000) { saved }
            assertEquals("키보드와 작은 화면",value)
        } finally {
            if(old == "null" || old.isEmpty()) shell("settings delete secure show_ime_with_hard_keyboard")
            else { check(old == "0" || old == "1"); shell("settings put secure show_ime_with_hard_keyboard $old") }
        }
    }
}
