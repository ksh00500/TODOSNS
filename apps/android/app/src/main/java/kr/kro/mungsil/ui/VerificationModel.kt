package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*

data class VerificationState(val data: VerificationQueue? = null, val loading: Boolean = true, val error: String? = null)
class VerificationModel(private val source: VerificationSource) : ViewModel() {
    private val mutable = MutableStateFlow(VerificationState())
    val state = mutable.asStateFlow()
    private var generation = 0L
    private var job: Job? = null
    fun load(challengeId: String) {
        val current = ++generation
        job?.cancel(); mutable.value = VerificationState()
        job = viewModelScope.launch {
            try {
                val data = source.queue(challengeId)
                if(current == generation) mutable.value = VerificationState(data, false)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == generation) mutable.value = VerificationState(loading = false, error = friendlyError(e)) }
        }
    }
}
