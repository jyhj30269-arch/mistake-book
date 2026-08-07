import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9341;
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

const profile = mkdtempSync(join(tmpdir(), "mb-diag-"));
const browser = spawn(EXE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--force-device-scale-factor=1",
  "--window-size=1920,1080", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"
], { stdio: "ignore" });

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
    .then((r) => r.result && r.result.value);

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: URL });
  await sleep(2600);
  const diag = await evalJS(`(() => {
    const cs = (el) => getComputedStyle(el);
    const viewApp = document.querySelector("#view-app");
    const shell = document.querySelector(".app-shell");
    const nav = document.querySelector(".side-nav");
    const main = document.querySelector(".main");
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), r: Math.round(b.right) }; };
    return {
      innerWidth: window.innerWidth,
      viewApp: { display: cs(viewApp).display, ...r(viewApp) },
      shell: { display: cs(shell).display, width: cs(shell).width, ...r(shell) },
      nav: r(nav),
      main: { display: cs(main).display, flex: cs(main).flex, maxWidth: cs(main).maxWidth, ...r(main) },
      bodyScrollW: document.body.scrollWidth
    };
  })()`);
  console.log(JSON.stringify(diag, null, 2));
  ws.close();
} catch (e) {
  console.error("异常:", e.message);
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
}
