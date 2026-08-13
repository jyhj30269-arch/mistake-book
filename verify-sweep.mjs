/* 全页面走查（拆分完整性动态检查）：遍历全部视图与关键交互，监控运行时异常。
   node verify-sweep.mjs */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9402;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;

const server = startServer(PORT, "sweep");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "sweep");
const { check, abort, report } = makeCheck("全页面走查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 1) 遍历全部视图（含 window 函数引用完整性：go() 内部调用各 renderXxx）
  const views = ["dashboard", "todos", "goals", "calendar", "inbox", "daily", "summary", "input", "questions", "hot", "bookmarks", "settings", "detail"];
  const viewResults = [];
  for (const v of views) {
    const r = await client.evalJS(`(() => {
      try { go("${v}"); return { ok: true }; }
      catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
    })()`);
    await sleep(250);
    viewResults.push(`${v}:${r.ok ? "ok" : "ERR " + r.err}`);
  }
  const allViewsOk = viewResults.every(x => x.includes(":ok"));
  check("13 个视图切换无异常", allViewsOk);
  if (!allViewsOk) viewResults.forEach(x => console.log("  ", x));

  // 2) 详情页（含遗忘曲线 + TTS 按钮）
  const detail = await client.evalJS(`(() => {
    try { openDetail(1); const hasCurve = !!document.getElementById("detail-curve"); return { ok: true, hasCurve }; }
    catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("详情页渲染 + 遗忘曲线", detail.ok && detail.hasCurve);

  // 3) 复习全流程（配置→抽题→显示答案→自评→小结）
  const review = await client.evalJS(`(() => {
    try {
      go("dashboard");
      renderReviewConfig();
      startReview();
      if (reviewQueue.length === 0) return { ok: false, err: "空队列" };
      showReviewCard();
      revealAnswer();
      selfRate("ok");
      const progress = document.getElementById("rev-progress").textContent;
      return { ok: true, progress };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("复习全流程（抽题→答案→自评）", review.ok);

  // 4) 复习集 / 习惯 / 计划 / 倒计时渲染
  const dash = await client.evalJS(`(() => {
    try {
      go("dashboard");
      renderReviewSets();
      renderHabitsPanel();
      renderTodayPlan();
      renderExamCountdown();
      const sets = document.getElementById("review-sets-list").textContent.length >= 0;
      const plan = document.getElementById("today-plan").textContent.includes("录入新题");
      return { ok: sets && plan };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("仪表盘复习集/习惯/计划/倒计时渲染", dash.ok);

  // 5) 题库筛选/搜索/分页/批量按钮
  const q = await client.evalJS(`(() => {
    try {
      go("questions");
      qPage = 1; renderQuestions();
      const rows1 = document.querySelectorAll("#q-body tr").length;
      loadMoreQuestions();
      const rows2 = document.querySelectorAll("#q-body tr").length;
      document.getElementById("q-search").value = "极限";
      qPage = 1; renderQuestions();
      const searched = document.querySelectorAll("#q-body tr").length;
      document.getElementById("q-search").value = "";
      return { ok: rows1 > 0 && rows2 >= rows1 && searched > 0 };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("题库渲染/分页/搜索", q.ok);

  // 6) 设置页（OCR 配置 / 考试日期 / 模块开关 / 知识点树）
  const settings = await client.evalJS(`(() => {
    try {
      go("settings");
      const hasExam = !!document.getElementById("exam-date");
      const hasMod = !!document.getElementById("mod-hot");
      const treeLen = document.getElementById("settings-tree").textContent.length;
      return { ok: hasExam && hasMod && treeLen > 100 };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("设置页（倒计时/模块开关/知识点树）", settings.ok);

  // 7) 待办/目标/收件箱/复盘交互
  const personal = await client.evalJS(`(() => {
    try {
      go("todos");
      addTodo(); document.getElementById("todo-input").value = "走查待办"; addTodo();
      go("goals");
      addGoal(); document.getElementById("goal-input").value = "走查目标"; addGoal();
      go("inbox");
      addInboxItem(); document.getElementById("inbox-input").value = "走查想法"; addInboxItem();
      go("daily");
      saveDailyReview();
      go("calendar");
      renderCalendar();
      return { ok: personal.todos.some(t => t.title === "走查待办") && personal.goals.some(g => g.title === "走查目标") && personal.inbox.some(i => i.text === "走查想法") };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  })()`);
  check("待办/目标/收件箱/复盘/日历交互", personal.ok);

  // 8) 模块开关（隐藏+恢复）
  const mod = await client.evalJS(`(() => {
    try {
      toggleModule("bookmarks", false);
      const hidden = document.querySelector('.nav-item[data-view="bookmarks"]').style.display === "none";
      toggleModule("bookmarks", true);
      const shown = document.querySelector('.nav-item[data-view="bookmarks"]').style.display !== "none";
      return hidden && shown;
    } catch (e) { return false; }
  })()`);
  check("模块开关隐藏/恢复", mod === true);

  // 9) 键盘快捷键（复习卡）
  const key = await client.evalJS(`(() => {
    try {
      go("dashboard");
      document.getElementById("review-play").style.display = "";
      const q = questions.find(x => x.id === 1);
      reviewQueue = [q]; reviewIdx = 0; reviewDone = new Set(); reviewSkipped = new Set();
      showReviewCard();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      const ansShown = document.getElementById("rev-answer").style.display !== "none";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "4" }));
      const rated = reviewDone.size === 1;
      return ansShown && rated;
    } catch (e) { return false; }
  })()`);
  check("键盘快捷键（空格+数字自评）", key === true);

  // 10) 运行时异常（全页面走查期间）
  check("全程无未捕获异常", client.errors.length === 0);
  if (client.errors.length) client.errors.slice(0, 10).forEach(e => console.log("  ERR:", e));

  client.close();
} catch (e) {
  abort(e.message);
} finally {
  await browser.stop();
  await server.stop();
}
report();
