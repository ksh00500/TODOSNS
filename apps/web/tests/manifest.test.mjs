import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PWA manifest has the five-tab app identity", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.short_name, "뭉실");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
});

test("서비스 워커는 변경 요청을 캐시하거나 큐에 넣지 않는다", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("Android TWA는 운영 도메인과 필수 런타임 컴포넌트를 검증한다", async () => {
  const assetLinks = JSON.parse(
    await readFile(new URL("../public/.well-known/assetlinks.json", import.meta.url), "utf8"),
  );
  const androidManifest = await readFile(
    new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8",
  );
  const androidBuild = await readFile(
    new URL("../../android/app/build.gradle", import.meta.url),
    "utf8",
  );

  assert.equal(assetLinks[0].target.package_name, "kr.kro.mungsil");
  assert.match(assetLinks[0].target.sha256_cert_fingerprints[0], /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.match(androidManifest, /android:manageSpaceActivity="com\.google\.androidbrowserhelper\.trusted\.ManageDataLauncherActivity"/);
  assert.match(androidManifest, /android:name="com\.google\.androidbrowserhelper\.trusted\.LauncherActivity"/);
  assert.match(androidManifest, /android:autoVerify="true"/);
  assert.match(androidManifest, /android:host="mungsil\.kro\.kr"/);
  assert.match(androidBuild, /targetSdk 36/);
});
