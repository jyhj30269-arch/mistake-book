/* 间隔重复调度（SM-2 轻量版）与错因/原图复习功能检查：
   node verify-scheduler.mjs
   覆盖：scheduleOf 间隔推导 / isDue / 推荐到期优先 / 错因标签筛选 /
   复习卡回忆错因 / 复习卡原图查看 / reviewCfg 持久化 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9395;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-sched-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: ROOT,
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

const profile = mkdtempSync(join(tmpdir(), "mb-sched-"));
const browser = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
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
    .then((r) => r.result && r.result.value);

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2500);
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 1) 调度基础：从未复习 → 立即到期；ok 后间隔 1 天；连续 ok 递增；fail 重置
  const sched = await evalJS(`(() => {
    const now = Date.now();
    const mk = () => ({ id: 9900, type: "problem", subject: "subj-math", subSubject: "ss-gaoshu",
      chapter: "ch-c1", kps: [], tags: [], titleTex: "t", solutionTex: "", wrongAnswer: "",
      note: "", marks: {}, createdAt: now, urgent: false, imgs: [] });
    const base = reviewLogs.length;
    const fresh = mk(); questions.push(fresh);
    const s0 = scheduleOf(fresh.id);                    // 无记录
    reviewLogs.push({ id: ++reviewSeq, qid: fresh.id, at: now, result: "ok" });
    const s1 = scheduleOf(fresh.id);                    // 1 次 ok
    reviewLogs.push({ id: ++reviewSeq, qid: fresh.id, at: now, result: "ok" });
    const s2 = scheduleOf(fresh.id);                    // 连续 2 ok → 1 * 2.5 = 2.5 → round = 3
    reviewLogs.push({ id: ++reviewSeq, qid: fresh.id, at: now, result: "fail" });
    const s3 = scheduleOf(fresh.id);                    // fail → 间隔 1 天
    reviewLogs.push({ id: ++reviewSeq, qid: fresh.id, at: now, result: "half" });
    const s4 = scheduleOf(fresh.id);                    // half → 间隔保持 1，ease 2.4
    reviewLogs.splice(base);
    questions.pop();
    return {
      s0due: s0.dueAt <= now, s0iv: s0.intervalDays,
      s1iv: s1.intervalDays, s1due: s1.dueAt - now,
      s2iv: s2.intervalDays,
      s3iv: s3.intervalDays, s3laps: s3.lapses, s3ease: s3.ease,
      s4iv: s4.intervalDays, s4ease: Math.round(s4.ease * 10) / 10
    };
  })()`);
  check("调度：未复习立即到期", sched.s0due && sched.s0iv === 0);
  check("调度：1 次 ok 后间隔 1 天", sched.s1iv === 1 && Math.abs(sched.s1due - 86400000) < 1000);
  check("调度：连续 2 ok 间隔 3 天（1×2.5）", sched.s2iv === 3);
  check("调度：fail 重置间隔 1 天 + 记 lapse + 降难度", sched.s3iv === 1 && sched.s3laps === 1 && sched.s3ease === 2.3);
  check("调度：half 不重置间隔、ease -0.1", sched.s4iv === 1 && sched.s4ease === 2.2);

  // 2) 种子题按记录推导到期（部分到期、非全部——最近连续做对的间隔更长）
  const dueInfo = await evalJS(`(() => {
    const all = questions.filter(q => q.subject === "subj-math");
    return { n: all.length, due: all.filter(q => isDue(q.id)).length, unreviewed: scheduleOf(999999).dueAt <= Date.now() };
  })()`);
  check("调度：种子题到期推导合理", dueInfo.n > 0 && dueInfo.due > 0 && dueInfo.due < dueInfo.n);

  // 3) 推荐到期优先：新题（未到期）与到期题并存时，到期题排前
  const recOrder = await evalJS(`(() => {
    const now = Date.now();
    const mkQ = (id, at) => ({ id, type: "problem", subject: "subj-math", subSubject: "ss-gaoshu",
      chapter: "ch-c1", kps: [], tags: ["method"], titleTex: "rec-" + id, solutionTex: "",
      wrongAnswer: "", note: "", marks: {}, createdAt: at, urgent: false, imgs: [] });
    const base = reviewLogs.length;
    questions.push(mkQ(9801, now));                    // 刚创建 → 未到期（无记录，首刷到期…）
    // 无记录的题 isDue=true（首刷到期），因此造一个刚复习过的"未到期"题：
    const fresh2 = mkQ(9802, now);
    questions.push(fresh2);
    reviewLogs.push({ id: ++reviewSeq, qid: 9802, at: now, result: "ok" });
    const dueQ = mkQ(9803, now - 20 * 86400000);        // 20 天前创建 + fail → 到期
    questions.push(dueQ);
    reviewLogs.push({ id: ++reviewSeq, qid: 9803, at: now - 10 * 86400000, result: "fail" });
    const rec = recommendQuestions(30);
    const idx9802 = rec.findIndex(q => q.id === 9802);
    const idx9803 = rec.findIndex(q => q.id === 9803);
    const idx9801 = rec.findIndex(q => q.id === 9801);
    reviewLogs.splice(base);
    questions.length -= 3;
    return { dueFirst: idx9802 > idx9803, unreviewedIncluded: idx9801 >= 0 };
  })()`);
  check("推荐：到期题排在未到期题之前", recOrder.dueFirst);
  check("推荐：未复习（首刷到期）题进入推荐", recOrder.unreviewedIncluded);

  // 4) 错因专项筛选：tag=careless 时抽题全为 careless
  const tagPick = await evalJS(`(() => {
    reviewCfg.tag = "careless";
    reviewCfg.subject = "all"; reviewCfg.sub = "all"; reviewCfg.chapter = ""; reviewCfg.lv = "all";
    const pool = questions.filter(q => {
      if (q.subject !== "subj-math" && q.subject !== "subj-eng" && q.subject !== "subj-408") return false;
      if (reviewCfg.tag && reviewCfg.tag !== "all" && !q.tags.includes(reviewCfg.tag)) return false;
      return displayMastery(q.id).lv.key !== "blue";
    });
    return { n: pool.length, allCareless: pool.every(q => q.tags.includes("careless")) };
  })()`);
  check("错因筛选：仅 careless 标签题进入候选", tagPick.n > 0 && tagPick.allCareless);

  // 5) 复习卡：回忆错因 + 原图查看
  const cardUI = await evalJS(`(() => {
    const q = questions.find(x => x.id === 1);
    const oldWrong = q.wrongAnswer, oldImgs = q.imgs;
    q.wrongAnswer = "泰勒展开方向记反了";
    q.imgs = ["/uploads/bm-test.png"];
    reviewQueue = [q]; reviewIdx = 0; reviewDone = new Set(); reviewSkipped = new Set();
    showReviewCard();
    const wrongVisible = document.getElementById("rev-wrong-wrap").style.display !== "none";
    const imgsVisible = document.getElementById("rev-imgs-wrap").style.display !== "none";
    toggleRevWrong();
    const wrongShown = document.getElementById("rev-wrong").style.display !== "none";
    const wrongText = document.getElementById("rev-wrong").textContent;
    toggleRevImgs();
    const imgsShown = document.getElementById("rev-imgs").style.display !== "none";
    const imgsCount = document.querySelectorAll("#rev-imgs img").length;
    q.wrongAnswer = oldWrong; q.imgs = oldImgs;
    return { wrongVisible, imgsVisible, wrongShown, wrongText, imgsShown, imgsCount };
  })()`);
  check("复习卡：有错因时显示「回忆错因」按钮", cardUI.wrongVisible);
  check("复习卡：点击后展示错因内容", cardUI.wrongShown && cardUI.wrongText.includes("泰勒"));
  check("复习卡：有原图时显示「查看原图」", cardUI.imgsVisible);
  check("复习卡：原图缩略图渲染", cardUI.imgsShown && cardUI.imgsCount === 1);

  // 6) reviewCfg.tag 持久化（刷新后仍保留）
  await evalJS(`apiCall(API.saveSettings({ reviewCfg })); true`);
  await sleep(500);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const tagPersist = await evalJS(`reviewCfg.tag`);
  check("配置持久化：错因筛选刷新后保留", tagPersist === "careless");

  ws.close();
} catch (e) {
  console.error("测试异常:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时目录失败（可忽略）:", e.message); }
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时数据库失败（可忽略）:", e.message); }
}

console.log(failures === 0 ? "\n调度功能检查全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
