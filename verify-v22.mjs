/* v1.22.0 背单词重构专项检查：node verify-v22.mjs
   覆盖：单一卡片流（无例句猜义/无选择/无听写）/
   翻卡详情（英释·音标·近义词·同根词）/ 三档自评回炉 /
   困难单词本收藏（加入/移除/单独复习）/ 数据记录面板（今日/历史/状态筛选）/
   单词全局搜索 / 发音开关 / 详情弹窗 / 快捷键 */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9422;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=wordbook`;

const server = startServer(PORT, "v22");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v22");
const { check, abort, report } = makeCheck("v1.22.0 背单词重构检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 0) 构造 5 个词书词：1 个 3 天前学过（到期）+ 4 个新词；marks 带详情
  const mk = await client.evalJS(`(() => {
    const now = Date.now();
    const mkq = (i, learned) => ({
      id: 500000 + i, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
      kps: ["六级核心词 3000"], tags: ["other"],
      titleTex: "zeta" + i, solutionTex: "释义" + i + "  ［z音" + i + "］",
      note: "This is sentence " + i + ".\\n这是例句" + i + "。",
      marks: { te: "English meaning " + i, uk: "UK" + i, ph: "PH" + i, syn: ["synA"], rel: [{ w: "zeta" + i + "ly", t: "派生" }] },
      wrongAnswer: "", createdAt: now + i * 1000, urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    });
    [1, 2, 3, 4].forEach(i => questions.push(mkq(i, false)));
    questions.push(mkq(5, true));
    reviewLogs.push({ id: ++reviewSeq, qid: 500005, at: Date.now() - 3 * 86400000, result: "ok" }); // 3 天前 ok → 到期
    return questions.filter(q => q.id >= 500000).length;
  })()`);
  check("构造 5 个词书词（1 到期 + 4 新词）", mk === 5);

  // 1) 单一卡片流：开始后只显示单词面（无例句猜义 / 无选择 / 无听写元素）
  const flow = await client.evalJS(`(() => {
    wordPlan = { newPerDay: 5, sound: true };
    startWordReview();
    const qLen = wordQueue.length;
    const frontShown = document.getElementById("word-front").style.display !== "none";
    const ctxGone = !document.getElementById("word-context");       // 例句猜义区块已从页面移除
    const choicesGone = !document.getElementById("word-choices");   // 选择题区块已移除
    const dictGone = !document.getElementById("word-dictation");    // 听写区块已移除
    const w = document.getElementById("word-word").textContent;
    const ph = document.getElementById("word-word-ph").textContent;
    return { qLen, frontShown, ctxGone, choicesGone, dictGone, w, ph };
  })()`);
  check("卡片流：队列=1 到期+4 新词=5", flow.qLen === 5);
  check("卡片流：先显示单词面（无例句猜义/选择题/听写）", flow.frontShown && flow.ctxGone && flow.choicesGone && flow.dictGone);
  check("卡片流：正面为到期词 + 音标", flow.w === "zeta5" && flow.ph.includes("PH5"));

  // 2) 翻卡：释义 + 详情（英释/近义/同根）+ 收藏按钮 + 自评区
  const flip = await client.evalJS(`(() => {
    flipWord();
    const backShown = document.getElementById("word-back").style.display !== "none";
    const mean = document.getElementById("word-mean").textContent;
    const detail = document.getElementById("word-detail").textContent;
    const favBtn = document.getElementById("word-fav-btn").textContent;
    const rateShown = document.getElementById("word-rate").style.display !== "none";
    return { backShown, mean, detail, favBtn, rateShown };
  })()`);
  check("翻卡：显示释义与例句", flip.backShown && flip.mean.includes("释义5"));
  check("翻卡：详情区含英释/近义词/同根词", flip.detail.includes("English meaning") && flip.detail.includes("synA") && flip.detail.includes("zeta5ly"));
  check("翻卡：出现收藏按钮与三档自评", flip.favBtn.includes("收藏") && flip.rateShown);

  // 3) 困难单词本：收藏当前词 → 落库 / 计数 / 按钮切换
  const fav = await client.evalJS(`(() => {
    wordFavFromCur();
    const q = window.__curWord;
    const marked = !!(q.marks && q.marks.fav);
    const listLen = wordFavList().length;
    const btn = document.getElementById("word-fav-btn").textContent;
    return { marked, listLen, btn };
  })()`);
  check("收藏：marks.fav 落库 + 列表计数 1", fav.marked && fav.listLen === 1);
  check("收藏：按钮切换为取消收藏", fav.btn.includes("取消收藏"));

  // 4) 三档自评：不认识回炉 + 整轮完成小结（回炉词再次出现后过一遍）
  const rate = await client.evalJS(`(() => {
    const firstId = wordQueue[0].q.id;
    wordRate("miss");
    const requeued = wordQueue.length === 5 && wordQueue[4].q.id === firstId && wordQueue[4].misses === 1;
    const failLog = reviewLogs.some(l => l.qid === firstId && l.result === "fail");
    wordRate("know"); wordRate("know"); wordRate("know"); wordRate("know"); wordRate("know");
    const doneShown = document.getElementById("word-done").style.display !== "none";
    const stats = document.getElementById("word-done-stats").textContent;
    const logs = reviewLogs.filter(l => l.qid >= 500000).length;
    return { requeued, failLog, doneShown, stats, logs };
  })()`);
  check("自评：不认识回炉到队尾并落 fail", rate.requeued && rate.failLog);
  check("自评：整轮完成显示小结（本轮 6 词）", rate.doneShown && rate.stats.includes("本轮 6 词"));
  check("自评：7 条复习记录全部落库（含 3 天前种子记录）", rate.logs === 7);

  // 5) 数据记录面板：今日新词/复习/到期/连续打卡 + 历史表 + 状态筛选
  const data = await client.evalJS(`(() => {
    const t = wordToday();
    renderWordData();
    const txt = document.getElementById("word-data").textContent;
    const allRows = wordStatusRows("all").length;
    const favRows = wordStatusRows("fav").length;
    const freshRows = wordStatusRows("fresh").length;
    setWordStatusTab("fav");
    const favTabTxt = document.getElementById("word-data").textContent;
    setWordStatusTab("all");
    return { t, txt, allRows, favRows, freshRows, favTabTxt };
  })()`);
  check("数据面板：今日新词 4 / 今日复习 6 / 到期 0", data.t.newToday === 4 && data.t.reviewToday === 6 && data.t.dueNow === 0);
  check("数据面板：连续打卡 ≥ 1 天", data.t.streak >= 1);
  check("数据面板：渲染今日统计 + 每日历史 + 状态筛选", data.txt.includes("今日新词") && data.txt.includes("近 14 天") && data.txt.includes("单词状态"));
  check("数据面板：状态列表计数（全部 5 / 困难 1 / 未学 0）", data.allRows === 5 && data.favRows === 1 && data.freshRows === 0);
  check("数据面板：困难筛选只显示收藏词", data.favTabTxt.includes("zeta5") && !data.favTabTxt.includes("zeta1"));

  // 6) 单词全局搜索：按单词 / 释义命中 + 未命中提示
  const search = await client.evalJS(`(() => {
    wordSearch("zeta2");
    const hit1 = document.getElementById("word-search-res").textContent.includes("zeta2");
    wordSearch("释义3");
    const hit2 = document.getElementById("word-search-res").textContent.includes("zeta3");
    wordSearch("zzz-no-match");
    const miss = document.getElementById("word-search-res").textContent.includes("没有找到");
    wordSearch("");
    const cleared = document.getElementById("word-search-res").textContent === "";
    return { hit1, hit2, miss, cleared };
  })()`);
  check("搜索：按单词命中 / 按释义命中", search.hit1 && search.hit2);
  check("搜索：未命中提示 + 清空", search.miss && search.cleared);

  // 7) 发音开关：默认开 → 关闭 → 再开
  const sound = await client.evalJS(`(() => {
    const def = wordSoundOn();
    toggleWordSound();
    const off = !wordSoundOn();
    toggleWordSound();
    const on = wordSoundOn();
    return { def, off, on };
  })()`);
  check("发音开关：默认开 / 可关 / 可再开", sound.def && sound.off && sound.on);

  // 8) 详情弹窗：单词/释义/收藏按钮/去学习
  const detail = await client.evalJS(`(() => {
    openWordDetail(500001);
    const maskShown = document.getElementById("modal-mask").style.display === "flex";
    const body = document.getElementById("modal-body").textContent;
    const foot = document.getElementById("modal-foot").textContent;
    closeModal();
    return { maskShown, body, foot };
  })()`);
  check("详情弹窗：显示单词与释义", detail.maskShown && detail.body.includes("zeta1") && detail.body.includes("释义1"));
  check("详情弹窗：含收藏与去学习按钮", detail.foot.includes("收藏困难词") && detail.foot.includes("去学习"));

  // 9) 快捷键：空格翻卡 + 1 自评（背单词页）
  const kb = await client.evalJS(`(() => {
    const q = questions.find(x => x.id === 500001);
    wordQueue = [{ q, misses: 0 }]; wordIdx = 0; wordStats = { know: 0, fuzzy: 0, miss: 0 }; wordSession = true;
    document.getElementById("word-play").style.display = "";
    document.getElementById("word-done").style.display = "none";
    renderWordCard();
    const before = document.getElementById("word-back").style.display !== "none";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    const after = document.getElementById("word-back").style.display !== "none";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    const rated = wordQueue.length === 0;
    wordSession = false;
    return { before, after, rated };
  })()`);
  check("快捷键：空格翻卡 / 1 认识自评", !kb.before && kb.after && kb.rated);

  // 10) 单独复习困难单词本
  const favRev = await client.evalJS(`(() => {
    reviewFavs();
    const onlyFav = wordQueue.length === 1 && wordQueue[0].q.id === 500005;
    const playShown = document.getElementById("word-play").style.display !== "none";
    wordExit();
    return { onlyFav, playShown };
  })()`);
  check("困难单词本：单独复习只含收藏词", favRev.onlyFav && favRev.playShown);

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
