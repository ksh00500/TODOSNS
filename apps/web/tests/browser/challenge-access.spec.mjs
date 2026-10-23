import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const user = { id: "challenge-owner", email: "challenge@mungsil.test", nickname: "실천 구름", handle: "challenge.cloud", role: "USER", timezone: "Asia/Seoul", lifetimePower: 100 };
const output = resolve("../../outputs/android/native-verification/challenge-web");
const challenge = {
  id: "challenge", title: "함께 걷는 실천", description: "매일 함께 천천히 걸어요.", kind: "COMMUNITY",
  startsAt: "2000-01-01T00:00:00Z", endsAt: "2100-01-01T00:00:00Z", endedAt: null,
  verificationMode: "PEER_PHOTO", verificationCriteria: ["실천이 보이나요?"], minimumParticipants: 8,
  completionThreshold: 80, creator: { id: user.id }, _count: { participants: 8 }, joined: true, todayCheckedIn: true,
  myCheckInCount: 1, successRate: 50, chatReadOnly: false, checkIns: [{ id: "rejected", checkInDate: "2026-09-28T00:00:00Z",
    status: "REJECTED", note: "오늘의 기록", reviewNote: "실천 내용이 보이지 않아요.", retryUntil: "2100-01-01T00:00:00Z", attempt: 1, reverifyUsed: false }],
};
for (const width of [360, 390, 430]) {
  test(`challenge retry and review actions respect period and membership at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    let source = challenge;
    const writes = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname.replace(/^\/api\/v1\//, "");
      if(request.method() !== "GET" && path !== "auth/refresh") writes.push(path);
      const data = path === "auth/refresh" ? { accessToken: "synthetic" } : path === "auth/me" ? user :
        path === "challenges/challenge" ? source : path.endsWith("/leaderboard") ? { items: [], myRank: null } :
        path.endsWith("unread-count") ? { count: 0 } : path === "challenges" ? [] : undefined;
      await route.fulfill({ status: data === undefined ? 500 : 200, contentType: "application/json", body: JSON.stringify(data ?? { message: `합성 API 미지원: ${path}` }) });
    });
    for (const [name, patch, retryAllowed] of [
      ["active", {}, true],
      ["ended", { endedAt: "2026-09-28T00:00:00Z", chatReadOnly: true }, false],
      ["expired", { endsAt: "2001-01-01T00:00:00Z", chatReadOnly: true }, false],
      ["upcoming", { startsAt: "2099-01-01T00:00:00Z" }, false],
      ["not-joined", { joined: false, checkIns: [] }, false],
    ]) {
      source = { ...challenge, ...patch };
      await page.goto("/challenges/challenge");
      await expect(page.getByRole("heading", { name: challenge.title, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "새 사진 올리기", exact: true })).toHaveCount(retryAllowed ? 1 : 0);
      await expect(page.getByRole("button", { name: "같은 사진 재검증", exact: true })).toHaveCount(retryAllowed ? 1 : 0);
      await expect(page.getByRole("button", { name: "다른 참여자의 사진 인증 도와주기", exact: true })).toHaveCount(retryAllowed ? 1 : 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if(name === "ended") {
        await mkdir(output, { recursive: true });
        await page.screenshot({ path: resolve(output, `challenge-ended-${width}.png`) });
      }
    }
    expect(writes).toEqual([]);
  });
}
