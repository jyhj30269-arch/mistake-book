/* v1.19.0 背单词模式专项检查：node verify-v19.mjs
   覆盖：知识点树折叠（默认展开到子科目/点击展开收起/按钮不触发）/
   批量粘贴导入单词 / 每日新词上限 / 单词卡翻卡三档自评 / 不认识回炉 / 本轮小结落库 */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9403;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;

const server = startServer(PORT, "v19");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v19");
const { check, abort, report } = makeCheck("v1.19.0 背单词检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 1) 知识点树折叠：默认科目展开（显示子科目行）、子科目收起（无章节行）
  const tree = await client.evalJS(`(() => {
    go("settings");
    const rows = Array.from(document.querySelectorAll("#settings-tree .tree-row")).map(r => r.textContent.trim());
    const hasSubj = rows.some(r => r.includes("数学"));
    const hasSub = rows.some(r => r.includes("高等数学"));       // 子科目行（默认展开科目后可见）
    const hasCh = rows.some(r => r.includes("一元函数微分学"));  // 章节行（子科目收起，应不可见）
    const rowsBefore = rows.length;
    // 点击「高等数学」行展开 → 章节出现
    const subRow = Array.from(document.querySelectorAll("#settings-tree .tree-row")).find(r => r.textContent.includes("高等数学"));
    subRow.click();
    const rowsAfter = Array.from(document.querySelectorAll("#settings-tree .tree-row")).length;
    const chVisible = Array.from(document.querySelectorAll("#settings-tree .tree-row")).some(r => r.textContent.includes("一元函数微分学"));
    // 再点一次收起
    subRow.click();
    const chHidden = !Array.from(document.querySelectorAll("#settings-tree .tree-row")).some(r => r.textContent.includes("一元函数微分学"));
    return { hasSubj, hasSub, hasCh, rowsBefore, rowsAfter, chVisible, chHidden };
  })()`);
  check("折叠树：默认科目展开/子科目收起（章节隐藏）", tree.hasSubj && tree.hasSub && !tree.hasCh);
  check("折叠树：点击子科目行展开章节", tree.chVisible && tree.rowsAfter > tree.rowsBefore);
  check("折叠树：再点击收起章节", tree.chHidden);

  // 2) 批量粘贴导入 3 个单词到「易混词辨析」词书
  const before = await client.evalJS(`questions.length`);
  await client.evalJS(`openPasteWords(); true`);
  await client.evalJS(`document.getElementById("pw-book").value = "ch-w1"; document.getElementById("pw-text").value = "testword 测试词；测验 | This is a test.\\nsecondword 第二个词\\nthirdword 第三个词 | Third example."; doPasteWords(); true`);
  await sleep(600);
  const imported = await client.evalJS(`(() => {
    const list = questions.filter(q => q.type === "vocabulary" && q.chapter === "ch-w1" && q.titleTex.startsWith("testword") || q.titleTex === "secondword" || q.titleTex === "thirdword");
    const t1 = list.find(q => q.titleTex === "testword");
    return { n: list.length, sol: t1 && t1.solutionTex, note: t1 && t1.note };
  })()`);
  check("粘贴导入：3 词入库", imported.n === 3);
  check("粘贴导入：释义/例句解析正确", imported.sol === "测试词；测验" && imported.note === "This is a test.");
  check("粘贴导入：questions 数量增加", (await client.evalJS(`questions.length`)) === before + 3);

  // 3) 单词卡：构造词书 5 词（1 已复习未到期 + 4 新词），每日上限 2 → 队列 = 新词 2
  const queue = await client.evalJS(`(() => {
    const now = Date.now();
    const base = questions.length;
    const mk = (i, learned) => {
      const q = { id: 300000 + i, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
        kps: ["六级核心词 3000"], tags: ["other"], titleTex: "word" + i, solutionTex: "释义" + i, note: "",
        wrongAnswer: "", marks: {}, createdAt: now + i * 1000, urgent: false, calcWeak: false, needConsolidate: false, imgs: [] };
      questions.push(q);
      if (learned) reviewLogs.push({ id: ++reviewSeq, qid: q.id, at: now - 3600000, result: "ok" }); // 1 小时前复习 → 未到期
      return q;
    };
    mk(1, true); mk(2, false); mk(3, false); mk(4, false); mk(5, false);
    wordPlan = { newPerDay: 2 };
    startWordLearn();
    const qLen = wordQueue.length;
    const firstIsFresh = wordQueue.every(x => x.q.titleTex !== "word1"); // 到期词 word1 刚复习过未到期 → 不应在队列
    const playShown = document.getElementById("word-play").style.display !== "none";
    return { qLen, firstIsFresh, playShown };
  })()`);
  check("单词卡：每日上限 2 → 只入 2 个新词", queue.qLen === 2);
  check("单词卡：未到期复习词不进入队列", queue.firstIsFresh);
  check("单词卡：卡片界面显示", queue.playShown);

  // 4) 翻卡 + 不认识回炉 → 队列尾再出现
  const flip = await client.evalJS(`(() => {
    flipWord();
    const backShown = document.getElementById("word-back").style.display !== "none";
    const first = wordQueue[0].q.titleTex;
    wordRate("miss");
    const requeued = wordQueue.some(x => x.q.titleTex === first && x.misses === 1);
    const tail = wordQueue[wordQueue.length - 1].q.titleTex;
    return { backShown, requeued, tail };
  })()`);
  check("单词卡：翻卡显示释义", flip.backShown);
  check("单词卡：不认识回炉到队尾", flip.requeued && flip.tail === "word2");

  // 5) 完成整轮（剩余 3 词全认识）→ 小结 + 复习记录落库
  const done = await client.evalJS(`(() => {
    wordRate("know"); wordRate("know"); wordRate("know");
    const doneShown = document.getElementById("word-done").style.display !== "none";
    const stats = document.getElementById("word-done-stats").textContent;
    const logs = reviewLogs.filter(l => l.qid >= 300000 && l.result === "ok").length;
    const total = questions.filter(q => q.id >= 300000).length;
    questions = questions.filter(q => q.id < 300000);
    reviewLogs = reviewLogs.filter(l => l.qid < 300000 || l.qid >= 400000);
    return { doneShown, stats, logs, total };
  })()`);
  check("单词卡：整轮完成显示小结", done.doneShown && done.stats.includes("认识"));
  check("单词卡：自评落库（ok 记录数）", done.logs >= 3);

  // 6) 词书进度面板
  const panel = await client.evalJS(`(() => {
    questions.push({ id: 300010, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2", kps: [], tags: [], titleTex: "paneltest", solutionTex: "释义", note: "", wrongAnswer: "", marks: {}, createdAt: Date.now(), urgent: false, calcWeak: false, needConsolidate: false, imgs: [] });
    renderWordPanel();
    const t = document.getElementById("word-config").textContent;
    questions = questions.filter(q => q.id !== 300010);
    return t.includes("已学");
  })()`);
  check("词书面板：进度信息渲染", panel);

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
