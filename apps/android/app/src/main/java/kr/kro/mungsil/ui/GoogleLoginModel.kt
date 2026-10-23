package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*

data class GoogleLoginState(
    val busy: Boolean = false,
    val stage: String = "",
    val error: String? = null,
    val profileRequired: Boolean = false,
    val alternative: Boolean = false,
    val account: JsonObject? = null,
    val diagnostics: List<String> = emptyList(),
)

/** A configuration change must not discard the credential result or repeat account selection.
 * Identity tokens exist only in this ViewModel's memory, never in SavedStateHandle or logs. */
class GoogleLoginModel : ViewModel() {
    private val mutable = MutableStateFlow(GoogleLoginState())
    val state = mutable.asStateFlow()
    private var pendingToken: String? = null
    private var tokenTime = 0L
    private var job: Job? = null
    private val diagnostics = mutableListOf<String>()
    private fun record(step: String) { diagnostics += step }
    private fun failure(message: String, profileRequired: Boolean = false, alternative: Boolean = true): GoogleLoginState =
        GoogleLoginState(error = message, profileRequired = profileRequired, alternative = alternative, diagnostics = diagnostics.toList())

    fun start(api: Api, credential: suspend () -> String?) {
        if(mutable.value.busy) return
        pendingToken = null
        diagnostics.clear()
        record("계정 선택 요청")
        mutable.value = GoogleLoginState(busy = true, stage = "Google 계정을 확인하고 있어요.")
        job = viewModelScope.launch {
            try {
                val token = withTimeout(120_000) { credential() }
                if(token.isNullOrBlank()) {
                    record("계정 선택 결과 없음")
                    mutable.value = failure("Google에서 로그인 결과를 받지 못했어요. 계정을 선택했는데 창만 닫혔다면 아래 다른 방식으로 다시 선택해주세요.")
                    return@launch
                }
                mutable.value = mutable.value.copy(stage = "뭉실 계정으로 로그인하고 있어요.")
                record("Google 자격 증명 수신")
                record("서버 세션 요청")
                try { complete(api.signInGoogle(token)) }
                catch(e: ApiException) {
                    if(e.code != "GOOGLE_PROFILE_REQUIRED") throw e
                    pendingToken = token; tokenTime = System.nanoTime()
                    record("추가 가입 정보 필요")
                    mutable.value = GoogleLoginState(profileRequired = true)
                }
            } catch(_: TimeoutCancellationException) {
                record("계정 선택 응답 시간 초과")
                mutable.value = failure("Google 로그인 응답이 도착하지 않았어요. 연결을 확인하고 다시 선택해주세요.")
            } catch(e: CancellationException) {
                if(!currentCoroutineContext().isActive) throw e
                record("계정 선택 중단")
                mutable.value = failure("Google 계정 선택이 중단됐어요. 다시 선택해주세요.")
            }
            catch(e: Exception) { recordFailure(e); mutable.value = failure(diagnosticError(e)) }
        }
    }

    fun submit(api: Api, handle: String, birth: String, invite: String) {
        if(mutable.value.busy) return
        val token = pendingToken
        if(token == null || System.nanoTime() - tokenTime > 50L * 60 * 1_000_000_000) {
            pendingToken = null
            mutable.value = GoogleLoginState(error = "가입 시간이 지나 Google 계정을 다시 선택해주세요.", alternative = true)
            return
        }
        mutable.value = mutable.value.copy(busy = true, error = null, stage = "가입을 마무리하고 있어요.")
        record("추가 정보로 서버 세션 요청")
        job = viewModelScope.launch {
            try { complete(api.signInGoogle(token, handle, birth, invite)) }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(e is ApiException && e.status == 401) pendingToken = null
                recordFailure(e)
                mutable.value = failure(diagnosticError(e), pendingToken != null, pendingToken == null)
            }
        }
    }

    private fun recordFailure(error: Exception) {
        // Only local labels and allowlisted API stage/status; never provider payloads or tokens.
        val stage = (error as? ApiException)?.stage?.takeIf { it in setOf("credential", "auth/google", "session") }
        record(if(stage != null) "$stage 단계 실패 (${(error as ApiException).status})" else "요청 실패")
    }
    private fun complete(account: JsonObject) { pendingToken = null; diagnostics.clear(); mutable.value = GoogleLoginState(account = account) }
    fun consumeAccount() { diagnostics.clear(); mutable.value = GoogleLoginState() }
    fun cancel() { if(!mutable.value.busy) { pendingToken = null; diagnostics.clear(); mutable.value = GoogleLoginState() } }
    override fun onCleared() { pendingToken = null; super.onCleared() }
    private fun diagnosticError(error: Exception): String = friendlyError(error) +
        if(error is ApiException && error.stage != null) "\n확인 단계: ${error.stage} (${error.status})" else ""
}
