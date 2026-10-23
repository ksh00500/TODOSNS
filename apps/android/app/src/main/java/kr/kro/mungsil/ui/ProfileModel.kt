package kr.kro.mungsil.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kr.kro.mungsil.data.*

data class ProfileSection<T>(val data: T? = null, val loading: Boolean = true, val error: String? = null)
data class ProfileUiState(
    val profile: ProfileSection<ProfileRecord> = ProfileSection(),
    val groups: ProfileSection<List<ProfileGroup>> = ProfileSection(),
    val posts: ProfileSection<List<ProfilePost>> = ProfileSection(),
)
class ProfileModel(private val source: ProfileSource) : ViewModel() {
    private val mutable = MutableStateFlow(ProfileUiState())
    val state = mutable.asStateFlow()
    private var profileJob: Job? = null
    private var groupJob: Job? = null
    private var generation = 0L
    private var groupGeneration = 0L
    private var postGeneration = 0L
    fun load() {
        val current = ++generation
        profileJob?.cancel(); groupJob?.cancel()
        mutable.value = ProfileUiState()
        retryGroups()
        profileJob = viewModelScope.launch {
            try {
                val profile = source.profile()
                if(current != generation) return@launch
                mutable.value = mutable.value.copy(profile = ProfileSection(profile, false))
                loadPosts(profile.handle, current)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == generation) mutable.value = mutable.value.copy(profile = ProfileSection(loading = false, error = friendlyError(e))) }
        }
    }
    fun retryGroups() {
        val current = generation
        val groupRequest = ++groupGeneration
        groupJob?.cancel()
        mutable.value = mutable.value.copy(groups = ProfileSection())
        groupJob = viewModelScope.launch {
            try { val groups = source.groups(); if(current == generation && groupRequest == groupGeneration) mutable.value = mutable.value.copy(groups = ProfileSection(groups.toList(), false)) }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(current == generation && groupRequest == groupGeneration) mutable.value = mutable.value.copy(groups = ProfileSection(loading = false, error = friendlyError(e))) }
        }
    }
    fun retryPosts() {
        val profile = mutable.value.profile.data ?: return
        val current = generation
        profileJob?.cancel()
        mutable.value = mutable.value.copy(posts = ProfileSection())
        profileJob = viewModelScope.launch { loadPosts(profile.handle, current) }
    }
    private suspend fun loadPosts(handle: String, current: Long) {
        val postRequest = ++postGeneration
        try { val posts = source.posts(handle); if(current == generation && postRequest == postGeneration) mutable.value = mutable.value.copy(posts = ProfileSection(posts.toList(), false)) }
        catch(e: CancellationException) { throw e }
        catch(e: Exception) { if(current == generation && postRequest == postGeneration) mutable.value = mutable.value.copy(posts = ProfileSection(loading = false, error = friendlyError(e))) }
    }
}
