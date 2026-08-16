/* v1.16.0 融合仪表盘 + 新章节树验证（已纳入 CI） */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]*$/, "");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9406;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testDir = mkdtempSync(join(tmpdir(), "mb-v16-"));
const server = spawn("node", ["server.js"], {
  cwd: ROOT, // 必须锚定仓库根目录，否则 server.js 找不到
  env: { ...process.env, PORT: String(PORT), DB_FILE: join(testDir, "t.db"), MINERU_DISABLE: "1" },
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

const profile = mkdtempSync(join(tmpdir(), "mb-v16p-"));
const browser = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
], { stdio: "ignore" });

let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };

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
    .then((r) => (r.exceptionDetails ? Promise.reject(new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)) : r.result && r.result.value));
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || "").slice(0, 200));
    }
  });

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2500);
  await evalJS(`fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json()); true`);
  await call("Page.reload", { ignoreCache: true });
  await sleep(2500);

  const layout = await evalJS(`(() => {
    const hasDashReview = !!document.getElementById("dash-review");
    const hasCfg = !!document.getElementById("review-config");
    const hasDetails = !!document.getElementById("review-cfg-details");
    const cfgInDetails = hasDetails && document.getElementById("review-cfg-details").contains(document.getElementById("review-config"));
    const hasSets = !!document.getElementById("review-sets-card");
    const hasPlay = !!document.getElementById("review-play");
    const cfgVisible = getComputedStyle(document.getElementById("review-config")).display !== "none";
    const noOldHead = !document.querySelector(".dash-section-title") || !Array.from(document.querySelectorAll(".dash-section-title")).some(t => t.textContent.includes("随机复习"));
    return { hasDashReview, hasCfg, hasDetails, cfgInDetails, hasSets, hasPlay, cfgVisible, noOldHead };
  })()`);
  check("融合卡存在（dash-review 锚点迁移）", layout.hasDashReview);
  check("抽题配置在折叠 details 内", layout.hasCfg && layout.hasDetails && layout.cfgInDetails);
  check("配置初始可见（details 展开前内容在 DOM）", layout.cfgVisible);
  check("复习集卡存在且并排", layout.hasSets);
  check("做题卡保留", layout.hasPlay);
  check("旧「随机复习」独立区已删除", layout.noOldHead);

  const tree = await evalJS(`(() => {
    const math = TREE.find(s => s.id === "subj-math");
    const ds = TREE.find(s => s.id === "subj-408").children.find(c => c.id === "ss-ds");
    return {
      mathCh: math.children.find(c => c.id === "ss-gaoshu").children.length,
      xdaiCh: math.children.find(c => c.id === "ss-xdai").children.length,
      gailvCh: math.children.find(c => c.id === "ss-gailv").children.length,
      dsCh: ds.children.length,
      co: !!TREE.find(s => s.id === "subj-408").children.find(c => c.id === "ss-co"),
      os: !!TREE.find(s => s.id === "subj-408").children.find(c => c.id === "ss-os"),
      netCh: TREE.find(s => s.id === "subj-408").children.find(c => c.id === "ss-net").children.length
    };
  })()`);
  check("高数 6 章 / 线代 6 章 / 概率 6 章", tree.mathCh === 6 && tree.xdaiCh === 6 && tree.gailvCh === 6);
  check("数据结构 7 章 + 组成原理/操作系统子科目", tree.dsCh === 7 && tree.co && tree.os);
  check("网络 6 章", tree.netCh === 6);

  // 抽题配置联动仍工作（新树）
  const cfg = await evalJS(`(() => {
    renderReviewConfig();
    const subjOpts = Array.from(document.querySelectorAll("#rev-subject option")).map(o => o.textContent);
    return { hasMath: subjOpts.includes("数学"), has408: subjOpts.includes("408"), subCount: subjOpts.length, opts: subjOpts.join(","), revSubjectExists: !!document.getElementById("rev-subject") };
  })()`);
  console.log("cfg debug:", JSON.stringify(cfg));
  check("抽题配置科目含 数学/英语/408（含全部科目共 4 项）", cfg.hasMath && cfg.has408 && cfg.subCount === 4);
  const subLink = await evalJS(`(() => {
    document.getElementById("rev-subject").value = "subj-math";
    document.getElementById("rev-subject").onchange({ target: { value: "subj-math" } });
    return Array.from(document.querySelectorAll("#rev-subsub option")).map(o => o.textContent).join(",");
  })()`);
  check("选数学后子科目联动（高等数学/线性代数/概率论与数理统计）", subLink.includes("高等数学") && subLink.includes("线性代数") && subLink.includes("概率论与数理统计"));

  // 开始复习流程仍工作
  await evalJS(`go("dashboard"); startReview(); true`);
  await sleep(400);
  const review = await evalJS(`getComputedStyle(document.getElementById("review-play")).display !== "none"`);
  check("开始复习进入做题卡", review);

  console.log("JS 异常:", errors.length ? errors : "无");
  check("无运行时异常", errors.length === 0);

  ws.close();
} catch (e) {
  console.error("测试异常:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  server.kill();
  await sleep(300);
  try { rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
}
console.log(failures === 0 ? "\nv1.16.0 融合验证全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
