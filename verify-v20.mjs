/* v1.20.0 背单词升级专项检查：node verify-v20.mjs
   覆盖：例句语境学习（新词先例句）/ 单词详情区（英释·同根·近义）/
   选义模式（4 选 1 对错落库）/ 选词模式 / 听写模式（对错回炉）/
   三档统计 / 批量删除接口 */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9407;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;

const server = startServer(PORT, "v20");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v20");
const { check, abort, report } = makeCheck("v1.20.0 背单词升级检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 造 3 个带详情数据的词（marks 含 te/uk/syn/rel）
  const mk = await client.evalJS(`(() => {
    const now = Date.now();
    const mkq = (i) => ({
      id: 400000 + i, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
      kps: ["六级核心词 3000"], tags: ["other"],
      titleTex: "alpha" + i, solutionTex: "释义" + i + "  ［音标" + i + "］",
      note: "This is sentence " + i + ".\\n这是例句" + i + "。",
      marks: { te: "English meaning " + i, uk: "UK" + i, syn: ["synA", "synB"], rel: [{ w: "alpha" + i + "ly", t: "派生" }] },
      wrongAnswer: "", createdAt: now + i * 1000, urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    });
    [1, 2, 3, 4, 5, 6].forEach(i => questions.push(mkq(i)));
    return questions.filter(q => q.id >= 400000).length;
  })()`);
  check("构造 6 个词书词", mk === 6);

  // 1) 快捷模式 + 例句语境（新词先例句） + 详情区
  const quick = await client.evalJS(`(() => {
    wordPlan = { newPerDay: 10, mode: "quick" };
    startWordReview();
    const contextShown = document.getElementById("word-context").style.display !== "none";
    const ctxText = document.getElementById("word-context-text").textContent;
    flipWord();
    const backShown = document.getElementById("word-back").style.display !== "none";
    const detail = document.getElementById("word-detail").textContent;
    return { contextShown, ctxHas: ctxText.includes("sentence"), backShown, detailHas: detail.includes("English meaning") && detail.includes("synA") && detail.includes("alpha1ly") };
  })()`);
  check("快捷：新词先显示例句语境", quick.contextShown && quick.ctxHas);
  check("快捷：翻卡显示详情（英释/近义/同根）", quick.backShown && quick.detailHas);

  // 2) 三档自评落库（know → ok）
  const rate = await client.evalJS(`(() => {
    wordRate("know");
    const logs = reviewLogs.filter(l => l.qid >= 400000);
    return { qLen: wordQueue.length, logged: logs.length, okCount: logs.filter(l => l.result === "ok").length };
  })()`);
  check("快捷：认识 → ok 落库并出队", rate.logged === 1 && rate.okCount === 1 && rate.qLen === 5);

  // 3) 选义模式（4 选 1）
  const meaning = await client.evalJS(`(() => {
    wordMode = "meaning";
    renderWordCard();
    const choices = document.querySelectorAll("#word-choice-list .choice-btn").length;
    const correct = wordQueue[0].q.solutionTex.replace(/\\s*［.*］$/, "").trim();
    const idx = window.__wordChoices.indexOf(correct);
    wordChoice(idx); // 选对 → 出队
    const qLen1 = wordQueue.length;
    const before = reviewLogs.filter(l => l.qid >= 400000).length;
    wordChoice(0); // 无论对错，都会触发一次落库
    const after = reviewLogs.filter(l => l.qid >= 400000).length;
    return { choices, qLen1, loggedInc: after - before };
  })()`);
  check("选义：渲染 4 个选项", meaning.choices === 4);
  check("选义：选对出队 + 每次判定落库", meaning.qLen1 === 4 && meaning.loggedInc >= 1);

  // 4) 选词模式（看释义选单词，独立构造队列保证 4 选项）
  const wordmode = await client.evalJS(`(() => {
    const target = questions.filter(q => q.id >= 400000)[0];
    wordQueue = [{ q: target, misses: 0 }]; wordIdx = 0; wordStats = { know: 0, fuzzy: 0, miss: 0 }; wordSession = true;
    document.getElementById("word-play").style.display = "";
    wordMode = "word";
    renderWordCard();
    const choices = document.querySelectorAll("#word-choice-list .choice-btn").length;
    const idx = window.__wordChoices.indexOf(target.titleTex);
    wordChoice(idx);
    return { choices, qLen: wordQueue.length };
  })()`);
  check("选词：4 选项且选对出队", wordmode.choices === 4 && wordmode.qLen === 0);

  // 5) 听写模式：正确 → ok；错误 → fail 回炉 + 显示正确答案
  const dict = await client.evalJS(`(() => {
    const q = { id: 410001, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
      kps: [], tags: [], titleTex: "BeautiFul", solutionTex: "美丽的", note: "", marks: {}, wrongAnswer: "", createdAt: Date.now(), urgent: false, calcWeak: false, needConsolidate: false, imgs: [] };
    questions.push(q);
    wordPlan = { newPerDay: 10, mode: "dictation" };
    wordQueue = [{ q, misses: 0 }]; wordIdx = 0; wordStats = { know: 0, fuzzy: 0, miss: 0 }; wordSession = true;
    document.getElementById("word-play").style.display = "";
    renderWordCard();
    // 正确：大小写不敏感
    document.getElementById("word-dict-input").value = "beautiful";
    dictationCheck();
    const okOut = wordQueue.length === 0;
    const okLog = reviewLogs.some(l => l.qid === 410001 && l.result === "ok");
    // 错误：回炉 + 显示答案
    const q2 = { id: 410002, titleTex: "schedule", solutionTex: "日程表", type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2", kps: [], tags: [], note: "", marks: {}, wrongAnswer: "", createdAt: Date.now(), urgent: false, calcWeak: false, needConsolidate: false, imgs: [] };
    questions.push(q2);
    wordQueue = [{ q: q2, misses: 0 }]; wordIdx = 0; wordStats = { know: 0, fuzzy: 0, miss: 0 };
    renderWordCard();
    document.getElementById("word-dict-input").value = "skedule";
    dictationCheck();
    const requeued = wordQueue.length === 1 && wordQueue[0].misses === 1;
    const answerShown = document.getElementById("word-dict-answer").textContent.includes("schedule");
    const failLog = reviewLogs.some(l => l.qid === 410002 && l.result === "fail");
    return { okOut, okLog, requeued, answerShown, failLog };
  })()`);
  check("听写：拼写正确（忽略大小写）→ ok 出队", dict.okOut && dict.okLog);
  check("听写：拼写错误 → fail 落库 + 回炉 + 显示正确答案", dict.requeued && dict.answerShown && dict.failLog);

  // 6) 三档统计
  const prog = await client.evalJS(`(() => {
    const p = wordProgress();
    return { know: p.know, fuzzy: p.fuzzy, miss: p.miss, learned: p.learned };
  })()`);
  check("三档统计：认识/模糊/不认识计数", prog.know >= 2 && prog.miss >= 1 && prog.learned >= 3);

  // 7) 批量删除接口（重导入前半段）
  const del = await client.evalJS(`(async () => {
    const ids = questions.filter(q => q.id >= 400000).map(q => q.id);
    const r = await API.deleteQuestionsBatch(ids);
    questions = questions.filter(q => !ids.includes(q.id));
    reviewLogs = reviewLogs.filter(l => !ids.includes(l.qid));
    return { ok: r.ok, left: questions.filter(q => q.id >= 400000).length, logsLeft: reviewLogs.filter(l => l.qid >= 400000).length };
  })()`);
  check("批量删除：词书词与复习记录清空", del.ok && del.left === 0 && del.logsLeft === 0);

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
