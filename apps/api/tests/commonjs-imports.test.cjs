const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

test("CommonJS 전용 런타임 모듈은 require 호환 import를 사용한다", async () => {
  const [main, media, email] = await Promise.all([
    readFile(resolve(__dirname, "../src/main.ts"), "utf8"),
    readFile(resolve(__dirname, "../src/media.service.ts"), "utf8"),
    readFile(resolve(__dirname, "../src/email.service.ts"), "utf8"),
  ]);

  assert.match(main, /import \* as cookieParser from "cookie-parser"/);
  assert.match(media, /import \* as sharp from "sharp"/);
  assert.match(email, /import \* as nodemailer from "nodemailer"/);
  assert.equal(typeof require("cookie-parser"), "function");
  assert.equal(typeof require("sharp"), "function");
  const nodemailerPath = require.resolve("nodemailer", { paths: [resolve(__dirname, "..")] });
  assert.equal(typeof require(nodemailerPath), "object");
});
