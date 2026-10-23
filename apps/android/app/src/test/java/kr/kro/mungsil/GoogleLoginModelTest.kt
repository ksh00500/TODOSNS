package kr.kro.mungsil

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kr.kro.mungsil.data.*
import kr.kro.mungsil.ui.GoogleLoginModel
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class GoogleLoginModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var model: GoogleLoginModel
    private val api = Api("http://127.0.0.1:1/api/v1/", object : SessionStore {
        override fun read(): String? = null
        override fun write(value: String?) { error("No credential should be persisted") }
    })
    @Before fun setup() { Dispatchers.setMain(dispatcher); model = GoogleLoginModel() }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun providerCancellationIsVisibleAndAllowsRetry() = runTest(dispatcher) {
        model.start(api) { throw CancellationException("provider cancelled") }
        runCurrent()
        assertFalse(model.state.value.busy)
        assertTrue(model.state.value.alternative)
        assertTrue(model.state.value.error!!.contains("중단"))
        model.start(api) { null }
        runCurrent()
        assertTrue(model.state.value.error!!.contains("결과를 받지 못했어요"))
    }

    @Test fun noCredentialCallbackTimesOutWithoutRemainingBusy() = runTest(dispatcher) {
        model.start(api) { awaitCancellation() }
        runCurrent()
        assertTrue(model.state.value.busy)
        advanceTimeBy(120_001)
        runCurrent()
        assertFalse(model.state.value.busy)
        assertTrue(model.state.value.error!!.contains("응답이 도착하지 않았어요"))
        assertEquals("계정 선택 응답 시간 초과", model.state.value.diagnostics.last())
        assertNull(api.accessToken)
    }

    @Test fun repeatedButtonDoesNotLaunchAnotherAccountPicker() = runTest(dispatcher) {
        var calls = 0
        val result = CompletableDeferred<String?>()
        model.start(api) { calls++; result.await() }
        runCurrent()
        model.start(api) { calls++; null }
        runCurrent()
        assertEquals(1, calls)
        result.complete(null)
        runCurrent()
        assertFalse(model.state.value.busy)
    }

    @Test fun credentialFailureReportsStageWithoutProviderPayload() = runTest(dispatcher) {
        model.start(api) { throw ApiException(400, "다시 선택해주세요.", "GOOGLE_CREDENTIAL_FAILED", stage = "credential") }
        runCurrent()
        assertEquals(listOf("계정 선택 요청", "credential 단계 실패 (400)"), model.state.value.diagnostics)
        model.start(api) { null }
        runCurrent()
        assertEquals(listOf("계정 선택 요청", "계정 선택 결과 없음"), model.state.value.diagnostics)
    }
}
