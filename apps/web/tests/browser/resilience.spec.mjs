import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { Server } from "socket.io";

const sessionUser = {
  id: "browser-user",
  email: "browser@mungsil.test",
  nickname: "브라우저 사용자",
  handle: "browser.user",
  role: "USER",
  timezone: "Asia/Seoul",
  lifetimePower: 10,
};

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function mockApi(page, handler) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    console.log(`[browser-api] ${request.method()} ${path}`);
    if (path === "/auth/refresh") return json(route, { accessToken: "browser-test-token" }, 201);
    if (path === "/auth/me") return json(route, sessionUser);
    if (path === "/me/notifications/unread-count" || path === "/messages/unread-count") return json(route, { count: 0 });
    if (path === "/challenges" && request.method() === "GET") return json(route, []);
    const handled = await handler({ route, request, path });
    if (!handled) {
      console.log(`[browser-api] unhandled ${request.method()} ${path}`);
      await json(route, { message: `Unhandled browser test request: ${request.method()} ${path}` }, 500);
    }
  });
}

const directMessage = (id, body, isMine = false) => ({
  id,
  kind: "USER",
  body,
  sender: isMine
    ? { id: sessionUser.id, nickname: sessionUser.nickname, handle: sessionUser.handle, avatarUrl: null, lifetimePower: 10 }
    : { id: "other-user", nickname: "상대 사용자", handle: "other.user", avatarUrl: null, lifetimePower: 20 },
  replyTo: null,
  media: [],
  reactions: [],
  links: [],
  deletedAt: null,
  hiddenAt: null,
  blocked: false,
  isMine,
  canDelete: isMine,
  createdAt: new Date(Date.now() + Number(id.replace(/\D/g, "")) * 1_000).toISOString(),
});

const directPage = (messages) => ({
  room: {
    conversationId: "browser-room",
    otherUser: { id: "other-user", nickname: "상대 사용자", handle: "other.user", avatarUrl: null, lifetimePower: 20 },
    unreadCount: 0,
    blocked: false,
    blockedByMe: false,
    canSend: true,
  },
  items: messages,
  nextCursor: null,
});

let socketHttp;
let socketServer;
let connectionCount;

test.beforeAll(async () => {
  connectionCount = 0;
  socketHttp = createServer();
  socketServer = new Server(socketHttp, { cors: { origin: "http://localhost:3100", credentials: true } });
  socketServer.of("/chat").on("connection", (socket) => {
    connectionCount += 1;
    socket.on("join", (roomId) => socket.join(roomId));
  });
  await new Promise((resolve, reject) => {
    socketHttp.once("error", reject);
    socketHttp.listen(4998, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await socketServer?.close();
});

test("전송 실패는 초안을 보존하고 전송 중 추가 입력은 성공 응답 뒤에도 남긴다", async ({ page }) => {
  const messages = [directMessage("message-1", "기존 메시지")];
  let sendCount = 0;
  await mockApi(page, async ({ route, request, path }) => {
    if (path === "/messages/browser-room" && request.method() === "GET") {
      await json(route, directPage(messages)); return true;
    }
    if (path === "/messages/browser-room/read" && request.method() === "POST") {
      await json(route, {} , 201); return true;
    }
    if (path === "/messages/browser-room/messages" && request.method() === "POST") {
      sendCount += 1;
      if (sendCount === 1) {
        await json(route, { message: "synthetic send failure" }, 500); return true;
      }
      const draft = request.postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const message = directMessage(`message-${messages.length + 1}`, draft.body, true);
      messages.push(message);
      await json(route, message, 201); return true;
    }
    return false;
  });

  await page.goto("/messages/browser-room");
  const input = page.getByLabel("대화 메시지");
  await expect(input).toBeVisible();
  await input.fill("실패해도 남을 초안");
  await page.getByLabel("메시지 보내기").click();
  await expect(page.getByText("서버에서 잠시 문제가 생겼어요. 입력한 내용은 유지했으니 다시 시도해주세요.")).toBeVisible();
  await expect(input).toHaveValue("실패해도 남을 초안");

  await input.fill("먼저 보낸 내용");
  await page.getByLabel("메시지 보내기").click();
  await input.fill("전송 중에 덧붙인 다음 초안");
  await expect(input).toHaveValue("전송 중에 덧붙인 다음 초안", { timeout: 3_000 });
  await expect(page.getByText("먼저 보낸 내용", { exact: true })).toHaveCount(1);
});

test("TODO 완료와 응원 실패는 낙관적 화면 및 캐시를 복원한다", async ({ page }) => {
  const dueDate = new Date();
  dueDate.setHours(12, 0, 0, 0);
  const todo = { id: "browser-todo", seriesId: null, title: "브라우저 완료 테스트", dueDate: dueDate.toISOString(), completedAt: null, visibility: "PRIVATE", repeatRule: null, category: "생활", categoryRef: null };
  const post = {
    id: "browser-post",
    author: { id: "author", nickname: "작성자", handle: "author", avatarUrl: null, cloudRank: "조각구름", lifetimePower: 3 },
    caption: "응원 롤백 테스트",
    hashtags: [],
    mediaUrl: null,
    todos: [{ ...todo, id: "public-todo", visibility: "PUBLIC", completedAt: new Date().toISOString() }],
    todoList: null,
    cheerCount: 0,
    commentCount: 0,
    copyCount: 0,
    createdAt: new Date().toISOString(),
    cheered: false,
  };
  await mockApi(page, async ({ route, request, path }) => {
    if (path === "/todos" && request.method() === "GET") { await json(route, [todo]); return true; }
    if (path === "/todo-lists" && request.method() === "GET") { await json(route, []); return true; }
    if (path === "/todos/browser-todo/complete" && request.method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await json(route, { message: "synthetic todo failure" }, 500); return true;
    }
    if ((path === "/feed" || path === "/public/feed") && request.method() === "GET") {
      await json(route, { items: [post], nextCursor: null }); return true;
    }
    if (path === "/feed/posts/browser-post/cheer" && request.method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await json(route, { message: "synthetic cheer failure" }, 500); return true;
    }
    return false;
  });

  await page.goto("/todos");
  await page.getByLabel("브라우저 완료 테스트 완료").click();
  await expect(page.getByLabel("브라우저 완료 테스트 완료 취소")).toBeVisible();
  await expect(page.getByLabel("브라우저 완료 테스트 완료")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("서버에서 잠시 문제가 생겼어요. 입력한 내용은 유지했으니 다시 시도해주세요.")).toBeVisible();

  await page.goto("/explore");
  const cheer = page.getByLabel("응원하기, 0개");
  await cheer.click();
  await expect(page.getByLabel("응원 취소, 1개")).toBeVisible();
  await expect(page.getByLabel("응원하기, 0개")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("alert")).toContainText("서버에서 잠시 문제가 생겼어요");
});

test("과거 위치를 유지하고 실제 소켓 재접속 뒤 메시지를 중복 없이 복구한다", async ({ page }) => {
  const messages = Array.from({ length: 35 }, (_, index) => directMessage(`history-${index + 1}`, `과거 메시지 ${index + 1} `.repeat(6)));
  await mockApi(page, async ({ route, request, path }) => {
    if (path === "/messages/browser-room" && request.method() === "GET") {
      await json(route, directPage(messages)); return true;
    }
    if (path === "/messages/browser-room/read" && request.method() === "POST") {
      await json(route, {}, 201); return true;
    }
    return false;
  });

  await page.goto("/messages/browser-room");
  await expect(page.getByText("과거 메시지 35", { exact: false })).toBeVisible();
  await expect.poll(() => connectionCount).toBeGreaterThan(0);
  const scroll = page.locator(".app-scroll");
  await scroll.evaluate((element) => { element.scrollTop = 120; });
  const before = await scroll.evaluate((element) => element.scrollTop);

  const activeSocket = [...socketServer.of("/chat").sockets.values()][0];
  activeSocket.conn.close();
  messages.push(directMessage("offline-36", "연결이 끊긴 동안 도착한 메시지"));
  await expect.poll(() => connectionCount, { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(page.getByText("연결이 끊긴 동안 도착한 메시지", { exact: true })).toHaveCount(1);
  const afterReconnect = await scroll.evaluate((element) => element.scrollTop);
  expect(Math.abs(afterReconnect - before)).toBeLessThanOrEqual(2);

  messages.push(directMessage("live-37", "재접속 뒤 실시간 메시지"));
  socketServer.of("/chat").to("browser-room").emit("message.created", { id: "live-37" });
  socketServer.of("/chat").to("browser-room").emit("message.created", { id: "live-37" });
  await expect(page.getByText("재접속 뒤 실시간 메시지", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/새 메시지 [12]개/)).toBeVisible();
  const afterLive = await scroll.evaluate((element) => element.scrollTop);
  expect(Math.abs(afterLive - before)).toBeLessThanOrEqual(2);
});
