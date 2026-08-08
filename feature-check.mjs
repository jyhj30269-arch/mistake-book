/* v1.4.0 新功能冒烟检查：node feature-check.mjs */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9390;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-feature-"));
const dbFile = join(testDir, "test.db");
const server = spawn("node", ["server.js"], {
  cwd: "C:/Users/32949/Desktop/assets",
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

const profile = mkdtempSync(join(tmpdir(), "mb-feature-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--force-device-scale-factor=1",
  "--window-size=1600,1000", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
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
    .then((r) => (r.exceptionDetails
      ? Promise.reject(new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
      : r.result && r.result.value));

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);
  // 登录（演示账号）
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2200);

  // 1) 导航精简
  const nav = await evalJS(`(() => ({
    sideItems: Array.from(document.querySelectorAll(".nav-item")).map(a => a.textContent.trim()),
    tabItems: Array.from(document.querySelectorAll(".mobile-tabbar a")).map(a => a.textContent.trim()),
    drawerHasSettings: document.querySelectorAll("#mobile-menu .nav-item").length >= 9 && !!document.querySelector("#mobile-menu .nav-item[data-view=settings]")
  }))()`);
  check("侧边栏已删除 随机复习/数据统计", !nav.sideItems.some(t => t.includes("随机复习") || t.includes("数据统计")));
  check("移动 Tab 5 项含「更多」，抽屉含设置", nav.tabItems.length === 5 && nav.tabItems.join().includes("更多") && nav.tabItems.join().includes("待办") && nav.drawerHasSettings);

  // 2) 复习续传按钮
  await evalJS(`localStorage.setItem("review-resume", JSON.stringify({ queue: [1,2,3], idx: 2, done: [0,1], skipped: [], results: [] })); renderResumeButton(); true`);
  const resumeShown = await evalJS(`document.getElementById("review-resume-btn").style.display !== "none" && document.getElementById("review-resume-btn").textContent.includes("已做 2 / 3")`);
  check("续传按钮显示「已做 2 / 3」", resumeShown);
  await evalJS(`continueResume(); true`);
  await sleep(400);
  const resumed = await evalJS(`getComputedStyle(document.getElementById("review-play")).display !== "none" && document.getElementById("rev-progress").textContent === "已做 2 / 共 3"`);
  check("继续上次后进入做题（已做 2/3）", resumed);
  await evalJS(`go("dashboard"); true`);

  // 3) 真实导入预检
  await evalJS(`
    (() => {
      const json = JSON.stringify({
        questions: [
          { id: 900, type: "problem", subject: "subj-math", subSubject: "ss-gaoshu", chapter: "ch-c1", kps: ["极限计算"], tags: ["method"], titleTex: "测试导入题 1", solutionTex: "解", createdAt: Date.now() },
          { id: 901, type: "problem", subject: "subj-math", subSubject: "ss-gaoshu", chapter: "ch-c1", kps: [], tags: [], titleTex: "\\\\lim_{x \\\\to 0} \\\\frac{\\\\sin x - x}{x^3}", solutionTex: "泰勒", createdAt: Date.now() }
        ],
        reviewLogs: [{ id: 1, qid: 900, at: Date.now(), result: "ok" }],
        tree: []
      });
      const f = new File([json], "import.json", { type: "application/json" });
      handleImportFile([f]);
    })()
  `);
  await sleep(500);
  const importModal = await evalJS(`document.getElementById("modal-title").textContent + "|" + document.getElementById("modal-body").innerText.replace(/\\s+/g," ")`);
  check("导入预检弹窗出现且摘要正确（新增1 更新1）",
    importModal.includes("导入预检") && importModal.includes("将新增 1 条") && importModal.includes("将更新 1 条") && importModal.includes("1 条复习记录"));
  await evalJS(`doMergeImport(); true`);
  await sleep(400);
  const merged = await evalJS(`questions.length === 16 && questions.some(q => q.titleTex === "测试导入题 1")`);
  check("合并后 16 题且新题已入库", merged);

  // 4) 题目编辑
  await evalJS(`openDetail(1); openEditModal(1); true`);
  await sleep(300);
  const editModal = await evalJS(`document.getElementById("modal-title").textContent.includes("编辑题目") && !!document.getElementById("edit-title")`);
  check("编辑弹窗打开", editModal);
  await evalJS(`document.getElementById("edit-title").value = "\\\\lim_{x \\\\to 0} \\\\frac{\\\\tan x - x}{x^3}（已编辑）"; saveEditQuestion(); true`);
  await sleep(400);
  const edited = await evalJS(`questions.find(q => q.id === 1).titleTex.includes("已编辑")`);
  check("编辑后题面已更新", edited);
  const dbCheck = await (await fetch(`http://127.0.0.1:${PORT}/api/db`)).json();
  check("编辑已写入 SQLite", dbCheck.questions.find(q => q.id === 1).titleTex.includes("已编辑"));

  // 5) 知识点管理按钮
  await evalJS(`go("settings"); true`);
  await sleep(400);
  const settings = await evalJS(`(() => ({
    hasAddKp: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("＋加知识点")),
    hasRename: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.trim() === "改"),
    hasKpDel: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.dataset.ch && b.textContent.trim() === "删")
  }))()`);
  check("知识点：新增/重命名/删除按钮齐全", settings.hasAddKp && settings.hasRename && settings.hasKpDel);

  // 6) 转手动输入
  await evalJS(`go("input"); true`);
  await evalJS(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleFiles([new File([arr], "q.png", { type: "image/png" })], "q");
    })()
  `);
  await sleep(400);
  await evalJS(`switchManualInput(); true`);
  const manual = await evalJS(`document.getElementById("input-ocr-state").textContent.includes("手动输入") && document.getElementById("input-title") === document.activeElement`);
  check("转手动输入生效且聚焦题面", manual);

  // 6.5) 该题无过程：标记后只识别题面
  await evalJS(`go("input"); resetInput(); true`);
  await evalJS(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleFiles([new File([arr], "nosol.png", { type: "image/png" })], "q");
    })()
  `);
  await sleep(400);
  const noSolToggle = await evalJS(`document.querySelector("#input-q-imgs .bimg-kind").textContent.includes("题目")`);
  await evalJS(`toggleNoSolution(inputImgs.find(x => x.kind === "q").id); true`);
  await sleep(300);
  const noSolMarked = await evalJS(`document.querySelector("#input-q-imgs .bimg-card").classList.contains("no-sol") && inputImgs.some(x => x.noSolution)`);
  await evalJS(`startInputOCR(); true`);
  await sleep(2600);
  const noSolQueue = await evalJS(`inputQueue.length === 1 && inputQueue[0].noSolution === true && inputQueue[0].sImgId === null`);
  const noSolDiag = await evalJS(`JSON.stringify({ marked: inputImgs.filter(x=>x.kind==="q").map(x=>({id:x.id,noSolution:x.noSolution})), queue: inputQueue.map(x=>({qImgId:x.qImgId, sImgId:x.sImgId, noSolution:x.noSolution, status:x.status})) })`);
  console.log("无过程诊断: " + noSolDiag);
  check("该题无过程：标记生效且队列无过程项", noSolToggle && noSolMarked && noSolQueue);

  // 6.6) 自动配对：题目+过程各 1 张，不点配对也识别过程
  await evalJS(`go("input"); resetInput(); true`);
  await evalJS(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleFiles([new File([arr], "aq.png", { type: "image/png" })], "q");
      handleFiles([new File([arr], "as.png", { type: "image/png" })], "s");
    })()
  `);
  await sleep(400);
  await evalJS(`startInputOCR(); true`);
  await sleep(2600);
  const autoPairOk = await evalJS(`inputQueue.length === 1 && inputQueue[0].sImgId != null && !inputQueue[0].noSolution`);
  check("题目+过程各1张不点配对也自动识别过程", autoPairOk);

  // 7) 复习：自由选题 / 跳过
  await evalJS(`go("dashboard"); true`);
  await sleep(500);
  await evalJS(`startReview(); true`);
  await sleep(400);
  const navCount = await evalJS(`document.querySelectorAll("#rev-nav .rev-nav-item").length`);
  check("抽题后题号导航 3 个", navCount === 3);
  await evalJS(`skipCurrent(); true`);
  await sleep(300);
  const afterSkip = await evalJS(`document.getElementById("rev-progress").textContent + "|" + document.querySelector("#rev-nav .rev-nav-item.now").textContent`);
  check("跳过第1题后切到第2题", afterSkip.includes("已做 0 / 共 3") && afterSkip.endsWith("2"));
  await evalJS(`jumpTo(2); true`);
  await sleep(300);
  const jumped = await evalJS(`document.querySelector("#rev-nav .rev-nav-item.now").textContent.trim() === "3"`);
  check("点题号跳到第3题", jumped);
  await evalJS(`selfRate('ok'); true`);
  await sleep(300);
  await evalJS(`selfRate('ok'); true`);
  await sleep(300);
  await evalJS(`selfRate('ok'); true`);
  await sleep(400);
  const done = await evalJS(`getComputedStyle(document.getElementById("review-done")).display !== "none" && document.getElementById("rev-done-stats").innerText.includes("3 / 3")`);
  check("跳过后可回来做，完成小结 3/3", done);

  // 8) 设置：简化按钮 + OCR 配置
  await evalJS(`go("settings"); true`);
  await sleep(400);
  const settings2 = await evalJS(`(() => ({
    addSubject: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("新增科目")),
    addSub: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("＋加子科目")),
    addCh: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("＋加章节")),
    addKp: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("＋加知识点")),
    hasRename: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.trim() === "改"),
    hasKpDel: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.dataset.ch && b.textContent.trim() === "删"),
    ocrCard: !!document.getElementById("ocr-engine"),
    ocrTag: document.getElementById("ocr-mode-tag").textContent
  }))()`);
  console.log("设置页按钮详情: " + JSON.stringify(settings2));
  check("设置：新增科目/＋加子科目/＋加章节/＋加知识点齐全", settings2.addSubject && settings2.addSub && settings2.addCh && settings2.addKp);
  check("设置：OCR 服务配置卡片存在且默认模拟", settings2.ocrCard && settings2.ocrTag.includes("模拟"));

  // 9) v1.9 修复验证：备注可见 / 保存留页 / 选项换行 / 公式渲染
  await evalJS(`go("input"); resetInput(); true`);
  await sleep(400);
  const wrongVisible = await evalJS(`getComputedStyle(document.getElementById("input-wrong")).display !== "none"`);
  check("备注框始终可见可输入", wrongVisible);
  const fmt = await evalJS(`formatOptions("A. 1 B. 2 C. 3 D. 4")`);
  check("选择题选项自动换行（4 行）", String(fmt).split("\n").length === 4);
  await evalJS(`
    (async () => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleFiles([new File([arr], "save.png", { type: "image/png" })], "q");
    })()
  `);
  await sleep(400);
  await evalJS(`startInputOCR(); true`);
  await sleep(2600);
  const beforeSave = await evalJS(`questions.length`);
  await evalJS(`saveCurrentQuestion(); true`);
  await sleep(600);
  const savedStay = await evalJS(`questions.length === ${beforeSave} + 1 && getComputedStyle(document.getElementById("view-input")).display !== "none"`);
  check("保存后留在录入页且已入库", savedStay);
  await evalJS(`go("questions"); openDetail(questions[questions.length - 1].id); true`);
  await sleep(500);
  const katexRendered = await evalJS(`!!document.querySelector("#detail-body .katex-render .katex")`);
  check("题库/详情公式已渲染（KaTeX）", katexRendered);

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

console.log(failures === 0 ? "\n新功能检查全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
