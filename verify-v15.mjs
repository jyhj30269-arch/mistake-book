/* v1.15.0 新功能检查：node verify-v15.mjs
   覆盖：复习热力图+连续打卡 / 今日复习任务行 / 自建复习集全链路 /
   默写模式 / 学情周报 / CSV 导入 / 题库分页 / 深色模式持久化 /
   OCR 单题重试按钮 / 移动端题库卡片 / 全文搜索（笔记） */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9396;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-v15-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_FILE: dbFile, MINERU_DISABLE: "1" },
  stdio: "ignore"
});
await sleep(2000);

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

const profile = mkdtempSync(join(tmpdir(), "mb-v15-"));
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
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: URL });
  await sleep(2500);
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 1) 热力图 + 连续打卡 + 今日任务行
  const heat = await evalJS(`(() => {
    const canvas = document.querySelectorAll("#stats-heatmap canvas").length;
    const streak = document.getElementById("heatmap-streak").textContent;
    const line = document.getElementById("due-task-line").textContent;
    return { canvas, streakHas: /\\d+ 天/.test(streak), lineHasDue: line.includes("今日到期") && line.includes("连续打卡") };
  })()`);
  check("热力图：ECharts calendar 已渲染", heat.canvas >= 1);
  check("热力图：连续打卡天数显示", heat.streakHas);
  check("今日任务行：到期/已复习/打卡", heat.lineHasDue);

  // 2) 自建复习集全链路：创建 → 题库勾选加入 → 按集复习 → 持久化
  await evalJS(`addReviewSet(); true`);
  await evalJS(`document.getElementById("rs-name").value = "冲刺组"; doAddReviewSet(); true`);
  await sleep(400);
  const setCreated = await evalJS(`reviewSets.length === 1 && reviewSets[0].name === "冲刺组"`);
  check("复习集：创建成功", setCreated);
  await evalJS(`go("questions"); qSel.clear(); qSel.add(1); qSel.add(2); pickReviewSet(); true`);
  await sleep(300);
  await evalJS(`document.querySelector('input[name="rs-pick"]').checked = true; doAddToSet(); true`);
  await sleep(400);
  const setJoin = await evalJS(`reviewSets[0].qids.length === 2`);
  check("复习集：题库勾选加入 2 题", setJoin);
  await evalJS(`go("dashboard"); startSetReview(reviewSets[0].id); true`);
  await sleep(300);
  const setReview = await evalJS(`reviewQueue.length === 2 && document.getElementById("review-play").style.display !== "none"`);
  check("复习集：按集复习开始", setReview);
  await evalJS(`reviewExit(); closeModal(); true`);
  await sleep(300);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const setPersist = await evalJS(`reviewSets.length === 1 && reviewSets[0].qids.length === 2`);
  check("复习集：刷新后持久化", setPersist);

  // 3) 默写模式（vocabulary 题）
  const writeUI = await evalJS(`(() => {
    const q = questions.find(x => x.id === 11); // vocabulary
    reviewQueue = [q]; reviewIdx = 0; reviewDone = new Set(); reviewSkipped = new Set();
    showReviewCard();
    const wrapVisible = document.getElementById("rev-write-wrap").style.display !== "none";
    toggleRevWrite();
    const boxShown = document.getElementById("rev-write-box").style.display !== "none";
    return { wrapVisible, boxShown };
  })()`);
  check("默写模式：词汇题显示默写入口", writeUI.wrapVisible);
  check("默写模式：输入框可展开", writeUI.boxShown);

  // 4) 学情周报（周月总结页）
  await evalJS(`go("summary"); true`);
  await sleep(400);
  const learn = await evalJS(`document.getElementById("summary-learn").textContent.length > 10`);
  check("学情周报：薄弱知识点/错因分布渲染", learn);

  // 5) CSV 导入
  const csvBefore = await evalJS(`questions.length`);
  await evalJS(`(() => {
    const csv = "题面,解析,错因,科目,子科目,章节,知识点,标签\\n" +
      "CSV测试题1,\\\\lim_{x\\\\to 0} x,计算失误,数学,高等数学,第 1 章 函数、极限与连续,极限计算,method\\n" +
      "CSV测试题2,解析二,,英语,单词,易混词辨析,动词辨析,other";
    const f = new File([csv], "t.csv", { type: "text/csv" });
    handleCsvFile([f]);
  })(); true`);
  await sleep(600);
  const csvAfter = await evalJS(`questions.filter(q => q.titleTex.includes("CSV测试题")).length`);
  check("CSV 导入：新增 2 题", csvAfter === 2);
  const csvMeta = await evalJS(`(() => {
    const q = questions.find(x => x.titleTex === "CSV测试题1");
    return q && q.kps.includes("极限计算") && q.tags.includes("method") && q.subject === "subj-math" && q.wrongAnswer === "计算失误";
  })()`);
  check("CSV 导入：科目/知识点/标签/错因映射正确", csvMeta);

  // 6) 题库分页（造 120 题 → 显示 100 → 加载更多）
  await evalJS(`(() => { for (let i = 0; i < 120; i++) questions.push(mkQ({ titleTex: "分页题 " + i, createdAt: Date.now() })); qPage = 1; renderQuestions(); })(); true`);
  await sleep(600);
  const page1 = await evalJS(`document.getElementById("q-count").textContent`);
  check("分页：默认显示 100 条", /显示 100 \/ \d+ 条/.test(page1));
  await evalJS(`loadMoreQuestions(); true`);
  await sleep(400);
  const page2 = await evalJS(`document.getElementById("q-count").textContent`);
  check("分页：加载更多后显示全部", /显示 1\d\d \/ \d+ 条/.test(page2) && !page2.includes("100 /"));
  // 清理造出来的题（不持久化，仅内存）
  await evalJS(`questions = questions.filter(q => !String(q.titleTex).startsWith("分页题")); renderQuestions(); true`);

  // 7) 全文搜索：笔记可搜
  const noteSearch = await evalJS(`(() => {
    const q = questions.find(x => x.id === 1);
    const oldNote = q.note; q.note = "独家搜索关键词XYZ";
    document.getElementById("q-search").value = "独家搜索关键词XYZ";
    const list = filteredQuestions();
    q.note = oldNote;
    document.getElementById("q-search").value = "";
    return list.some(x => x.id === 1);
  })()`);
  check("全文搜索：笔记内容可命中", noteSearch);

  // 8) OCR 单题重试按钮（failed 状态显示）
  const retryUI = await evalJS(`(() => {
    go("input");
    inputImgs = [{ id: 1, kind: "q", dataUrl: "data:image/png;base64,iVBORw0KGgo=", name: "q.png" }];
    inputQueue = [{ qImgId: 1, sImgId: null, titleTex: "", solutionTex: "", status: "failed", noSolution: true }];
    inputCursor = 0;
    renderInputReview();
    const shown = document.getElementById("input-retry-btn").style.display !== "none";
    inputQueue = []; inputImgs = [];
    return shown;
  })()`);
  check("OCR：失败题显示单题重试按钮", retryUI);

  // 9) 深色模式 + 持久化
  await evalJS(`theme = "dark"; applyTheme(); apiCall(API.saveSettings({ theme })); true`);
  await sleep(500);
  const darkNow = await evalJS(`document.documentElement.dataset.theme`);
  check("深色模式：切换生效", darkNow === "dark");
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);
  const darkAfter = await evalJS(`document.documentElement.dataset.theme`);
  check("深色模式：刷新后保留", darkAfter === "dark");
  await evalJS(`theme = "light"; applyTheme(); apiCall(API.saveSettings({ theme })); true`);

  // 10) 移动端题库卡片
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evalJS(`go("questions"); true`);
  await sleep(500);
  const mobCard = await evalJS(`document.querySelectorAll(".q-card-item").length >= 1`);
  check("移动端：题库渲染为卡片", mobCard);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

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

console.log(failures === 0 ? "\nv1.15.0 功能检查全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
