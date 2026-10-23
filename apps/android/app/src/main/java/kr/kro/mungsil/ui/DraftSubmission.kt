package kr.kro.mungsil.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import com.google.gson.JsonObject
import kr.kro.mungsil.data.newKey

/** Product drafts only. Keys change when submitting a changed body, not while editing. */
class DraftSubmission(private var submittedBody: String? = null, private var requestKey: String = newKey()) {
    fun keyFor(payload: JsonObject): String {
        val body = payload.toString()
        if(submittedBody != null && submittedBody != body) requestKey = newKey()
        submittedBody = body
        return requestKey
    }
    fun succeeded() { submittedBody = null; requestKey = newKey() }
    companion object {
        val StateSaver = Saver<DraftSubmission, List<String>>(
            save = { listOf(it.submittedBody.orEmpty(), it.requestKey) },
            restore = { DraftSubmission(it[0].takeIf(String::isNotBlank), it[1]) },
        )
    }
}
@Composable fun rememberDraftSubmission(vararg keys: Any?): DraftSubmission =
    rememberSaveable(*keys, saver = DraftSubmission.StateSaver) { DraftSubmission() }
