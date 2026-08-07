/* v1.4.0 新功能冒烟检查：node feature-check.mjs */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9342;
const URL = "file:///C:/Users/32949/Desktop/assets/index.html?auto=1&view=dashboard";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  "--window-size=1600,1000", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"
], { stdio: "ignore" });

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

try {
  const ws = new WebSocket(await getWsUrl(PORT));
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
    .then((r) => (r.exceptionDetails ? Promise.reject(new Error(r.exceptionDetails.text)) : r.result && r.result.value));

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);

  // 1) 导航精简
  const nav = await evalJS(`(() => ({
    sideItems: Array.from(document.querySelectorAll(".nav-item")).map(a => a.textContent.trim()),
    tabItems: Array.from(document.querySelectorAll(".mobile-tabbar a")).map(a => a.textContent.trim())
  }))()`);
  check("侧边栏已删除 随机复习/数据统计", !nav.sideItems.some(t => t.includes("随机复习") || t.includes("数据统计")));
  check("移动 Tab 只剩 4 项", nav.tabItems.length === 4 && nav.tabItems.join().includes("设置"));

  // 2) 复习续传按钮
  await evalJS(`localStorage.setItem("review-resume", JSON.stringify({ queue: [1,2,3], idx: 1, results: [] })); renderResumeButton(); true`);
  const resumeShown = await evalJS(`document.getElementById("review-resume-btn").style.display !== "none" && document.getElementById("review-resume-btn").textContent.includes("1 / 3")`);
  check("续传按钮显示「已做 1 / 3」", resumeShown);
  await evalJS(`continueResume(); true`);
  await sleep(400);
  const resumed = await evalJS(`getComputedStyle(document.getElementById("review-play")).display !== "none" && document.getElementById("rev-progress").textContent === "2 / 3"`);
  check("继续上次后进入做题（2/3）", resumed);
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
  const edited = await evalJS(`questions.find(q => q.id === 1).titleTex.includes("已编辑") && JSON.parse(localStorage.getItem("mb-local-db-v1")).questions.find(q => q.id === 1).titleTex.includes("已编辑")`);
  check("编辑后题面已保存并持久化", edited);

  // 5) 知识点管理按钮
  await evalJS(`go("settings"); true`);
  await sleep(400);
  const settings = await evalJS(`(() => ({
    hasAddKp: !!Array.from(document.querySelectorAll("#settings-tree button")).find(b => b.textContent.includes("＋知识点")),
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
      handleFiles([new File([arr], "q.png", { type: "image/png" })]);
    })()
  `);
  await sleep(400);
  await evalJS(`switchManualInput(); true`);
  const manual = await evalJS(`document.getElementById("input-ocr-state").textContent.includes("手动输入") && document.getElementById("input-title") === document.activeElement`);
  check("转手动输入生效且聚焦题面", manual);

  ws.close();
} catch (e) {
  console.error("测试异常:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.warn("清理临时目录失败（可忽略）:", e.message); }
}

console.log(failures === 0 ? "\n新功能检查全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
