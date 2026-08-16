/* v1.24.0 背单词 学习/复习分离 + 改良艾宾浩斯 + 乱序 专项检查：node verify-v24.mjs
   覆盖：学习=新词（每日上限）/ 复习=到期未掌握词 双按钮分离 /
   连续答对 3 次判「掌握」→ 移出复习队列 /
   反馈驱动下次间隔（ok 递增 / half 减半降难度 / fail 重置）/
   学习队列乱序（含全部新词）*/
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9424;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=wordbook`;

const server = startServer(PORT, "v24");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "v24");
const { check, abort, report } = makeCheck("v1.24.0 学习/复习分离与遗忘曲线检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  // 0) 构造：w1 已掌握（连续 3 ok）+ w2 到期未掌握（1 ok 3 天前）+ w3-w6 新词
  const mk = await client.evalJS(`(() => {
    const now = Date.now();
    const mkq = (i) => ({
      id: 900000 + i, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w2",
      kps: ["六级核心词 3000"], tags: ["other"], titleTex: "gamma" + i, solutionTex: "释义" + i,
      note: "", marks: {}, wrongAnswer: "", createdAt: now + i * 1000,
      urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    });
    [1, 2, 3, 4, 5, 6].forEach(i => questions.push(mkq(i)));
    // w1 连续 3 次 ok（第 3 次 10 天前，已到过 2 轮间隔）→ 完全掌握
    [now - 30 * 86400000, now - 20 * 86400000, now - 10 * 86400000].forEach((at, k) =>
      reviewLogs.push({ id: ++reviewSeq, qid: 900001, at, result: "ok" }));
    // w2 1 次 ok 在 3 天前 → 到期未掌握
    reviewLogs.push({ id: ++reviewSeq, qid: 900002, at: now - 3 * 86400000, result: "ok" });
    return questions.filter(q => q.id >= 900000).length;
  })()`);
  check("构造 6 词：w1 掌握 / w2 到期 / w3-6 新词", mk === 6);

  // 1) 学习/复习双按钮分离 + 掌握判定
  const sep = await client.evalJS(`(() => {
    renderWordPanel();
    const txt = document.getElementById("word-config").textContent;
    const hasLearnBtn = txt.includes("开始学习");
    const hasReviewBtn = txt.includes("开始复习");
    const mastered = isMastered(900001);
    const notMastered = !isMastered(900002);
    // 学习队列：只含新词 w3-6（乱序，集合一致）
    wordPlan = { newPerDay: 4, sound: false };
    startWordLearn();
    const learnIds = new Set(wordQueue.map(x => x.q.id));
    const learnOnlyNew = [900003, 900004, 900005, 900006].every(id => learnIds.has(id)) && wordQueue.length === 4;
    const learnKind = wordSessionKind;
    wordExit();
    // 复习队列：只含到期未掌握 w2（w1 掌握已移出）
    startWordReview();
    const reviewOnlyW2 = wordQueue.length === 1 && wordQueue[0].q.id === 900002;
    const reviewKind = wordSessionKind;
    wordExit();
    return { hasLearnBtn, hasReviewBtn, mastered, notMastered, learnOnlyNew, learnKind, reviewOnlyW2, reviewKind };
  })()`);
  check("按钮：开始学习 与 开始复习 并存", sep.hasLearnBtn && sep.hasReviewBtn);
  check("掌握：连续 3 次答对判为掌握（w1），w2 未掌握", sep.mastered && sep.notMastered);
  check("学习队列：只含新词（乱序）", sep.learnOnlyNew && sep.learnKind === "learn");
  check("复习队列：掌握词 w1 已移出，只含到期 w2", sep.reviewOnlyW2 && sep.reviewKind === "review");

  // 2) 改良艾宾浩斯：ok 间隔递增；half 减半降难度；fail 重置
  const sm2 = await client.evalJS(`(() => {
    const commit = (qid, result) => { reviewLogs.push({ id: ++reviewSeq, qid, at: Date.now(), result }); };
    // w3：ok → ok → ok → ok
    [1, 2, 3, 4].forEach(() => commit(900003, "ok"));
    const sOk = scheduleOf(900003);
    // w4：ok → half
    commit(900004, "ok"); commit(900004, "half");
    const sHalf = scheduleOf(900004);
    // w5：ok ×2 → fail
    commit(900005, "ok"); commit(900005, "ok"); commit(900005, "fail");
    const sFail = scheduleOf(900005);
    return { okInterval: sOk.intervalDays, okEase: sOk.ease, halfInterval: sHalf.intervalDays, halfEase: sHalf.ease, failInterval: sFail.intervalDays, failLapses: sFail.lapses };
  })()`);
  check("艾宾浩斯：连续 ok 间隔递增（1→3→8→20 天）", sm2.okInterval === 20 && Math.abs(sm2.okEase - 2.5) < 1e-9);
  check("艾宾浩斯：模糊减半间隔并降难度", sm2.halfInterval === 1 && Math.abs(sm2.halfEase - 2.4) < 1e-9);
  check("艾宾浩斯：不会重置间隔并记一次重学", sm2.failInterval === 1 && sm2.failLapses === 1);

  // 3) 复习队列乱序分组：w2 复习后（ok）不再到期 → 今日复习完成提示
  const done = await client.evalJS(`(() => {
    startWordReview();
    wordRate("know");
    const doneShown = document.getElementById("word-done").style.display !== "none";
    const title = document.getElementById("word-done-title").textContent;
    wordExit();
    startWordReview(); // 到期已清空
    return { doneShown, title, queueEmpty: wordQueue.length === 0 };
  })()`);
  check("复习完成：小结标题「本轮复习完成」", done.doneShown && done.title.includes("复习完成"));
  check("复习完成：到期清空后再次复习提示无队列", done.queueEmpty);

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
