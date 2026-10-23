package kr.kro.mungsil.data

import java.net.URI
import java.net.URLDecoder

/** Tokens are passed in memory, never in the saved navigation back stack. */
class AppLink(val route: String, val token: String? = null)
fun parseAppLink(value: String?): AppLink? = runCatching {
    val uri = URI(value ?: return null)
    if(uri.scheme != "https" || uri.host != "mungsil.kro.kr" || uri.userInfo != null || uri.port !in listOf(-1, 443)) return null
    val path = uri.path
    if(path in listOf("/verify-email", "/reset-password")) {
        val tokens = uri.rawQuery.orEmpty().split('&').filter { it.substringBefore('=') == "token" }
        val token = tokens.singleOrNull()?.substringAfter('=', "")?.let { URLDecoder.decode(it, "UTF-8") }?.takeIf { it.matches(Regex("[A-Za-z0-9._~-]{1,2048}")) }
        return AppLink(path.drop(1), token)
    }
    val segment = "([A-Za-z0-9._-]{1,100})"
    when {
        path.matches(Regex("/posts/$segment")) -> AppLink("post/${path.substringAfterLast('/')}")
        path.matches(Regex("/people/$segment")) -> AppLink("profile/${path.substringAfterLast('/')}")
        path.matches(Regex("/challenges/$segment/chat")) -> AppLink("chat/challenge/${path.split('/')[2]}")
        path.matches(Regex("/challenges/$segment")) -> AppLink("challenge/${path.substringAfterLast('/')}")
        path.matches(Regex("/messages/$segment")) -> AppLink("chat/direct/${path.substringAfterLast('/')}")
        path == "/messages" -> AppLink("inbox")
        path in listOf("/today", "/explore", "/todos", "/challenges", "/me", "/notifications", "/onboarding") -> AppLink(path.drop(1))
        else -> null
    }
}.getOrNull()
