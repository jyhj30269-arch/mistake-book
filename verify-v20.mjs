/* v1.20.0 背单词升级检查（v1.22 起四模式移除，保留仍有效的部分）：
   单词详情区（英释·同根·近义）/ 翻卡三档自评 / 三档统计 / 批量删除接口 */
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
    [1, 2, 3].forEach(i => questions.push(mkq(i)));
    return questions.filter(q => q.id >= 400000).length;
  })()`);
  check("构造 3 个词书词", mk === 3);

  // 1) 翻卡详情区（开始学习：看词 → 翻卡 → 详情）
  const quick = await client.evalJS(`(() => {
    wordPlan = { newPerDay: 10, sound: false };
    startWordLearn();
    const first = wordQueue[0].q;
    const frontShown = document.getElementById("word-front").style.display !== "none";
    flipWord();
    const backShown = document.getElementById("word-back").style.display !== "none";
    const detail = document.getElementById("word-detail").textContent;
    return { frontShown, backShown, title: first.titleTex, detailHas: detail.includes("English meaning") && detail.includes("synA") && detail.includes(first.titleTex + "ly") };
  })()`);
  check("卡片流：先看词再翻卡", quick.frontShown && quick.backShown);
  check("翻卡：详情区含英释/近义/同根", quick.detailHas);

  // 2) 三档自评落库（know → ok；miss → fail）
  const rate = await client.evalJS(`(() => {
    wordRate("know");
    const logs1 = reviewLogs.filter(l => l.qid >= 400000);
    const okCount = logs1.filter(l => l.result === "ok").length;
    return { qLen: wordQueue.length, logged: logs1.length, okCount };
  })()`);
  check("三档自评：认识 → ok 落库并出队", rate.logged === 1 && rate.okCount === 1 && rate.qLen === 2);

  // 3) 三档统计
  const prog = await client.evalJS(`(() => {
    const p = wordProgress();
    return { know: p.know, fuzzy: p.fuzzy, miss: p.miss, learned: p.learned };
  })()`);
  check("三档统计：认识计数与已学数", prog.know >= 1 && prog.learned >= 1);

  // 4) 批量删除接口（重导入前半段）
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
