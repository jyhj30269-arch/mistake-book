/* 布局冒烟检查：桌面 1440px / 移动 390px 下关键指标 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9392;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-layout-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: ROOT,
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

const profile = mkdtempSync(join(tmpdir(), "mb-layout-"));
const browser = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

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
    .then((r) => r.result && r.result.value);

  await call("Page.enable");
  await call("Runtime.enable");

  // 桌面 1440
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: URL });
  await sleep(2500);
  const loginOk = await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.ok); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const desktop = await evalJS(`(() => {
    const sec = document.querySelector("#view-dashboard");
    const nav = document.querySelector(".side-nav");
    const tb = document.querySelector("#mobile-tabbar");
    return {
      viewVisible: getComputedStyle(sec).display !== "none",
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
      navW: Math.round(nav.getBoundingClientRect().width),
      tabbarHidden: getComputedStyle(tb).display === "none"
    };
  })()`);
  check("桌面：仪表盘可见", desktop.viewVisible);
  check("桌面：无横向滚动", desktop.noHScroll);
  check("桌面：侧边栏宽度≈232", Math.abs(desktop.navW - 232) <= 2);
  check("桌面：移动 Tab 隐藏", desktop.tabbarHidden);

  // 移动 390
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(1500);
  const mobile = await evalJS(`(() => {
    const tb = document.querySelector("#mobile-tabbar");
    const nav = document.querySelector(".side-nav");
    return {
      tabbarVisible: getComputedStyle(tb).display === "flex",
      sideNavHidden: getComputedStyle(nav).display === "none",
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
      inputNav: !!document.querySelector('.mobile-tabbar a[data-view="input"]'),
      noBatchNav: !document.querySelector('.mobile-tabbar a[data-view="input-batch"]')
    };
  })()`);
  check("移动：底部 Tab 显示", mobile.tabbarVisible);
  check("移动：侧边栏隐藏", mobile.sideNavHidden);
  check("移动：无横向滚动", mobile.noHScroll);
  check("移动：Tab 含「录入」不含批量", mobile.inputNav && mobile.noBatchNav);

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

console.log(failures === 0 ? "\n布局检查全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
