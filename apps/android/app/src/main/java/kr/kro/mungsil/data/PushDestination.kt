package kr.kro.mungsil.data

/** Re-read the notification under the current session; FCM payloads never supply routes. */
suspend fun resolvePushDestination(api: Api, owner: String, notificationId: String): String {
    if(!notificationId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) return "notifications"
    if(api.request("auth/me").obj().text("id") != owner) throw ApiException(403, "이 알림을 받은 계정으로 로그인해주세요.")
    api.request("me/push-devices/notifications/$notificationId")
    var cursor: String? = null
    val seen = mutableSetOf<String>()
    do {
        val page = api.request("me/notifications", query = mapOf("limit" to "50") + (cursor?.let { mapOf("cursor" to it) } ?: emptyMap())).obj()
        if(page.get("items")?.isJsonArray != true) throw ApiException(502, "알림을 불러오지 못했어요. 다시 시도해주세요.")
        page.list("items").firstOrNull { it.text("id") == notificationId }?.let {
            val href = it.text("href")
            return if(href.startsWith('/') && !href.startsWith("//")) parseAppLink("https://mungsil.kro.kr$href")?.route ?: "notifications" else "notifications"
        }
        cursor = page.text("nextCursor").ifBlank { null }
    } while(cursor != null && seen.add(cursor!!))
    return "notifications"
}
