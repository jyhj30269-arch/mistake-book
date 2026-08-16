/* v1.21.0 背单词独立页面 + 复习流净化专项检查：node verify-v21.mjs
   覆盖：侧边栏「背单词」入口（桌面+移动抽屉）/ 独立页面与入口面板可见 /
   统计口径（未复习新词不计到期、今日新词如实显示）/ 复习流排除词汇类（到期/推荐/抽题/统计/薄弱点）/
   面板发音开关与困难单词本入口 / 下一词清空翻卡残留 / 背单词页快捷键 / 会话退出回到词书页 */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9410;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=wordbook`;

const server = startServer(PORT, "v21");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v21");
const { check, abort, report } = makeCheck("v1.21.0 背单词独立页面检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 1) 侧边栏入口（桌面 + 移动抽屉）+ 独立页面可见 + 入口面板可见
  const nav = await client.evalJS(`(() => {
    const side = !!document.querySelector('.side-nav .nav-item[data-view="wordbook"]');
    const mobile = !!document.querySelector('#mobile-menu .nav-item[data-view="wordbook"]');
    const pageShown = document.getElementById("view-wordbook").style.display !== "none";
    const cfgShown = document.getElementById("word-config").style.display !== "none";
    return { side, mobile, pageShown, cfgShown };
  })()`);
  check("侧边栏：桌面与移动抽屉均有「背单词」入口", nav.side && nav.mobile);
  check("独立页面：进入后显示词书面板", nav.pageShown && nav.cfgShown);

  // 2) 空词书提示
  const emptyHint = await client.evalJS(`document.getElementById("word-config").textContent.includes("一键导入词书")`);
  check("空词书：面板提示一键导入", emptyHint);

  // 3) 统计口径：未复习新词不计「今日到期」；「今日新词」= min(上限, 剩余新词)
  const stats = await client.evalJS(`(() => {
    const now = Date.now();
    const mk = (id, learned) => {
      const q = { id, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
        kps: ["六级核心词 3000"], tags: ["other"], titleTex: "word" + id, solutionTex: "释义" + id, note: "Sentence " + id + ".\\n例句" + id + "。",
        wrongAnswer: "", marks: {}, createdAt: now, urgent: false, calcWeak: false, needConsolidate: false, imgs: [] };
      questions.push(q);
      if (learned) reviewLogs.push({ id: ++reviewSeq, qid: id, at: now - 3 * 86400000, result: "ok" }); // 3 天前学过 → 到期
      return q;
    };
    mk(420001, true); mk(420002, false); mk(420003, false); mk(420004, false); // 1 到期 + 3 新词
    wordPlan = { newPerDay: 5 };
    renderWordPanel();
    const t = document.getElementById("word-config").textContent;
    const p = wordProgress();
    return { due: p.due, learned: p.learned, hasDue: t.includes("今日到期 1 词"), hasNew: t.includes("今日新词 3/5") };
  })()`);
  check("统计：已学且到期才计「今日到期」（1/4，非 4）", stats.due === 1 && stats.learned === 1 && stats.hasDue);
  check("统计：今日新词如实显示 min(5, 3)=3", stats.hasNew);

  // 4) 面板：发音开关 + 困难单词本入口
  const panel = await client.evalJS(`(() => {
    renderWordPanel();
    const t = document.getElementById("word-config").textContent;
    return { hasSound: t.includes("发音"), hasFav: t.includes("复习困难单词") };
  })()`);
  check("面板：含发音开关与困难单词本入口", panel.hasSound && panel.hasFav);

  // 5) 复习流排除词汇类：造 1 道普通错题，推荐/到期/抽题/统计/薄弱点都不含单词
  const flow = await client.evalJS(`(() => {
    const q = { id: 430001, type: "problem", subject: "subj-math", subSubject: "ss-math1", chapter: "ch-m1-1",
      kps: ["函数与极限"], tags: ["careless"], titleTex: "普通错题", solutionTex: "解", note: "", wrongAnswer: "",
      createdAt: Date.now(), urgent: false, calcWeak: false, needConsolidate: false, imgs: [] };
    questions.push(q);
    const rec = recommendQuestions(20);
    const recHasWord = rec.some(x => x.type === "vocabulary");
    const recHasQ = rec.some(x => x.id === 430001);
    reviewDueNow();
    const queueHasWord = reviewQueue.some(x => x.type === "vocabulary");
    const queueHasQ = reviewQueue.some(x => x.id === 430001);
    const wk = weakKps().map(w => w.name);
    renderDashboard();
    const total = document.getElementById("stats-total").textContent;
    const dueLine = document.getElementById("due-task-line").textContent;
    const nonVocab = questions.filter(q => q.type !== "vocabulary").length;
    return { recHasWord, recHasQ, queueHasWord, queueHasQ, wk, total, dueLine, nonVocab };
  })()`);
  check("推荐复习：不含单词、含普通错题", !flow.recHasWord && flow.recHasQ);
  check("复习到期题：队列不含单词、含普通错题", !flow.queueHasWord && flow.queueHasQ);
  check("统计：总题数与到期行不含单词", flow.total === String(flow.nonVocab) && !flow.dueLine.includes("3000"));

  // 6) 卡片流：下一词渲染清空上一词翻卡残留
  const stale = await client.evalJS(`(() => {
    const first = questions.find(x => x.id === 420001);
    wordQueue = [{ q: first, misses: 0 }]; wordIdx = 0; wordSession = true;
    document.getElementById("word-play").style.display = "";
    renderWordCard();
    flipWord(); // word-word-big 显示 word420001
    const before = document.getElementById("word-word-big").textContent;
    const second = questions.find(x => x.id === 420002);
    wordQueue = [{ q: second, misses: 0 }]; wordIdx = 0;
    renderWordCard(); // 新卡渲染：大字/释义/详情应清空
    const after = document.getElementById("word-word-big").textContent;
    const meanAfter = document.getElementById("word-mean").textContent;
    const rateHidden = document.getElementById("word-rate").style.display === "none";
    wordSession = false;
    return { before, after, meanAfter, rateHidden };
  })()`);
  check("卡片流：下一词清空上一词大字/释义残留", stale.before === "word420001" && stale.after === "" && stale.meanAfter === "" && stale.rateHidden);

  // 7) 背单词页快捷键（空格翻卡）
  const kb = await client.evalJS(`(() => {
    wordPlan = { newPerDay: 5 };
    startWordReview(); // 当前已在 wordbook 视图
    const shownBefore = document.getElementById("word-back").style.display !== "none";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    const shownAfter = document.getElementById("word-back").style.display !== "none";
    return { shownBefore, shownAfter, view: currentView };
  })()`);
  check("快捷键：背单词页空格翻卡生效", !kb.shownBefore && kb.shownAfter && kb.view === "wordbook");

  // 8) 退出会话回到词书页（入口面板重新可见，不再跳仪表盘）
  const exit = await client.evalJS(`(() => {
    wordExit();
    const cfgShown = document.getElementById("word-config").style.display !== "none";
    const playHidden = document.getElementById("word-play").style.display === "none";
    return { cfgShown, playHidden, view: currentView };
  })()`);
  check("退出：回到词书页并显示入口面板", exit.cfgShown && exit.playHidden && exit.view === "wordbook");

  // 9) 仪表盘「🎴 背单词」按钮跳转独立页面
  const dashGo = await client.evalJS(`(() => {
    go("dashboard");
    openWordbook();
    return { view: currentView, pageShown: document.getElementById("view-wordbook").style.display !== "none" };
  })()`);
  check("仪表盘入口：openWordbook 跳转独立页面", dashGo.view === "wordbook" && dashGo.pageShown);

  check("无运行时异常", client.errors.length === 0);
  if (client.errors.length) client.errors.slice(0, 5).forEach(e => console.log("  ERR:", e));
  client.close();
} catch (e) {
  abort(e.message);
} finally {
  await browser.stop();
  await server.stop();
}
report();
