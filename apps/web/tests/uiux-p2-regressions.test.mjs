import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("해시태그 진입은 기존 tags URL도 통합 결과로 해석하고 게시물 링크를 유지한다", async () => {
  const search = await source("../app/(product)/explore/search/page.tsx");
  const card = await source("../components/feed-card.tsx");
  assert.match(search, /searchQuery\.startsWith\("#"\) && resolvedTab === "tags" \? "all"/);
  assert.match(search, /query\.startsWith\("#"\) \? preferredTab \?\? "all"/);
  assert.match(search, /role="group" aria-label="검색 결과 종류"/);
  assert.match(search, /aria-pressed=\{tab === item\.id\}/);
  assert.doesNotMatch(search, /role="tablist"|role="tab"/);
  assert.match(card, /&type=all/);
});

test("검색 화면은 탐색 상위 맥락과 검색 하위 과업을 중복 없이 구분한다", async () => {
  const search = await source("../app/(product)/explore/search/page.tsx");
  assert.match(search, /aria-label="탐색으로 돌아가기"/);
  assert.match(search, /<span>탐색<\/span><\/Link><div><span>실천 찾기<\/span><h1>검색<\/h1>/);
  assert.doesNotMatch(search, /aria-label="피드로 돌아가기"/);
});

test("파스텔 면의 작은 보조 글자는 전용 고대비 토큰과 13px 최소 크기를 사용한다", async () => {
  const css = await source("../app/globals.css");
  assert.match(css, /--ink-on-pastel:\s*#554f5c/);
  assert.match(css, /\.hashtag-results small,[^{]+\{ color:var\(--ink-on-pastel\); font-size:13px; \}/);
});

test("마이 화면의 그룹 진입은 실제 그룹 관리 경로와 용어를 사용한다", async () => {
  const me = await source("../app/(product)/me/page.tsx");
  assert.match(me, /나의 TODO 그룹/);
  assert.match(me, /href="\/todos\/routines"/);
  assert.doesNotMatch(me, /루틴 보관함/);
});

test("챌린지는 시작 전과 종료 상태에서 불가능한 CTA 대신 상태 안내를 제공한다", async () => {
  const detail = await source("../app/(product)/challenges/[id]/page.tsx");
  const css = await source("../app/globals.css");
  assert.match(detail, /const hasStarted =/);
  assert.match(detail, /const hasEnded =/);
  assert.match(detail, /hasEnded \? <ChallengeStateCard/);
  assert.match(detail, /!hasStarted \? <ChallengeStateCard/);
  assert.match(detail, /\{!hasEnded && <button className="danger-link subtle"/);
  assert.match(detail, /className="challenge-action-stack"/);
  assert.match(css, /\.challenge-action-stack \{ display:grid; gap:12px; \}/);
});

test("마이 등급과 배지는 클릭 가능한 상세 정보를 제공하고 연결 경로를 보존한다", async () => {
  const me = await source("../app/(product)/me/page.tsx");
  const rank = await source("../app/(product)/me/rank/page.tsx");
  const connections = await source("../app/(product)/people/[handle]/connections/page.tsx");
  const api = await source("../../api/src/mungsil.service.ts");
  assert.match(me, /href="\/me\/rank" className="rank-card"/);
  assert.match(rank, /뭉실력은 이렇게 쌓여요/);
  assert.match(rank, /구름이 자라는 길/);
  assert.match(me, /<Sheet title="배지 이야기"/);
  assert.match(me, /만든 곳/);
  assert.match(me, /챌린지 내용 보기/);
  assert.match(me, /\/people\/\$\{me\.handle\}\/connections\?type=followers/);
  assert.match(connections, /search\.type === "following" \? "following" : "followers"/);
  assert.match(connections, /router\.replace\(`\/people\/\$\{handle\}\/connections\?type=following`/);
  assert.match(connections, /aria-pressed=\{kind === "following"\}/);
  assert.match(api, /description: true, kind: true, creator: \{ select: \{ nickname: true, handle: true \} \}/);
});

test("사진 검수는 대상 ID별 답변 상태와 확대 보기를 사용한다", async () => {
  const detail = await source("../app/(product)/challenges/[id]/page.tsx");
  assert.match(detail, /type ReviewState = \{ checkInId:/);
  assert.match(detail, /review\.checkInId === item\?\.checkInId/);
  assert.match(detail, /aria-label="인증 사진 크게 보기"/);
  assert.match(detail, /<Sheet title="인증 사진 크게 보기"/);
  assert.match(detail, /userErrorMessage\(vote\.error/);
});
