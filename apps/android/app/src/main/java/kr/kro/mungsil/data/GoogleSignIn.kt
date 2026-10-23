package kr.kro.mungsil.data

import android.content.Context
import androidx.credentials.*
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/** Google identity is exchanged for our existing server session, never trusted locally. */
suspend fun googleIdToken(context: Context, webClientId: String): String? {
    return requestGoogleCredential(context, webClientId, false)
}

suspend fun googleAccountPicker(context: Context, webClientId: String): String? = requestGoogleCredential(context, webClientId, true)

private suspend fun requestGoogleCredential(context: Context, webClientId: String, accountPicker: Boolean): String? {
    if (!webClientId.endsWith(".apps.googleusercontent.com")) throw ApiException(400, "Google 로그인이 아직 준비되지 않았어요.")
    try {
        val option = if(accountPicker) GetGoogleIdOption.Builder().setServerClientId(webClientId).setFilterByAuthorizedAccounts(false).setAutoSelectEnabled(false).build()
            else GetSignInWithGoogleOption.Builder(webClientId).build()
        val response = CredentialManager.create(context).getCredential(context,
            GetCredentialRequest.Builder().addCredentialOption(option).build())
        val credential = response.credential
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
            throw ApiException(400, "Google 계정을 확인하지 못했어요. 다시 시도해주세요.")
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    } catch (_: GetCredentialCancellationException) {
        throw ApiException(400, "Google 계정 선택이 취소됐어요. 다시 선택해주세요.", "GOOGLE_CREDENTIAL_CANCELLED", stage = "credential")
    } catch (_: NoCredentialException) {
        throw ApiException(400, "사용 가능한 Google 계정을 찾지 못했어요. 기기의 Google 계정과 Play 서비스를 확인하거나 다른 계정 선택 방식을 이용해주세요.", "GOOGLE_ACCOUNT_UNAVAILABLE", stage = "credential")
    } catch (e: GetCredentialException) {
        val category = e.javaClass.simpleName.replace(Regex("[^A-Za-z]"), "").take(80)
        throw ApiException(400, "Google 계정 선택을 완료하지 못했어요. 다시 시도하거나 다른 계정 선택 방식을 이용해주세요.\n확인 코드: $category", "GOOGLE_CREDENTIAL_FAILED", stage = "credential")
    } catch (_: GoogleIdTokenParsingException) {
        throw ApiException(400, "Google 인증 응답을 읽지 못했어요. Google Play 서비스를 업데이트한 뒤 다시 시도해주세요.", "GOOGLE_CREDENTIAL_INVALID", stage = "credential")
    }
}

suspend fun clearGoogleCredential(context: Context) {
    try { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    catch (e: kotlinx.coroutines.CancellationException) { throw e }
    catch (_: Exception) { /* Server logout remains authoritative; no automatic Google sign-in is used. */ }
}
