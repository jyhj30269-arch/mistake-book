import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9394;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-reg-"));
const server = spawn("node", ["server.js"], {
  cwd: "C:/Users/32949/Desktop/assets",
  env: { ...process.env, PORT: String(PORT), DB_FILE: join(testDir, "t.db"), MINERU_DISABLE: "1" },
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

const profile = mkdtempSync(join(tmpdir(), "mb-reg-profile-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  "--window-size=1600,1000", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

let failures = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) failures++; };

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

  // 初始应为登录页
  const init = await evalJS(`({ login: getComputedStyle(document.getElementById("view-login")).display, app: getComputedStyle(document.getElementById("view-app")).display })`);
  check("未登录显示登录页", init.login === "grid" && init.app === "none");

  // 切到注册模式
  await evalJS(`toggleLoginMode(); true`);
  await sleep(200);
  const mode = await evalJS(`document.getElementById("login-btn").textContent`);
  check("注册模式按钮文案", mode.includes("注册"));

  // 填表并提交
  await evalJS(`document.getElementById("login-user").value = "regtest01"; document.getElementById("login-pass").value = "123456"; doLogin(); true`);
  await sleep(1800);
  const after = await evalJS(`({ login: getComputedStyle(document.getElementById("view-login")).display, app: getComputedStyle(document.getElementById("view-app")).display })`);
  check("注册成功进入应用", after.login === "none" && after.app === "block");
  const me = await evalJS(`fetch("/api/auth/me").then(r => r.ok ? r.json() : null)`);
  check("Cookie 会话已建立（me=" + (me && me.user) + "）", me && me.user === "regtest01");

  // 登出后再次登录
  await evalJS(`doLogout(); true`);
  await sleep(600);
  const out = await evalJS(`getComputedStyle(document.getElementById("view-login")).display`);
  check("登出回到登录页", out === "grid");
  await evalJS(`document.getElementById("login-user").value = "regtest01"; document.getElementById("login-pass").value = "123456"; loginMode = "login"; doLogin(); true`);
  await sleep(1500);
  const relogin = await evalJS(`getComputedStyle(document.getElementById("view-app")).display`);
  check("已注册账号可重新登录", relogin === "block");

  ws.close();
} catch (e) {
  console.error("测试异常:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
}
console.log(failures === 0 ? "\n注册流程全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
