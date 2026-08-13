/* 个人工作台新页面截图：node browser-shots-personal.mjs chrome|edge */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");

const BIN = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
};
const which = process.argv[2] || "chrome";
const EXE = BIN[which];
const PORT = 9394;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const OUT = ROOT + "/_shots/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-personal-shot-"));
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

const profile = mkdtempSync(join(tmpdir(), "mb-personal-shot-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--force-device-scale-factor=1",
  "--window-size=1920,1080", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

const shot = async (call, ws, name) => {
  const s = await call("Page.captureScreenshot", { captureBeyondViewport: true });
  writeFileSync(OUT + which + "-" + name + ".png", Buffer.from(s.data, "base64"));
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
    .then((r) => (r.exceptionDetails ? Promise.reject(new Error(r.exceptionDetails.text)) : r.result && r.result.value));

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 预填示例数据
  await evalJS(`(() => {
    const t = (days, title, done, extra) => personal.todos.push({
      id: nextTodoId(), title, done, due: dayKey(-days), priority: 0,
      subtasks: [], tags: [], note: "", remind: "", createdAt: Date.now() - days * 86400000, ...extra
    });
    t(0, "复习极限计算章节", false, { priority: 3, tags: ["高数"], subtasks: [{ id: 1, title: "泰勒展开 10 题", done: true }, { id: 2, title: "洛必达 10 题", done: false }] });
    t(0, "背 100 个考研单词", false, { priority: 2, tags: ["英语"] });
    t(1, "完成线代矩阵练习", true, { priority: 2 });
    t(2, "整理本周错题", false, { tags: ["错题"] });
    personal.goals.push({ id: nextTodoId(), title: "考研初试", category: "学习", progress: 42, milestone: "完成高数一轮复习", targetDate: "2026-12-20", status: "active", linkedTodoIds: [], milestones: [{ id: 1, title: "完成高数一轮复习", done: true }, { id: 2, title: "完成线代一轮复习", done: false }], note: "", createdAt: Date.now() - 30 * 86400000 });
    personal.goals.push({ id: nextTodoId(), title: "毕业论文开题", category: "科研", progress: 18, milestone: "完成变量关系图与第一版研究假设", targetDate: "2026-11-30", status: "active", linkedTodoIds: [], milestones: [{ id: 3, title: "完成变量关系图", done: true }, { id: 4, title: "完成第一版研究假设", done: false }], note: "", createdAt: Date.now() - 20 * 86400000 });
    personal.inbox.push({ id: nextTodoId(), text: "周三前给导师发开题初稿", tags: ["论文"], status: "open", createdAt: Date.now() - 3600000 });
    personal.inbox.push({ id: nextTodoId(), text: "整理概率论错题到错题本", tags: ["高数"], status: "open", createdAt: Date.now() - 86400000 });
    personal.bookmarks.push({ id: nextTodoId(), title: "高数考研大纲 PDF", kind: "pdf", url: "/uploads/bm-demo.pdf", note: "2026 考研数学大纲，重点关注级数与多元积分", tags: ["高数", "考研"], createdAt: Date.now() - 86400000 });
    personal.bookmarks.push({ id: nextTodoId(), title: "KaTeX 官方文档", kind: "link", url: "https://katex.org/docs/supported.html", note: "写公式时查语法", tags: ["工具"], createdAt: Date.now() - 2 * 86400000 });
    personal.reviews.unshift({ day: dayKey(0), done: "复习高数极限 + 录入 5 道错题", stuck: "级数敛散性判断还不熟", plan: "上午线代矩阵，下午 408 数据结构", mood: "🙂", stats: { studySec: 7200, added: 5, reviewed: 9, todoDone: 2, todoTotal: 4 }, updatedAt: Date.now() });
    personal.reviews.unshift({ day: dayKey(-1), done: "完成英语阅读 2 篇", stuck: "论文选题还没定", plan: "查资料定方向", mood: "😐", stats: { studySec: 5400, added: 2, reviewed: 6, todoDone: 1, todoTotal: 3 }, updatedAt: Date.now() - 86400000 });
    persistLocal();
  })()`);
  await sleep(400);

  await evalJS(`go("todos"); true`); await sleep(500);
  await shot(call, ws, "todos");
  await evalJS(`setTodoView("board"); true`); await sleep(400);
  await shot(call, ws, "todos-board");
  await evalJS(`go("goals"); true`); await sleep(500);
  await shot(call, ws, "goals");
  await evalJS(`go("summary"); true`); await sleep(500);
  await shot(call, ws, "summary");
  await evalJS(`go("inbox"); true`); await sleep(500);
  await shot(call, ws, "inbox");
  await evalJS(`go("calendar"); true`); await sleep(500);
  await shot(call, ws, "calendar");
  await evalJS(`go("daily"); true`); await sleep(500);
  await shot(call, ws, "daily");
  await evalJS(`go("hot"); loadHot(); true`); await sleep(3000);
  await shot(call, ws, "hot");
  await evalJS(`go("bookmarks"); true`); await sleep(500);
  await shot(call, ws, "bookmarks");
  await evalJS(`go("dashboard"); true`); await sleep(500);
  await shot(call, ws, "dashboard-overview");

  const diag = await evalJS(`(() => ({
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
    views: ["todos","goals","summary","inbox","calendar","daily","hot","bookmarks"].map(v => !!document.getElementById("view-" + v))
  }))()`);
  console.log(which + " PERSONAL DIAG: " + JSON.stringify(diag));
  ws.close();
} catch (e) {
  console.error(which + " 个人页截图异常:", e.message);
} finally {
  browser.kill();
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { /* ignore */ }
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { /* ignore */ }
}
