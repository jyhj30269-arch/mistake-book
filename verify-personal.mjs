/* v1.11.0 个人工作台功能检查：node verify-personal.mjs */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9401;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-personal-"));
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

const profile = mkdtempSync(join(tmpdir(), "mb-personal-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--force-device-scale-factor=1",
  "--window-size=1600,1000", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
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
    .then((r) => (r.exceptionDetails
      ? Promise.reject(new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
      : r.result && r.result.value));

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 1) 改名 + 侧边栏分组
  const nav = await evalJS(`(() => ({
    brand: document.querySelector(".brand-name").textContent.trim(),
    title: document.title,
    items: Array.from(document.querySelectorAll(".nav-item")).map(a => a.textContent.trim())
  }))()`);
  check("品牌名 = 个人工作台", nav.brand === "个人工作台");
  check("浏览器标题 = 个人工作台", nav.title.includes("个人工作台"));
  check("个人分组含待办/目标/总结/健康/复盘",
    ["今日待办", "目标与规划", "周月总结", "运动健康", "今日复盘"].every(x => nav.items.some(t => t.includes(x))));
  check("学习分组含识别录入/题库", nav.items.some(t => t.includes("识别录入")) && nav.items.some(t => t.includes("题库")));

  // 2) 仪表盘今日概览
  const ov = await evalJS(`(() => ({ todo: document.getElementById("ov-todo").textContent, review: document.getElementById("ov-review").textContent }))()`);
  check("仪表盘今日概览渲染", ov.todo.includes("/") && ov.review !== "");

  // 3) 待办：添加 → 完成 → 删除
  await evalJS(`go("todos"); addTodo(); document.getElementById("todo-input").value = "复习极限计算"; addTodo(); true`);
  const todoCount = await evalJS(`personal.todos.length`);
  check("待办添加成功", todoCount === 1);
  const todoId = await evalJS(`personal.todos[0].id`);
  await evalJS(`toggleTodo(${todoId}); true`);
  const todoDone = await evalJS(`personal.todos[0].done`);
  check("待办完成打勾", todoDone === true);
  await evalJS(`delTodo(${todoId}); true`);
  check("待办删除成功", await evalJS(`personal.todos.length`) === 0);

  // 4) 目标：添加 → 进度调整 → 编辑
  await evalJS(`go("goals"); document.getElementById("goal-input").value = "考研初试"; addGoal(); true`);
  check("目标添加成功", (await evalJS(`personal.goals.length`)) === 1);
  const goalId = await evalJS(`personal.goals[0].id`);
  await evalJS(`goalProgress(${goalId}, 10); goalProgress(${goalId}, 10); true`);
  check("目标进度 +20%", (await evalJS(`personal.goals[0].progress`)) === 20);
  await evalJS(`editGoal(${goalId}); document.getElementById("eg-milestone").value = "完成第一轮复习"; saveGoalEdit(${goalId}); true`);
  check("目标里程碑可编辑", (await evalJS(`personal.goals[0].milestone`)) === "完成第一轮复习");

  // 5) 健康：保存目标 + 打卡
  await evalJS(`go("health"); document.getElementById("health-times").value = "3"; document.getElementById("health-minutes").value = "120"; saveHealthGoal(); healthLog(1, 0); healthLog(0, 30); true`);
  const health = await evalJS(`({ goal: personal.healthGoal, today: personal.health.find(h => h.day === dayKey()) })`);
  check("健康周目标保存", health.goal.times === 3 && health.goal.minutes === 120);
  check("健康今日打卡", health.today && health.today.sportTimes === 1 && health.today.sportMinutes === 30);

  // 6) 复盘：填写保存
  await evalJS(`go("daily"); document.getElementById("rv-done").value = "复习高数"; document.getElementById("rv-stuck").value = "级数"; pickMood($$("#rv-mood .chip")[1]); saveDailyReview(); true`);
  const rv = await evalJS(`personal.reviews[0]`);
  check("今日复盘保存", rv && rv.done === "复习高数" && rv.stuck === "级数" && rv.mood === "🙂");

  // 7) 周月总结
  await evalJS(`go("summary"); true`);
  const summaryCards = await evalJS(`document.querySelectorAll("#summary-cards .stat-card").length`);
  check("周月总结渲染 4 卡", summaryCards === 4);

  // 8) 持久化：刷新后 personal 仍在
  await call("Page.reload", { ignoreCache: true });
  await sleep(1800);
  const after = await evalJS(`({ goals: personal.goals.length, health: personal.health.length, reviews: personal.reviews.length })`);
  check("刷新后个人数据持久化", after.goals === 1 && after.health === 1 && after.reviews === 1);

} catch (e) {
  console.error("FAIL 脚本异常:", e.message);
  failures++;
} finally {
  browser.kill();
  server.kill();
  await sleep(400);
  rmSync(testDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} 项失败 ✘` : "\n个人工作台功能检查全部通过 ✔");
process.exit(failures ? 1 : 0);
