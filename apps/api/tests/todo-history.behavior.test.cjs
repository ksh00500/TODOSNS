require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { ValidationPipe } = require("@nestjs/common");
const { Test } = require("@nestjs/testing");
const { JwtService } = require("@nestjs/jwt");
const request = require("supertest");
const { TodoHistoryService } = require("../dist/src/todo-history.service.js");
const { historyWindow, TodoHistoryCursor } = require("../dist/src/todo-history.js");
const { TodoController } = require("../dist/src/controllers.js");
const { MungsilService } = require("../dist/src/mungsil.service.js");
const { PrismaService } = require("../dist/src/prisma.service.js");
const { JwtAuthGuard } = require("../dist/src/auth.js");

const secret = "synthetic-todo-history-test-only";
process.env.JWT_ACCESS_SECRET = secret;
const dates = { fromDate: "2026-10-23", toDate: "2026-10-23", limit: 2 };
const scope = { ...historyWindow(dates,"Asia/Seoul"), userId: "owner", limit: 2 };
const position = { completedAt: new Date("2026-10-23T03:00:00.123Z"), id: "todo-2" };
const row = (id) => ({ id, title: `실천 ${id}`, notes: "내 메모", category: "생활", categoryId: null, categoryRef: null,
  dueDate: new Date("2026-10-22T00:00:00Z"), completedAt: position.completedAt, visibility: "PRIVATE", repeatRule: null,
  sourceTodoId: null, seriesId: null, occurrenceKey: null });

function fixture() {
  const calls = { reads: [], counts: [], transactions: [] };
  const tx = {
    user: { findFirst: async () => ({ timezone: "Asia/Seoul" }) },
    todo: {
      findMany: async (q) => { calls.reads.push(q); return q.where.OR ? [row("a")] : [row("c"),row("b"),row("a")]; },
      count: async (q) => { calls.counts.push(q); return 3; },
    },
  };
  const prisma = {
    $transaction: async (fn,options) => { calls.transactions.push(options); return fn(tx); },
    session: { findFirst: async ({where}) => where.id === `session-${where.userId}` ? {user: {email: "synthetic@example.test",role: "USER"}} : null },
  };
  return { service: new TodoHistoryService(prisma), prisma, tx, calls };
}

test("완료 기록은 계정 오늘 기준 최근7일과 엄격한 현지 날짜/90일 범위를 사용한다", () => {
  const window = historyWindow({},"Asia/Seoul",new Date("2026-10-22T15:00:00Z"));
  assert.equal(window.fromDate,"2026-10-17"); assert.equal(window.toDate,"2026-10-23");
  assert.equal(window.start.toISOString(),"2026-10-16T15:00:00.000Z");
  assert.equal(window.end.toISOString(),"2026-10-23T15:00:00.000Z");
  assert.doesNotThrow(() => historyWindow({fromDate:"2026-01-01",toDate:"2026-03-31"},"UTC"));
  assert.doesNotThrow(() => historyWindow({fromDate:"2024-02-29",toDate:"2024-02-29"},"UTC"));
  for(const query of [ {fromDate:"2026-01-01",toDate:"2026-04-01"}, {fromDate:"2026-02-29",toDate:"2026-03-01"},
    {fromDate:"2026-04-31",toDate:"2026-05-01"}, {fromDate:"0000-01-01",toDate:"0000-01-01"},
    {fromDate:"2026-10-24",toDate:"2026-10-23"}, {fromDate:"2026-10-23"}, {toDate:"2026-10-23"},
    {fromDate:"2026-1-01",toDate:"2026-01-01"}, {fromDate:"2026-01-01T00:00:00Z",toDate:"2026-01-01"}, {cursor:"old"} ]) {
    assert.throws(() => historyWindow(query,"UTC"),(e) => e.getStatus() === 400);
  }
});

test("완료일 경계는 DST23/25시간·없는/반복 자정·건너뛴 날짜를 현지 달력으로 계산한다", () => {
  for(const [date,zone,start,end] of [
    ["2026-03-08","America/New_York","2026-03-08T05:00:00.000Z","2026-03-09T04:00:00.000Z"],
    ["2026-11-01","America/New_York","2026-11-01T04:00:00.000Z","2026-11-02T05:00:00.000Z"],
    ["2018-11-04","America/Sao_Paulo","2018-11-04T03:00:00.000Z","2018-11-05T02:00:00.000Z"],
    ["2020-11-01","America/Havana","2020-11-01T04:00:00.000Z","2020-11-02T05:00:00.000Z"],
    ["2009-11-01","America/St_Johns","2009-11-01T02:30:00.000Z","2009-11-02T03:30:00.000Z"],
    ["2011-12-30","Pacific/Apia","2011-12-30T10:00:00.000Z","2011-12-30T10:00:00.000Z"],
  ]) {
    const window = historyWindow({fromDate:date,toDate:date},zone);
    assert.equal(window.start.toISOString(),start); assert.equal(window.end.toISOString(),end);
  }
});

test("잘못된 계정 시간대나 서명 설정을 UTC/공개 기본키로 대체하지 않는다", () => {
  assert.throws(() => historyWindow(dates,"Invalid/Zone"),(e) => e.getStatus() === 503);
  assert.throws(() => new TodoHistoryCursor(undefined),(e) => e.getStatus() === 503);
});

test("기록 커서는 위변조·다른 계정/기간/시간대/페이지 크기 재사용을 거부한다", () => {
  const codec = new TodoHistoryCursor(secret);
  const cursor = codec.encode(position,scope);
  assert.deepEqual(codec.decode(cursor,scope),position);
  for(const different of [{...scope,userId:"other"},{...scope,fromDate:"2026-10-22"},{...scope,toDate:"2026-10-24"},{...scope,timezone:"UTC"},{...scope,limit:3}]) {
    assert.throws(() => codec.decode(cursor,different),(e) => e.getStatus() === 400);
  }
  for(const invalid of ["broken",cursor+"=",cursor.replace(/.$/,cursor.endsWith("A") ? "B" : "A"), "x".repeat(2049)]) {
    assert.throws(() => codec.decode(invalid,scope),(e) => e.getResponse().code === "TODO_HISTORY_CURSOR_INVALID");
  }
  assert.throws(() => new TodoHistoryCursor("different-test-key").decode(cursor,scope),(e) => e.getStatus() === 400);
});

test("정상 서명이라도 커서 버전·필드·완료 시각·범위가 잘못되면 거부한다", () => {
  const codec = new TodoHistoryCursor(secret);
  const [base] = codec.encode(position,scope).split(".");
  const original = JSON.parse(Buffer.from(base,"base64url"));
  const key = createHmac("sha256",secret).update("mungsil:todo-history:v1").digest();
  for(const value of [{...original,v:2},{...original,extra:"field"},{...original,id:""},{...original,at:"invalid"},
    {...original,at:scope.end.toISOString()},{...original,at:new Date(scope.start.getTime()-1).toISOString()}]) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signed = `${payload}.${createHmac("sha256",key).update(payload).digest("base64url")}`;
    assert.throws(() => codec.decode(signed,scope),(e) => e.getStatus() === 400);
  }
});

test("완료 기록은 completedAt 범위·본인·미삭제 조건으로 전체 total과 같은 읽기 snapshot을 사용한다", async () => {
  const {service,calls} = fixture();
  const page = await service.list("owner",dates);
  assert.deepEqual(page.items.map(x => x.id),["c","b"]); assert.equal(page.total,3);
  assert.equal(page.items[0].completedAt,position.completedAt.toISOString());
  assert.equal(page.items[0].dueDate,"2026-10-22T00:00:00.000Z");
  assert.equal(page.items[0].userId,undefined);
  assert.equal(calls.transactions[0].isolationLevel,"RepeatableRead");
  const q = calls.reads[0];
  assert.equal(q.where.userId,"owner"); assert.equal(q.where.deletedAt,null); assert.equal(q.where.dueDate,undefined);
  assert.deepEqual(q.where.completedAt,{gte:scope.start,lt:scope.end});
  assert.deepEqual(q.orderBy,[{completedAt:"desc"},{id:"desc"}]); assert.equal(q.take,3);
  assert.deepEqual(calls.counts[0].where,q.where);
  const next = await service.list("owner",{...dates,cursor:page.nextCursor});
  assert.deepEqual(next.items.map(x => x.id),["a"]); assert.equal(next.total,3); assert.equal(next.nextCursor,null);
  assert.deepEqual(calls.reads[1].where.OR,[{completedAt:{lt:position.completedAt}},{completedAt:position.completedAt,id:{lt:"b"}}]);
  assert.equal(calls.counts[1].where.OR,undefined);
});

test("잘못된 기록 요청·비활성 계정은 할 일/total 조회를 실행하지 않는다", async () => {
  const {service,tx,calls} = fixture();
  for(const q of [{...dates,limit:0},{...dates,limit:51},{...dates,limit:1.5},{...dates,cursor:"broken"},{...dates,toDate:"2026-02-30"}]) {
    await assert.rejects(() => service.list("owner",q),(e) => e.getStatus() === 400);
  }
  await assert.rejects(() => service.list(undefined,dates),(e) => e.getStatus() === 401);
  tx.user.findFirst = async () => null;
  await assert.rejects(() => service.list("owner",dates),(e) => e.getStatus() === 401);
  assert.equal(calls.reads.length,0); assert.equal(calls.counts.length,0);
});

test("실제 기록 HTTP 경로는 기존 인증 guard와 DTO를 적용하고 예정일 조회와 공존한다", async (t) => {
  const {prisma,calls} = fixture();
  const module = await Test.createTestingModule({ controllers:[TodoController],providers:[
    TodoHistoryService,JwtAuthGuard,JwtService,{provide:PrismaService,useValue:prisma},
    {provide:MungsilService,useValue:{listTodos:async () => []}},
  ] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1"); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));
  await app.init(); t.after(() => app.close());
  const jwt = new JwtService();
  const auth = (user) => ({Authorization:`Bearer ${jwt.sign({sub:user,sid:`session-${user}`},{secret,expiresIn:60})}`});
  const server = app.getHttpServer();
  await request(server).get("/api/v1/todos/history").expect(401);
  const first = await request(server).get("/api/v1/todos/history").set(auth("owner")).query(dates).expect(200);
  assert.equal(first.body.total,3); assert.equal(first.body.items.length,2); assert.equal(first.body.timezone,"Asia/Seoul");
  for(const invalid of [{...dates,userId:"other"},{...dates,timezone:"UTC"},{...dates,limit:51},{...dates,limit:1.5},
    {...dates,limit:[1,2]},{...dates,fromDate:"2026-02-30"},{...dates,toDate:undefined}]) {
    await request(server).get("/api/v1/todos/history").set(auth("owner")).query(invalid).expect(400);
  }
  await request(server).get("/api/v1/todos/history").set(auth("other")).query({...dates,cursor:first.body.nextCursor}).expect(400);
  assert.equal(calls.reads.length,1);
  await request(server).get("/api/v1/todos").set(auth("owner")).query({from:"2026-10-23",to:"2026-10-24"}).expect(200,[]);
});
