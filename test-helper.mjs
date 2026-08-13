/* 测试公共基建（v1.18）：启动服务/浏览器、CDP 客户端、断言收集器。
   用法：import { startServer, startBrowser, connect, sleep, makeCheck } from "./test-helper.mjs"; */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");
export const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 启动临时服务（独立 DB），返回 { server, testDir, stop } */
export function startServer(port, tag = "t") {
  const testDir = mkdtempSync(join(tmpdir(), `mb-${tag}-`));
  const server = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_FILE: join(testDir, "test.db"), MINERU_DISABLE: "1" },
    stdio: "ignore"
  });
  const stop = async () => {
    server.kill();
    await sleep(300);
    try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* 忽略 */ }
  };
  return { server, testDir, stop };
}

/* 通过 CDP /json/list 获取页面 WebSocket 地址 */
export async function getWsUrl(port) {
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

/* 启动无头浏览器，返回 { browser, profile, stop } */
export function startBrowser(exe, cdpPort, tag = "b") {
  const profile = mkdtempSync(join(tmpdir(), `mb-${tag}-`));
  const browser = spawn(exe, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, "about:blank"
  ], { stdio: "ignore" });
  const stop = async () => {
    browser.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* 忽略 */ }
  };
  return { browser, profile, stop };
}

/* 连接 CDP：返回 { call, evalJS, errors, close } */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || "").slice(0, 200));
    }
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
    .then((r) => (r.exceptionDetails
      ? Promise.reject(new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
      : r.result && r.result.value));
  const close = () => ws.close();
  return { call, evalJS, errors, close };
}

/* 登录并刷新（v1.13.3 起 API 强制鉴权） */
export async function loginAndReload(client, port, username = "admin", password = "admin123") {
  await client.evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"${username}",password:"${password}"})}).then(r=>r.json()); true`);
  await client.call("Page.reload", { ignoreCache: true });
  await sleep(2200);
}

/* 断言收集器：返回 { check, failures, abort, report } */
export function makeCheck(suiteName) {
  let failures = 0;
  let aborted = false;
  const check = (name, cond) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
    if (!cond) failures++;
  };
  const abort = (msg) => {
    console.error(`✘ ${suiteName} 中止：${msg}`);
    aborted = true;
    failures++;
  };
  const report = () => {
    if (aborted) console.log(`\n${suiteName} 未完成（异常中止）✘`);
    else console.log(failures === 0 ? `\n${suiteName} 全部通过 ✔` : `\n${failures} 项失败 ✘`);
    process.exit(failures === 0 ? 0 : 1);
  };
  return { check, failures, abort, report };
}
