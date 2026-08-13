/* v1.18.0 新功能检查（基于 test-helper 基建）：node verify-v18.mjs
   覆盖：考试倒计时+冲刺 / 日历到期角标 / 键盘快捷键 / 词汇 TTS /
   遗忘曲线 / 批量删除导出 / 组卷难度配比 / 每日习惯打卡 / 周报导出 /
   今日学习计划 / 模块开关持久化 */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9397;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;

const server = startServer(PORT, "v18");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v18");
const { check, abort, report } = makeCheck("v1.18.0 功能检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 1) 考试倒计时 + 冲刺模式
  await client.evalJS(`examDate = ""; renderDashboard(); true`);
  const hidden = await client.evalJS(`document.getElementById("exam-countdown").style.display === "none"`);
  check("倒计时：未设置日期时隐藏", hidden);
  await client.evalJS(`examDate = "2027-12-25"; renderDashboard(); true`);
  const cd = await client.evalJS(`document.getElementById("exam-countdown").textContent`);
  check("倒计时：横幅显示剩余天数", cd.includes("2027-12-25") && /\d+ 天/.test(cd));
  await client.evalJS(`examDate = "${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}"; renderDashboard(); true`);
  const sprint = await client.evalJS(`document.getElementById("exam-countdown").textContent`);
  check("冲刺模式：≤60 天提示冲刺", sprint.includes("冲刺模式"));

  // 2) 今日学习计划
  const plan = await client.evalJS(`(() => { renderTodayPlan(); const t = document.getElementById("today-plan").textContent; return { has1: t.includes("复习到期题"), has2: t.includes("攻克薄弱知识点"), has3: t.includes("录入新题") }; })()`);
  check("今日计划：三项任务渲染", plan.has1 && plan.has2 && plan.has3);

  // 3) 日历到期角标
  const cal = await client.evalJS(`(() => {
    go("calendar");
    const dueBadge = document.querySelectorAll(".cal-badge.due").length;
    return dueBadge;
  })()`);
  check("日历：到期题 🔥 角标渲染", cal >= 1);

  // 4) 键盘快捷键（空格翻答案）
  const hotkey = await client.evalJS(`(() => {
    go("dashboard");
    document.getElementById("review-play").style.display = "";
    const q = questions.find(x => x.id === 1);
    reviewQueue = [q]; reviewIdx = 0; reviewDone = new Set(); reviewSkipped = new Set();
    showReviewCard();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    return document.getElementById("rev-answer").style.display !== "none";
  })()`);
  check("快捷键：空格显示答案", hotkey);

  // 5) 词汇 TTS 按钮
  const tts = await client.evalJS(`(() => {
    const q = questions.find(x => x.id === 11);
    reviewQueue = [q]; reviewIdx = 0; reviewDone = new Set(); reviewSkipped = new Set();
    showReviewCard();
    return document.getElementById("rev-tts-wrap").style.display !== "none";
  })()`);
  check("TTS：词汇题复习卡显示发音按钮", tts);

  // 6) 遗忘曲线（详情页，≥2 条复习记录）
  const curve = await client.evalJS(`(() => {
    openDetail(1);
    return !!document.getElementById("detail-curve") && document.querySelectorAll("#detail-curve canvas").length >= 1;
  })()`);
  check("遗忘曲线：详情页曲线已渲染", curve);

  // 7) 批量删除 / 批量导出按钮与流程
  const batch = await client.evalJS(`(() => {
    go("questions");
    qSel.clear(); qSel.add(1); qSel.add(2);
    renderQuestions();
    const delShown = document.getElementById("q-del-btn").style.display !== "none";
    const expShown = document.getElementById("q-export-btn").style.display !== "none";
    return { delShown, expShown };
  })()`);
  check("批量操作：勾选后删除/导出按钮可见", batch.delShown && batch.expShown);
  const before = await client.evalJS(`questions.length`);
  await client.evalJS(`qSel.clear(); qSel.add(1); qSel.add(2); batchDeleteQuestions(); true`);
  await client.evalJS(`document.getElementById("batch-del-confirm").value = "删除"; doBatchDeleteQuestions(); true`);
  await sleep(400);
  const after = await client.evalJS(`questions.length`);
  check("批量删除：2 题已删除", before - after === 2);

  // 8) 组卷难度配比控件
  const pp = await client.evalJS(`(() => { openPaperExport(); return { hasRatio: !!document.getElementById("pp-err-ratio"), val: document.getElementById("pp-err-ratio").value }; })()`);
  check("组卷：难度配比滑块存在（默认 50%）", pp.hasRatio && pp.val === "50");
  await client.evalJS(`closeModal(); true`);

  // 9) 每日习惯打卡全链路
  await client.evalJS(`go("dashboard"); addHabit(); true`);
  await client.evalJS(`document.getElementById("habit-name").value = "背 50 个单词"; doAddHabit(); true`);
  await sleep(400);
  const habitAdd = await client.evalJS(`habits.length === 1 && habits[0].name === "背 50 个单词"`);
  check("习惯：添加成功", habitAdd);
  await client.evalJS(`toggleHabit(habits[0].id, true); true`);
  await sleep(300);
  const habitDone = await client.evalJS(`habits[0].doneDays.length === 1`);
  check("习惯：今日打卡成功", habitDone);
  await client.call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const habitPersist = await client.evalJS(`habits.length === 1 && habits[0].doneDays.length === 1`);
  check("习惯：刷新后持久化", habitPersist);

  // 10) 学情周报导出（不抛错即通过）
  const reportOk = await client.evalJS(`(() => { try { exportLearnReport(); return true; } catch (e) { return "ERR:" + e.message; } })()`);
  check("学情周报：Markdown 导出不抛错", reportOk === true);

  // 11) 模块开关：隐藏热点资讯并持久化
  await client.evalJS(`toggleModule("hot", false); true`);
  await sleep(400);
  const hiddenNav = await client.evalJS(`document.querySelector('.nav-item[data-view="hot"]').style.display === "none"`);
  check("模块开关：热点资讯导航已隐藏", hiddenNav);
  await client.call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const hiddenPersist = await client.evalJS(`moduleOn.hot === false && document.querySelector('.nav-item[data-view="hot"]').style.display === "none"`);
  check("模块开关：刷新后仍隐藏", hiddenPersist);
  await client.evalJS(`toggleModule("hot", true); true`);

  // 12) 运行时异常
  check("无运行时异常", client.errors.length === 0);

  client.close();
} catch (e) {
  abort(e.message);
} finally {
  await browser.stop();
  await server.stop();
}
report();
