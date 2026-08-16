/* v1.23.0 背单词下拉子菜单 + 分功能页 + 下一个单词专项检查：node verify-v23.mjs
   覆盖：侧边栏下拉子菜单（桌面+移动，展开/收起）/
   功能页切换（开始学习/学习记录/困难单词本/查单词，tab 高亮 + 侧边栏子项高亮）/
   「下一个」连续过词（按钮 + N/→ 快捷键，记认识并出队）/
   学习卡放大元素（下一个按钮存在）*/
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9423;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=wordbook`;

const server = startServer(PORT, "v23");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v23");
const { check, abort, report } = makeCheck("v1.23.0 背单词下拉子菜单检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 1) 侧边栏下拉子菜单存在（桌面 + 移动），点击父项展开/收起
  const sub = await client.evalJS(`(() => {
    const deskItems = Array.from(document.querySelectorAll("#word-sub .nav-sub-item")).map(a => a.dataset.wordTab);
    const mobItems = Array.from(document.querySelectorAll("#word-sub-m .nav-sub-item")).map(a => a.dataset.wordTab);
    const wrap = document.getElementById("nav-wordbook");
    const before = wrap.classList.contains("open");
    wrap.querySelector(".nav-parent").click(); // 展开
    const afterOpen = wrap.classList.contains("open");
    wrap.querySelector(".nav-parent").click(); // 收起
    const afterClose = !wrap.classList.contains("open");
    return { deskItems, mobItems, before, afterOpen, afterClose };
  })()`);
  check("下拉子菜单：桌面+移动各 4 项（learn/data/fav/search）",
    sub.deskItems.join() === "learn,data,fav,search" && sub.mobItems.join() === "learn,data,fav,search");
  check("下拉子菜单：点击父项展开/收起", !sub.before && sub.afterOpen && sub.afterClose);

  // 2) 功能页切换：showWordTab("data") → 数据面板显示、开始学习隐藏、tab 高亮、子项高亮
  const tab = await client.evalJS(`(() => {
    showWordTab("data");
    const dataShown = document.getElementById("word-data").style.display !== "none";
    const cfgHidden = document.getElementById("word-config").style.display === "none";
    const tabOn = document.querySelector('#word-tabs button[data-wt="data"]').classList.contains("on");
    const subActive = document.querySelector('#word-sub .nav-sub-item[data-word-tab="data"]').classList.contains("active");
    const favHidden = document.getElementById("word-fav").style.display === "none";
    showWordTab("fav");
    const favShown = document.getElementById("word-fav").style.display !== "none";
    const dataHidden = document.getElementById("word-data").style.display === "none";
    showWordTab("search");
    const searchShown = document.getElementById("word-search-pane").style.display !== "none";
    const hasInput = !!document.getElementById("word-search-input");
    showWordTab("learn");
    const learnShown = document.getElementById("word-config").style.display !== "none";
    return { dataShown, cfgHidden, tabOn, subActive, favHidden, favShown, dataHidden, searchShown, hasInput, learnShown };
  })()`);
  check("功能页：学习记录页显示且开始学习页隐藏", tab.dataShown && tab.cfgHidden);
  check("功能页：tab 高亮 + 侧边栏子项高亮同步", tab.tabOn && tab.subActive);
  check("功能页：困难单词本 / 查单词 / 开始学习页互斥切换", tab.favShown && tab.dataHidden && tab.searchShown && tab.hasInput && tab.learnShown);

  // 3) 构造 3 个新词 → 开始学习 → 「下一个」连续过词（按钮 + N 快捷键）
  const flow = await client.evalJS(`(() => {
    const now = Date.now();
    const mkq = (i) => ({
      id: 600000 + i, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
      kps: ["六级核心词 3000"], tags: ["other"], titleTex: "beta" + i, solutionTex: "释义" + i,
      note: "", marks: {}, wrongAnswer: "", createdAt: now + i * 1000,
      urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    });
    [1, 2, 3].forEach(i => questions.push(mkq(i)));
    wordPlan = { newPerDay: 3, tab: "learn", sound: false };
    startWordReview();
    const qLen0 = wordQueue.length;
    const hasNextBtn = document.getElementById("word-play").textContent.includes("下一个");
    nextWord(); // 记认识并出队
    const qLen1 = wordQueue.length;
    const ok1 = reviewLogs.filter(l => l.qid === 600001 && l.result === "ok").length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    const qLen2 = wordQueue.length;
    const ok2 = reviewLogs.filter(l => l.qid === 600002 && l.result === "ok").length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const qLen3 = wordQueue.length;
    const ok3 = reviewLogs.filter(l => l.qid === 600003 && l.result === "ok").length;
    wordExit();
    return { qLen0, hasNextBtn, qLen1, ok1, qLen2, ok2, qLen3, ok3 };
  })()`);
  check("学习：3 个新词入队 + 卡片含「下一个」按钮", flow.qLen0 === 3 && flow.hasNextBtn);
  check("下一个：按钮记认识并出队", flow.qLen1 === 2 && flow.ok1 === 1);
  check("下一个：N 与 → 快捷键连续过词", flow.qLen2 === 1 && flow.qLen3 === 0 && flow.ok2 === 1 && flow.ok3 === 1);

  // 4) 从侧边栏子项进入指定功能页（openWordbook("data")）
  const nav = await client.evalJS(`(() => {
    openWordbook("data");
    const dataShown = document.getElementById("word-data").style.display !== "none";
    const persisted = (wordPlan && wordPlan.tab) === "data";
    return { dataShown, persisted, view: currentView };
  })()`);
  check("子菜单入口：openWordbook('data') 进入学习记录页并持久化", nav.dataShown && nav.persisted && nav.view === "wordbook");

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
