require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Test } = require("@nestjs/testing");
const { ValidationPipe } = require("@nestjs/common");
const { JwtService } = require("@nestjs/jwt");
const { PrismaClient } = require("@prisma/client");
const request = require("supertest");
const { TodoController } = require("../dist/src/controllers.js");
const { TodoHistoryService } = require("../dist/src/todo-history.service.js");
const { MungsilService } = require("../dist/src/mungsil.service.js");
const { PrismaService } = require("../dist/src/prisma.service.js");
const { JwtAuthGuard } = require("../dist/src/auth.js");

const url = process.env.TODO_HISTORY_TEST_DATABASE_URL;
const secret = "synthetic-history-database-test-only";
process.env.JWT_ACCESS_SECRET = secret;

test("완료 기록은 실제 PostgreSQL과 HTTP에서 권한·55개 동시각 페이지·변경·snapshot 경계를 지킨다", {skip:!url}, async () => {
  const target = new URL(url);
  assert.ok(["127.0.0.1","localhost"].includes(target.hostname) && target.pathname === "/todosns_m04", "Use the isolated loopback todosns_m04 fixture database only");
  const db = new PrismaClient({datasources:{db:{url}}});
  const suffix = randomBytes(5).toString("hex");
  const ownerIds = [];
  let app;
  try {
    const users = [];
    for(const name of ["a","b"]) {
      const user = await db.user.create({data:{email:`history-${suffix}-${name}@example.test`,nickname:`기록 ${name}`,handle:`h_${suffix}_${name}`,birthDate:new Date("1995-01-01"),timezone:"Asia/Seoul"}});
      ownerIds.push(user.id); users.push(user);
    }
    const [a,b] = users;
    const sessions = [];
    for(const user of users) sessions.push(await db.session.create({data:{userId:user.id,familyId:`history-${suffix}`,tokenHash:"synthetic-hash",expiresAt:new Date(Date.now()+60_000)}}));
    const jwt = new JwtService();
    const auth = (index,expiresIn=60) => ({Authorization:`Bearer ${jwt.sign({sub:users[index].id,sid:sessions[index].id},{secret,expiresIn})}`});
    const sameTime = new Date("2026-10-23T03:00:00.123Z");
    const dueDate = new Date("2026-10-20T03:00:00Z");
    const category = await db.todoCategory.create({data:{userId:a.id,name:"보관한 분류",baseCategory:"생활",archivedAt:new Date("2026-10-22T00:00:00Z")}});
    const sameIds = Array.from({length:55},(_,i) => `history-${suffix}-${String(i).padStart(3,"0")}`);
    await db.todo.createMany({data:sameIds.map((id,i) => ({id,userId:a.id,title:`같은 시각 ${i}`,notes:"내 비공개 메모",dueDate,completedAt:sameTime,visibility:["PRIVATE","FOLLOWERS","PUBLIC"][i%3]}))});
    await db.todo.update({where:{id:sameIds[54]},data:{categoryId:category.id}});
    const create = (id,data={}) => db.todo.create({data:{id:`history-${suffix}-${id}`,userId:a.id,title:id,dueDate,completedAt:sameTime,...data}});
    const lower = await create("lower",{completedAt:new Date("2026-10-22T15:00:00Z")});
    const upper = await create("upper",{completedAt:new Date("2026-10-23T14:59:59.999Z")});
    await create("end-excluded",{completedAt:new Date("2026-10-23T15:00:00Z")});
    await create("due-today-completed-yesterday",{dueDate:new Date("2026-10-23T03:00:00Z"),completedAt:new Date("2026-10-22T14:59:59.999Z")});
    await create("open",{completedAt:null});
    await create("deleted",{deletedAt:new Date()});
    await create("other",{userId:b.id,notes:"다른 계정의 비밀"});

    const module = await Test.createTestingModule({controllers:[TodoController],providers:[TodoHistoryService,JwtAuthGuard,JwtService,
      {provide:PrismaService,useValue:db},{provide:MungsilService,useValue:{listTodos:async () => []}},
    ]}).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));
    await app.init();const server=app.getHttpServer();
    const query={fromDate:"2026-10-23",toDate:"2026-10-23",limit:20};
    const get = (q=query,index=0) => request(server).get("/api/v1/todos/history").set(auth(index)).query(q);
    await request(server).get("/api/v1/todos/history").expect(401);
    const first=(await get().expect(200)).body;
    assert.equal(first.total,57);assert.equal(first.items.length,20);assert.ok(first.nextCursor);
    assert.deepEqual(Object.keys(first).sort(),["fromDate","items","nextCursor","timezone","toDate","total"]);
    assert.equal(first.items[0].id,upper.id);
    assert.equal(first.items[1].dueDate,dueDate.toISOString());
    assert.equal(first.items[1].completedAt,sameTime.toISOString());
    assert.equal(first.items[1].categoryRef.name,"보관한 분류");
    assert.equal(first.items[1].categoryRef.archivedAt,"2026-10-22T00:00:00.000Z");
    assert.equal(first.items[1].categoryRef.userId,undefined);
    const all=[...first.items];let cursor=first.nextCursor;
    while(cursor) {
      const page=(await get({...query,cursor}).expect(200)).body;
      assert.equal(page.total,57);all.push(...page.items);cursor=page.nextCursor;
    }
    assert.deepEqual(all.map(x=>x.id),[upper.id,...sameIds.toReversed(),lower.id]);
    assert.equal(new Set(all.map(x=>x.id)).size,57);
    assert.ok(all.every(x=>x.userId===undefined && x.notes!=="다른 계정의 비밀"));
    assert.deepEqual(new Set(all.map(x=>x.visibility)),new Set(["PRIVATE","FOLLOWERS","PUBLIC"]));

    await get({...query,cursor:first.nextCursor},1).expect(400);
    await get({...query,toDate:"2026-10-24",cursor:first.nextCursor}).expect(400);
    await get({...query,cursor:first.nextCursor+"x"}).expect(400);
    const anchor=first.items.at(-1).id;
    await db.todo.update({where:{id:anchor},data:{completedAt:null}});
    await db.todo.update({where:{id:sameIds[10]},data:{deletedAt:new Date()}});
    await db.todo.update({where:{id:sameIds[9]},data:{visibility:"PRIVATE"}});
    const after=(await get({...query,cursor:first.nextCursor}).expect(200)).body;
    assert.equal(after.total,55);
    assert.ok(after.items.every(x=>x.id!==anchor && x.id!==sameIds[10]));
    assert.ok(after.items.every(x=>!first.items.some(old=>old.id===x.id)));
    await db.user.update({where:{id:a.id},data:{timezone:"UTC"}});
    await get({...query,cursor:first.nextCursor}).expect(400);
    await db.user.update({where:{id:a.id},data:{timezone:"Asia/Seoul"}});

    // A second connection mutates after findMany but before count in the read transaction.
    const concurrent = await create("concurrent",{completedAt:new Date("2026-10-23T12:00:00Z")});
    const expected=await db.todo.count({where:{userId:a.id,deletedAt:null,completedAt:{gte:new Date("2026-10-22T15:00:00Z"),lt:new Date("2026-10-23T15:00:00Z")}}});
    let changed=false;
    const observed=db.$extends({query:{todo:{async findMany({args,query:execute}) {
      const rows=await execute(args);
      if(!changed) { changed=true;await db.todo.update({where:{id:concurrent.id},data:{completedAt:null}}); }
      return rows;
    }}}});
    const consistent=await new TodoHistoryService(observed).list(a.id,{...query,limit:50});
    assert.equal(consistent.total,expected);assert.ok(consistent.items.some(x=>x.id===concurrent.id));
    const current=(await get({...query,limit:50}).expect(200)).body;
    assert.equal(current.total,expected-1);assert.ok(current.items.every(x=>x.id!==concurrent.id));

    await request(server).get("/api/v1/todos/history").set(auth(0,-1)).query(query).expect(401);
    for(const field of ["suspendedAt","deletionRequestedAt"]) {
      await db.user.update({where:{id:a.id},data:{[field]:new Date()}});await get().expect(401);
      await db.user.update({where:{id:a.id},data:{[field]:null}});
    }
    await db.session.update({where:{id:sessions[0].id},data:{revokedAt:new Date()}});await get().expect(401);
    const bPage=(await get(query,1).expect(200)).body;
    assert.equal(bPage.total,1);assert.equal(bPage.items[0].notes,"다른 계정의 비밀");
  } finally {
    if(app) await app.close();
    if(ownerIds.length) await db.user.deleteMany({where:{id:{in:ownerIds}}});
    await db.$disconnect();
  }
});
