/* v1.13.0 个人工作台功能检查：node verify-personal.mjs
   覆盖：仪表盘总览 / 待办升级（快速解析·子任务·看板）/ 目标升级（里程碑·挂待办）/
   收件箱（转待办）/ 日历 / 复盘自动附带数据 / 周月总结（心情趋势）/
   复习三级筛选 / 收藏夹 / 热点资讯 / 试卷导出 / 健康移除 / 持久化 */
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

  // 1) 品牌 + 侧边栏分组（健康移除、新增收件箱/日历）
  const nav = await evalJS(`(() => ({
    brand: document.querySelector(".brand-name").textContent.trim(),
    title: document.title,
    groups: Array.from(document.querySelectorAll(".nav-group")).map(a => a.textContent.trim()),
    items: Array.from(document.querySelectorAll(".nav-item")).map(a => a.textContent.trim()),
    tabs: Array.from(document.querySelectorAll(".mobile-tabbar a")).map(a => a.textContent.trim()),
    noHealthNode: !document.querySelector('[data-view="health"]') && !document.querySelector("#view-health")
  }))()`);
  check("品牌名 = 个人工作台", nav.brand === "个人工作台");
  check("浏览器标题 = 个人工作台", nav.title.includes("个人工作台"));
  check("侧边栏分组 = 总览/计划与复盘/学习/系统",
    ["总览", "计划与复盘", "学习", "资讯与资料", "系统"].every(x => nav.groups.includes(x)));
  check("新增收件箱/日历导航",
    nav.items.some(t => t.includes("收件箱")) && nav.items.some(t => t.includes("日历")));
  check("健康模块已移除",
    !nav.items.some(t => t.includes("健康")) && nav.noHealthNode);
  check("新增热点资讯 / 收藏夹导航",
    nav.items.some(t => t.includes("热点资讯")) && nav.items.some(t => t.includes("收藏夹")));
  check("移动 Tab 仍 5 项", nav.tabs.length === 5);
  const mobileMenu = await evalJS(`(() => ({
    drawer: !!document.getElementById("mobile-menu"),
    moreTab: Array.from(document.querySelectorAll(".mobile-tabbar a")).some(a => a.textContent.includes("更多")),
    hasSettings: Array.from(document.querySelectorAll("#mobile-menu .nav-item")).some(a => a.dataset.view === "settings"),
    hasGoals: Array.from(document.querySelectorAll("#mobile-menu .nav-item")).some(a => a.dataset.view === "goals"),
    hasHot: Array.from(document.querySelectorAll("#mobile-menu .nav-item")).some(a => a.dataset.view === "hot")
  }))()`);
  check("移动端：更多抽屉含 设置/目标/热点", mobileMenu.drawer && mobileMenu.moreTab && mobileMenu.hasSettings && mobileMenu.hasGoals && mobileMenu.hasHot);

  // 2) 仪表盘总览
  const ov = await evalJS(`(() => ({
    greeting: document.getElementById("dash-greeting").textContent.length > 5,
    cards: document.querySelectorAll("#ov-grid .stat-card").length,
    quick: document.querySelectorAll("#dash-quick .quick-action").length,
    goals: !!document.getElementById("dash-goals").textContent,
    todos: !!document.getElementById("dash-todos").textContent,
    feed: !!document.getElementById("dash-feed").textContent
  }))()`);
  check("仪表盘：问候语渲染", ov.greeting);
  check("仪表盘：概览卡 4 张", ov.cards === 4);
  check("仪表盘：快捷入口 4 个", ov.quick === 4);
  check("仪表盘：目标进度 / 今日待办 / 动态流渲染", ov.goals && ov.todos && ov.feed);

  // 3) 待办升级：快速解析 / 字段 / 子任务 / 看板
  const parsed = await evalJS(`(() => {
    const r = parseQuickAdd("下周五交报告 #工作 !高");
    const d = new Date(); const cur = (d.getDay() + 6) % 7;
    const add = n => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
    const nextMon = ((7 - cur) % 7) || 7;
    return { ok: r.due === add(nextMon + 4), title: r.title, tags: r.tags, priority: r.priority, due: r.due };
  })()`);
  check("快速解析：下周五日期精确 + 标题/标签/优先级", parsed.ok && parsed.title === "交报告" && parsed.tags[0] === "工作" && parsed.priority === 3);
  const keepBang = await evalJS(`parseQuickAdd("给老师发邮件!要加附件")`);
  check("快速解析：非优先级 ! 内容保留", keepBang.title === "给老师发邮件!要加附件" && keepBang.priority === 0);
  await evalJS(`go("todos"); document.getElementById("todo-input").value = "周五交报告 #工作 !高"; addTodo(); true`);
  const t0 = await evalJS(`personal.todos[0]`);
  check("待办：解析后入库（标题/标签/优先级/截止）",
    t0.title === "交报告" && t0.tags[0] === "工作" && t0.priority === 3 && t0.due !== "");
  await evalJS(`editTodo(${t0.id}); document.getElementById("et-sub-input").value = "写提纲"; addTodoSub(${t0.id}); true`);
  const sub = await evalJS(`personal.todos[0].subtasks[0]`);
  check("待办：子任务可添加", !!sub && sub.title === "写提纲");
  await evalJS(`toggleTodoSub(${t0.id}, ${sub.id}); closeModal(); true`);
  check("待办：子任务完成打勾", (await evalJS(`personal.todos[0].subtasks[0].done`)) === true);
  await evalJS(`setTodoView("board"); true`);
  check("待办：看板视图渲染", await evalJS(`!!document.querySelector(".todo-board")`));
  await evalJS(`toggleTodo(${t0.id}); setTodoView("list"); true`);
  check("待办：完成打勾", (await evalJS(`personal.todos[0].done`)) === true);
  await evalJS(`delTodo(${t0.id}); true`);
  check("待办：删除成功", (await evalJS(`personal.todos.length`)) === 0);

  // 4) 目标升级：状态 / 里程碑自动进度 / 挂待办
  await evalJS(`go("goals"); document.getElementById("goal-input").value = "考研初试"; addGoal(); true`);
  const g0 = await evalJS(`personal.goals[0]`);
  check("目标：添加成功且默认进行中", g0.title === "考研初试" && g0.status === "active");
  await evalJS(`editGoal(${g0.id}); document.getElementById("eg-ms-input").value = "完成第一轮复习"; addGoalMilestone(${g0.id}); true`);
  const ms0 = await evalJS(`personal.goals[0].milestones[0]`);
  check("目标：里程碑可添加", !!ms0 && ms0.title === "完成第一轮复习");
  await evalJS(`toggleGoalMilestone(${g0.id}, ${ms0.id}); closeModal(); true`);
  check("目标：里程碑完成自动推进度 100%", (await evalJS(`goalAutoProgress(personal.goals[0])`)) === 100);
  await evalJS(`document.getElementById("goal-input").value = "买资料"; addGoal(); document.getElementById("goal-input").value = "联系导师"; addGoal(); true`);
  await evalJS(`go("todos"); document.getElementById("todo-input").value = "整理概率论错题"; addTodo(); go("goals"); true`);
  const linkedTodo = await evalJS(`personal.todos[0]`);
  await evalJS(`editGoal(${g0.id}); toggleGoalTodoLink(${g0.id}, ${linkedTodo.id}); closeModal(); true`);
  check("目标：可挂待办并保留关联", (await evalJS(`personal.goals[0].linkedTodoIds.includes(${linkedTodo.id})`)));

  // 5) 收件箱：随手记 → 转待办
  await evalJS(`go("inbox"); document.getElementById("inbox-input").value = "周三前给导师发初稿 #论文"; addInboxItem(); true`);
  const it0 = await evalJS(`personal.inbox[0]`);
  check("收件箱：文本保留且 #标签提取", it0.text === "周三前给导师发初稿" && it0.tags[0] === "论文");
  await evalJS(`inboxToTodo(${it0.id}); document.getElementById("it-due").value = "today"; doInboxToTodo(${it0.id}); true`);
  const afterConv = await evalJS(`(() => {
    const t = personal.todos[0], it = personal.inbox[0];
    return { ok: t.title === "周三前给导师发初稿" && t.due === dayKey() && it.status === "done" };
  })()`);
  check("收件箱：转待办成功且状态已转出",
    afterConv.ok);

  // 6) 日历
  await evalJS(`go("calendar"); true`);
  const cal = await evalJS(`({ cells: document.querySelectorAll("#cal-grid .cal-cell").length, head: document.getElementById("cal-head").textContent.includes(new Date().getFullYear()) })`);
  check("日历：月网格渲染", cal.cells > 20 && cal.head);
  await evalJS(`calPick(dayKey()); true`);
  check("日历：点击日期显示详情", (await evalJS(`document.getElementById("cal-detail").textContent.length > 5`)));

  // 7) 复盘升级：保存自动附带当天数据 + 周汇总
  await evalJS(`go("daily"); document.getElementById("rv-done").value = "复习高数"; document.getElementById("rv-stuck").value = "级数"; pickMood($$("#rv-mood .chip")[1]); saveDailyReview(); true`);
  const rv = await evalJS(`personal.reviews[0]`);
  check("复盘：保存成功且自动附带 stats", rv.done === "复习高数" && rv.stats && typeof rv.stats.studySec === "number" && typeof rv.stats.added === "number");
  check("复盘：周汇总渲染", await evalJS(`!!document.getElementById("rv-week").textContent`));

  // 8) 周月总结：4 卡 + 心情趋势（不再有运动）
  await evalJS(`go("summary"); true`);
  const summary = await evalJS(`({ cards: document.querySelectorAll("#summary-cards .stat-card").length, hasHealth: document.querySelectorAll("#summary-health .small").length > 0 || !!document.querySelector("#mood-chart") })`);
  check("周月总结：渲染 4 卡", summary.cards === 4);
  check("周月总结：心情趋势区存在", summary.hasHealth);

  // 9) 复习科目三级筛选（科目 → 子科目 → 章节）
  await evalJS(`go("dashboard"); renderReviewConfig(); true`);
  const rev = await evalJS(`(() => ({
    subjects: Array.from(document.querySelectorAll("#rev-subject option")).map(o => o.textContent),
    subsubCount: document.querySelectorAll("#rev-subsub option").length,
    subjectVal: reviewCfg.subject
  }))()`);
  check("复习：科目筛选含 数学/英语/408", rev.subjects.some(t => t.includes("数学")) && rev.subjects.some(t => t.includes("英语")) && rev.subjects.some(t => t.includes("408")));
  check("复习：子科目联动渲染", rev.subsubCount > 0);
  await evalJS(`document.getElementById("rev-subject").value = "subj-math"; document.getElementById("rev-subject").onchange({ target: { value: "subj-math" } }); true`);
  const subOptions = await evalJS(`Array.from(document.querySelectorAll("#rev-subsub option")).map(o => o.textContent).join(",")`);
  check("复习：选数学后子科目为高等数学等", subOptions.includes("高等数学"));

  // 10) 收藏夹：添加链接收藏
  await evalJS(`go("bookmarks"); document.getElementById("bm-title").value = "高数公式手册"; document.getElementById("bm-kind").value = "link"; document.getElementById("bm-url").value = "https://example.com/math.pdf"; document.getElementById("bm-tags").value = "高数 复习资料"; addBookmark(); true`);
  const bm0 = await evalJS(`personal.bookmarks[0]`);
  check("收藏夹：链接收藏成功", bm0.title === "高数公式手册" && bm0.kind === "link" && bm0.tags.includes("高数"));
  check("收藏夹：列表渲染", await evalJS(`document.querySelectorAll("#bm-list .bm-item").length >= 1`));

  // 11) 热点资讯页
  await evalJS(`go("hot"); true`);
  const hotDom = await evalJS(`(() => ({
    tabs: Array.from(document.querySelectorAll("#hot-tabs .chip")).map(c => c.textContent.trim()),
    hasList: !!document.getElementById("hot-list"),
    fn: typeof loadHot === "function" && typeof setHotTab === "function"
  }))()`);
  check("热点资讯：4 个 Tab + 列表容器", hotDom.tabs.length === 4 && hotDom.hasList && hotDom.fn);
  const hotLive = await evalJS(`API.hotItems({ window: "24h", limit: 3 }).then(d => (d.items || []).length).catch(() => -1)`);
  check("热点资讯：AI HOT 接口可拉取", hotLive > 0);
  await evalJS(`setHotTab("daily"); true`); await sleep(2500);
  check("热点：AI 日报有内容", await evalJS(`!document.getElementById("hot-list").innerText.includes("暂无日报内容")`));

  // 12) 试卷导出弹窗
  await evalJS(`openPaperExport(); true`);
  const pp = await evalJS(`(() => ({
    title: document.getElementById("modal-title").textContent,
    num: document.getElementById("pp-num").value,
    hasSubject: !!document.getElementById("pp-subject")
  }))()`);
  check("试卷导出：弹窗默认 12 题 + 科目筛选", pp.title.includes("导出试卷") && pp.num === "12" && pp.hasSubject);
  await evalJS(`closeModal(); true`);

  // 13) 持久化：刷新后 personal 仍在
  await call("Page.reload", { ignoreCache: true });
  await sleep(1800);
  const after = await evalJS(`({ todos: personal.todos.length, goals: personal.goals.length, inbox: personal.inbox.length, reviews: personal.reviews.length, bookmarks: personal.bookmarks.length })`);
  check("刷新后个人数据持久化", after.todos === 2 && after.goals === 3 && after.inbox === 1 && after.reviews === 1 && after.bookmarks === 1);

  ws.close();
} catch (e) {
  console.error("FAIL 脚本异常:", e.message);
  failures++;
} finally {
  browser.kill();
  server.kill();
  await sleep(400);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时数据库失败（可忽略）:", e.message); }
}

console.log(failures ? `\n${failures} 项失败 ✘` : "\n个人工作台功能检查全部通过 ✔");
process.exit(failures ? 1 : 0);
