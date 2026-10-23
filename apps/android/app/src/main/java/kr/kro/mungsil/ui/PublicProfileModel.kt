package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*

data class PublicProfileState(val person: ProfileSection<PublicPerson> = ProfileSection(), val relation: ProfileSection<FollowStatus> = ProfileSection(loading = false))
class PublicProfileModel(private val source: PublicProfileSource) : ViewModel() {
    private val mutable = MutableStateFlow(PublicProfileState())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var relationJob: Job? = null
    private var generation = 0L
    private var relationGeneration = 0L
    private var auth = false
    private var viewerId = ""
    fun load(handle: String, authenticated: Boolean, viewer: String) {
        val current = ++generation
        auth = authenticated; viewerId = viewer
        job?.cancel(); relationJob?.cancel()
        mutable.value = PublicProfileState()
        job = viewModelScope.launch {
            try {
                val person = source.profile(handle, authenticated)
                if(current != generation) return@launch
                mutable.value = PublicProfileState(person = ProfileSection(person, false))
                if(authenticated && person.id != viewer) retryRelation()
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == generation) mutable.value = PublicProfileState(person = ProfileSection(loading = false, error = friendlyError(e))) }
        }
    }
    fun retryRelation() {
        val person = mutable.value.person.data ?: return
        if(!auth || person.id == viewerId) return
        val current = generation; val request = ++relationGeneration
        relationJob?.cancel()
        mutable.value = mutable.value.copy(relation = ProfileSection())
        relationJob = viewModelScope.launch {
            try {
                val relation = source.followStatus(person.id)
                if(current == generation && request == relationGeneration) mutable.value = mutable.value.copy(relation = ProfileSection(relation, false))
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == generation && request == relationGeneration) mutable.value = mutable.value.copy(relation = ProfileSection(loading = false, error = friendlyError(e))) }
        }
    }
}
