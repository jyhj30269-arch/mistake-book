/* 跨浏览器截图验证：node browser-shots.mjs chrome|edge */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
};
const which = process.argv[2] || "edge";
const EXE = BIN[which];
const PORT = 9393;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const OUT = "C:/Users/32949/Desktop/assets/_shots/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-browser-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: "C:/Users/32949/Desktop/assets",
  env: { ...process.env, PORT: String(PORT), DB_FILE: dbFile, MINERU_DISABLE: "1" },
  stdio: "ignore"
});
await sleep(1200);

async function getWsUrl(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error("CDP 端口未就绪");
}

const profile = mkdtempSync(join(tmpdir(), "mb-browser-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--force-device-scale-factor=1",
  "--window-size=1920,1080", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

try {
  const ws = new WebSocket(await getWsUrl(CDP_PORT));
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = (expression) => call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => (r.exceptionDetails ? Promise.reject(new Error(r.exceptionDetails.text)) : r.result && r.result.value));

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);
  // 登录页（未登录状态）
  const loginShot = await call("Page.captureScreenshot");
  writeFileSync(OUT + which + "-login.png", Buffer.from(loginShot.data, "base64"));
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 控制台错误
  const errors = [];
  const attach = call("Runtime.consoleAPICalled", {}).catch(() => {});
  // 整页截图
  const full = await call("Page.captureScreenshot", { captureBeyondViewport: true });
  writeFileSync(OUT + which + "-dashboard-full.png", Buffer.from(full.data, "base64"));

  // 录入页：上传题目+过程 → 自动配对 → 识别 → 校对（双原图 + 公式预览）
  await evalJS(`go("input"); resetInput(); true`);
  await evalJS(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleFiles([new File([arr], "q1.png", { type: "image/png" })], "q");
      handleFiles([new File([arr], "s1.png", { type: "image/png" })], "s");
    })()
  `);
  await sleep(600);
  await evalJS(`autoPairInput(); startInputOCR(); true`);
  await sleep(3200);
  const inputShot = await call("Page.captureScreenshot", { captureBeyondViewport: true });
  writeFileSync(OUT + which + "-input.png", Buffer.from(inputShot.data, "base64"));

  // 滚动到复习区
  await evalJS(`document.getElementById("dash-review").scrollIntoView({block:"start"}); true`);
  await sleep(900);
  const revShot = await call("Page.captureScreenshot");
  writeFileSync(OUT + which + "-review-view.png", Buffer.from(revShot.data, "base64"));

  // 点击开始复习 → 做题界面（题号导航 + 跳过按钮）
  await evalJS(`document.querySelector("#review-config .btn-primary").click(); true`);
  await sleep(900);
  const playShot = await call("Page.captureScreenshot");
  writeFileSync(OUT + which + "-review-play.png", Buffer.from(playShot.data, "base64"));

  // 滚动到统计区
  await evalJS(`document.getElementById("dash-stats").scrollIntoView({block:"start"}); true`);
  await sleep(1200);
  const statsShot = await call("Page.captureScreenshot");
  writeFileSync(OUT + which + "-stats-view.png", Buffer.from(statsShot.data, "base64"));

  // 布局与内容检查
  const diag = await evalJS(`(() => {
    const q = (s) => document.querySelector(s);
    const rect = (s) => { const r = q(s).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; };
    return {
      innerWidth: window.innerWidth,
      total: q("#stats-total").textContent,
      recCount: q("#rec-count").textContent,
      recPanel: document.querySelectorAll("#rec-panel .flex-between").length,
      reviewCfg: getComputedStyle(q("#review-config")).display !== "none",
      canvases: document.querySelectorAll("canvas").length,
      mainW: Math.round(q(".main").getBoundingClientRect().width),
      bodyScrollW: document.body.scrollWidth,
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth
    };
  })()`);
  console.log(which + " DIAG: " + JSON.stringify(diag));

  // 页面错误监听（Page.loadEventFired 后收集 Runtime.exceptionThrown）
  const ex = await call("Runtime.evaluate", {
    expression: `window.__errs = []; window.addEventListener("error", e => window.__errs.push(e.message)); "ok"`,
    returnByValue: true
  });
  await sleep(300);
  const errs = await evalJS(`window.__errs`);
  console.log(which + " ERRORS: " + JSON.stringify(errs || []));
  ws.close();
} catch (e) {
  console.error(which + " 测试异常:", e.message);
} finally {
  browser.kill();
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时目录失败（可忽略）:", e.message); }
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时数据库失败（可忽略）:", e.message); }
}
