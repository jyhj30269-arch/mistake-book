/* 个人工作台 · 冒烟测试（可选）：
   用 Edge/Chrome 无头模式 + CDP 真实跑通：
   单题：添加图片 → OCR → 保存
   批量：3 张图（2 题 + 1 解）→ 自动配对 → OCR → 全部保存
   持久化：刷新页面后数据仍在
   用法：node smoke-test.mjs
*/
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXE = process.env.SMOKE_BROWSER === "chrome" ? CHROME : EDGE;
const PORT = 9391;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=input`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-smoke-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_FILE: dbFile, MINERU_DISABLE: "1" },
  stdio: "ignore"
});
await sleep(1200);

function cdp(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    eval(expression) {
      return this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
        .then((r) => r.result && r.result.value);
    }
  };
}

async function getWsUrl(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 未就绪，重试 */ }
    await sleep(250);
  }
  throw new Error("CDP 端口未就绪");
}

const profile = mkdtempSync(join(tmpdir(), "mb-smoke-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

try {
  const wsUrl = await getWsUrl(CDP_PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const client = cdp(ws);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await client.eval(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await client.call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 1) 进入统一录入页，初始为单题/批量合一界面
  check("统一录入页可见", await client.eval(`!!document.querySelector("#view-input") && getComputedStyle(document.querySelector("#view-input")).display !== "none"`));
  check("无独立批量入口（input-batch 已移除）", await client.eval(`!document.querySelector("#view-input-batch") && !document.querySelector('[data-view="input-batch"]')`));

  // 2) 单题：注入一张图片 → 单题模式
  await client.eval(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const f = new File([arr], "q1.png", { type: "image/png" });
      handleFiles([f], "q");
    })()
  `);
  await sleep(400);
  check("单题：图片卡片出现", await client.eval(`document.querySelectorAll("#input-q-imgs .bimg-card").length === 1`));
  check("单题模式标签", await client.eval(`document.querySelector("#input-mode-tag").textContent.includes("单题")`));

  // 3) 开始识别 → 等待模拟 OCR → 题面已填入
  await client.eval(`startInputOCR()`);
  await sleep(2600);
  check("单题：OCR 完成后题面已填", await client.eval(`document.querySelector("#input-title").value.includes("\\\\lim")`));

  // 4) 保存当前题 → 题库 +1（15 → 16）
  await client.eval(`saveCurrentQuestion()`);
  await sleep(400);
  check("单题：保存后入库 16 题", await client.eval(`questions.length === 16`));
  // Node 侧直连 API 需带会话 Cookie（v1.13.3 起 /api 强制鉴权）
  const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" })
  });
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
  const dbAfterSave = await (await fetch(`http://127.0.0.1:${PORT}/api/db`, { headers: { Cookie: cookie } })).json();
  check("单题：已写入 SQLite", dbAfterSave.questions.length === 16);

  // 5) 批量：回到录入页，注入 3 张（2 题 + 1 解题）
  await client.eval(`go("input")`);
  await client.eval(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const mk = (n) => new File([arr], n, { type: "image/png" });
      handleFiles([mk("q2.png"), mk("q3.png")], "q");
      handleFiles([mk("s1.png")], "s");
    })()
  `);
  await sleep(400);
  check("批量：题目 2 张 + 过程 1 张", await client.eval(`document.querySelectorAll("#input-q-imgs .bimg-card").length === 2 && document.querySelectorAll("#input-s-imgs .bimg-card").length === 1`));
  check("批量模式标签", await client.eval(`document.querySelector("#input-mode-tag").textContent.includes("批量")`));
  await client.eval(`autoPairInput()`);
  check("批量：自动配对 1 组", await client.eval(`inputPairs.length === 1`));

  // 6) 批量识别 + 全部保存 → 16 + 2 = 18（2 张题目图）
  await client.eval(`startInputOCR()`);
  await sleep(3200);
  check("批量：识别完成 2 道", await client.eval(`inputQueue.length === 2 && inputQueue.every(x => x.status === "done")`));
  await client.eval(`saveAllQuestions()`);
  await sleep(400);
  check("批量：保存后共 18 题", await client.eval(`questions.length === 18`));

  // 7) 刷新页面 → 数据仍在（本地持久化生效）
  await client.call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  check("刷新后仍 18 题（持久化）", await client.eval(`questions.length === 18`));

  ws.close();
} catch (e) {
  console.error("测试异常:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时目录失败（可忽略）:", e.message); }
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时数据库失败（可忽略）:", e.message); }
}

console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
