/* ============================================================
   考研错题本 · 本地服务（v1.6.0）
   托管前端页面 + 提供 API + 数据存本地 SQLite（mistake-book.db）
   启动：node server.js  然后浏览器打开 http://127.0.0.1:8788
   ============================================================ */
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { TREE, QUESTIONS, REVIEW_LOGS } = require("./seed-data.js");

const ROOT = __dirname;
const PORT = process.env.PORT || 8788;
const DB_FILE = process.env.DB_FILE || path.join(ROOT, "mistake-book.db");
const MINERU_CLI = path.join(process.env.APPDATA || "", "npm", "mineru-open-api.cmd");
const MINERU_AVAILABLE = fs.existsSync(MINERU_CLI) && process.env.MINERU_DISABLE !== "1";

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS questions(
    id INTEGER PRIMARY KEY,
    type TEXT, subject TEXT, sub_subject TEXT, chapter TEXT,
    kps TEXT, tags TEXT, title_tex TEXT, solution_tex TEXT,
    wrong_answer TEXT, note TEXT, marks TEXT, created_at INTEGER,
    urgent INTEGER DEFAULT 0, calc_weak INTEGER DEFAULT 0, need_consolidate INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS review_logs(
    id INTEGER PRIMARY KEY, qid INTEGER, at INTEGER, result TEXT
  );
  CREATE TABLE IF NOT EXISTS nodes(
    id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, kind TEXT, ord INTEGER
  );
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS study_days(day TEXT PRIMARY KEY, seconds INTEGER DEFAULT 0);
`);

/* ---------- 种子初始化（仅当 questions 表为空） ---------- */
function seedIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM questions").get();
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insQ = db.prepare(`INSERT INTO questions
      (id, type, subject, sub_subject, chapter, kps, tags, title_tex, solution_tex,
       wrong_answer, note, marks, created_at, urgent, calc_weak, need_consolidate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const q of QUESTIONS) {
      insQ.run(q.id, q.type, q.subject, q.subSubject, q.chapter,
        JSON.stringify(q.kps), JSON.stringify(q.tags), q.titleTex, q.solutionTex,
        q.wrongAnswer, q.note, JSON.stringify(q.marks), q.createdAt,
        q.urgent ? 1 : 0, q.calcWeak ? 1 : 0, q.needConsolidate ? 1 : 0);
    }
    const insL = db.prepare("INSERT INTO review_logs(id, qid, at, result) VALUES (?,?,?,?)");
    for (const l of REVIEW_LOGS) insL.run(l.id, l.qid, l.at, l.result);
    const insN = db.prepare("INSERT INTO nodes(id, parent_id, name, kind, ord) VALUES (?,?,?,?,?)");
    let ord = 0;
    const walk = (nodes, parentId, kind) => {
      nodes.forEach((n, i) => {
        const id = typeof n === "string" ? n : n.id;
        const name = typeof n === "string" ? n : n.name;
        insN.run(id, parentId, name, kind, i + ord);
        if (typeof n !== "string" && n.children) walk(n.children, id, kind === "subject" ? "sub" : kind === "sub" ? "chapter" : "kp");
      });
    };
    walk(TREE, null, "subject");
    ord += 1000;
    db.prepare("INSERT INTO settings(key, value) VALUES (?,?)").run("remindOn", "true");
    db.prepare("INSERT INTO settings(key, value) VALUES (?,?)").run("reviewCfg", JSON.stringify({ sub: "all", chapter: "", lv: "all", num: 3 }));
    db.exec("COMMIT");
    console.log("SQLite 首次初始化：已写入种子数据（15 题 / 28 条复习记录 / 知识点树）");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
seedIfEmpty();

/* ---------- 数据组装 ---------- */
function flattenTree() {
  const rows = db.prepare("SELECT id, parent_id, name, kind, ord FROM nodes ORDER BY ord").all();
  const subjects = [];
  const byParent = {};
  for (const r of rows) {
    const key = r.parent_id || "";
    (byParent[key] = byParent[key] || []).push(r);
  }
  const kpToNode = (parentId) => (byParent[parentId] || []).map(r => r.name);
  const chapterToObj = (parentId) => (byParent[parentId] || []).map(r => ({ id: r.id, name: r.name, children: kpToNode(r.id) }));
  const subToObj = (parentId) => (byParent[parentId] || []).map(r => ({ id: r.id, name: r.name, children: chapterToObj(r.id) }));
  for (const r of byParent[""] || []) {
    subjects.push({ id: r.id, name: r.name, children: subToObj(r.id) });
  }
  return subjects;
}

function readQuestions() {
  return db.prepare("SELECT * FROM questions ORDER BY id").all().map(r => ({
    id: r.id, type: r.type, subject: r.subject, subSubject: r.sub_subject, chapter: r.chapter,
    kps: JSON.parse(r.kps || "[]"), tags: JSON.parse(r.tags || "[]"),
    titleTex: r.title_tex, solutionTex: r.solution_tex, wrongAnswer: r.wrong_answer,
    note: r.note, marks: JSON.parse(r.marks || "{}"), createdAt: r.created_at,
    urgent: !!r.urgent, calcWeak: !!r.calc_weak, needConsolidate: !!r.need_consolidate
  }));
}

function readLogs() {
  return db.prepare("SELECT id, qid, at, result FROM review_logs ORDER BY id").all();
}

function readSettings() {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM settings").all()) out[r.key] = r.value;
  return out;
}

function readStudy() {
  const days = {};
  for (const r of db.prepare("SELECT day, seconds FROM study_days").all()) days[r.day] = r.seconds;
  const s = readSettings();
  return {
    seconds: Number(s.study_seconds || 0),
    blurPrompt: s.blur_prompt === "true",
    perDay: days
  };
}

function getDb() {
  const questions = readQuestions();
  const reviewLogs = readLogs();
  const s = readSettings();
  return {
    schema_version: 1,
    questions,
    reviewLogs,
    tree: flattenTree(),
    study: readStudy(),
    remindOn: s.remindOn !== "false",
    reviewCfg: JSON.parse(s.reviewCfg || '{"sub":"all","chapter":"","lv":"all","num":3}'),
    qidSeq: Math.max(100, ...questions.map(q => q.id || 0)),
    reviewSeq: reviewLogs.length || 0
  };
}

function saveDb(data) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM questions; DELETE FROM review_logs; DELETE FROM nodes; DELETE FROM settings; DELETE FROM study_days;");
    const insQ = db.prepare(`INSERT INTO questions
      (id, type, subject, sub_subject, chapter, kps, tags, title_tex, solution_tex,
       wrong_answer, note, marks, created_at, urgent, calc_weak, need_consolidate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const q of (data.questions || [])) {
      insQ.run(q.id, q.type, q.subject, q.subSubject, q.chapter,
        JSON.stringify(q.kps || []), JSON.stringify(q.tags || []), q.titleTex, q.solutionTex || "",
        q.wrongAnswer || "", q.note || "", JSON.stringify(q.marks || {}), q.createdAt,
        q.urgent ? 1 : 0, q.calcWeak ? 1 : 0, q.needConsolidate ? 1 : 0);
    }
    const insL = db.prepare("INSERT INTO review_logs(id, qid, at, result) VALUES (?,?,?,?)");
    (data.reviewLogs || []).forEach(l => insL.run(l.id, l.qid, l.at, l.result));
    const insN = db.prepare("INSERT INTO nodes(id, parent_id, name, kind, ord) VALUES (?,?,?,?,?)");
    let ord = 0;
    const walk = (nodes, parentId, kind) => {
      (nodes || []).forEach(n => {
        const id = typeof n === "string" ? n : n.id;
        const name = typeof n === "string" ? n : n.name;
        insN.run(id, parentId, name, kind, ord++);
        if (typeof n !== "string" && n.children) walk(n.children, id, kind === "subject" ? "sub" : kind === "sub" ? "chapter" : "kp");
      });
    };
    walk(data.tree || [], null, "subject");
    const insS = db.prepare("INSERT INTO settings(key, value) VALUES (?,?)");
    insS.run("remindOn", String(!!data.remindOn));
    insS.run("reviewCfg", JSON.stringify(data.reviewCfg || { sub: "all", chapter: "", lv: "all", num: 3 }));
    insS.run("study_seconds", String((data.study && data.study.seconds) || 0));
    insS.run("blur_prompt", String(!!(data.study && data.study.blurPrompt)));
    const insD = db.prepare("INSERT INTO study_days(day, seconds) VALUES (?,?)");
    Object.entries((data.study && data.study.perDay) || {}).forEach(([day, sec]) => insD.run(day, sec));
    db.exec("COMMIT");
    return { ok: true };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ---------- 相似度（去重） ---------- */
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}
function jaccard(a, b) {
  const big = (x) => { const out = new Set(); for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2)); return out; };
  const A = big(norm(a)), B = big(norm(b));
  if (!A.size && !B.size) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

/* ---------- MIME ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff": "font/woff",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8"
};

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 50 * 1024 * 1024) { req.destroy(); reject(new Error("body 过大")); } });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("JSON 解析失败")); }
    });
    req.on("error", reject);
  });
}

/* ---------- MinerU 真实识别（官方 CLI：extract 优先，flash-extract 回退） ---------- */
function mineruRecognize(dataUrl) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(String(dataUrl || "").split(",")[1] || "", "base64");
    if (!buf.length) return reject(new Error("图片数据为空"));
    const tmp = path.join(os.tmpdir(), `mb-ocr-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
    fs.writeFileSync(tmp, buf);
    const run = (args, done) => {
      execFile("cmd.exe", ["/c", MINERU_CLI, ...args], {
        timeout: 240000, maxBuffer: 20 * 1024 * 1024, windowsHide: true
      }, done);
    };
    const cleanup = () => fs.unlink(tmp, () => {});
    run(["extract", tmp, "-f", "md", "--model", "pipeline", "--ocr", "--formula"], (err, stdout, stderr) => {
      if (err) {
        // extract 失败（token/限流/超限等）→ 回退免 token 的 flash-extract
        run(["flash-extract", tmp], (err2, out2, err2s) => {
          cleanup();
          if (err2) reject(new Error("MinerU 识别失败：" + String(stderr || err2s || err2.message).slice(0, 300)));
          else resolve({ text: (out2 || "").trim(), source: "mineru-flash" });
        });
        return;
      }
      cleanup();
      resolve({ text: (stdout || "").trim(), source: "mineru" });
    });
  });
}

/* ---------- HTTP 路由 ---------- */
let writeQueue = Promise.resolve();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // API
  if (p.startsWith("/api/")) {
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" }); res.end(); return; }
    if (p === "/api/db" && req.method === "GET") { sendJson(res, 200, getDb()); return; }
    if (p === "/api/db" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => saveDb(body));
        const r = await writeQueue;
        sendJson(res, 200, r);
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/questions" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => {
          const insQ = db.prepare(`INSERT INTO questions
            (id, type, subject, sub_subject, chapter, kps, tags, title_tex, solution_tex,
             wrong_answer, note, marks, created_at, urgent, calc_weak, need_consolidate)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          insQ.run(body.id, body.type, body.subject, body.subSubject, body.chapter,
            JSON.stringify(body.kps || []), JSON.stringify(body.tags || []), body.titleTex, body.solutionTex || "",
            body.wrongAnswer || "", body.note || "", JSON.stringify(body.marks || {}), body.createdAt,
            body.urgent ? 1 : 0, body.calcWeak ? 1 : 0, body.needConsolidate ? 1 : 0);
        });
        await writeQueue;
        sendJson(res, 200, { ok: true, id: body.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const delM = p.match(/^\/api\/questions\/(\d+)$/);
    if (delM && req.method === "DELETE") {
      const id = Number(delM[1]);
      writeQueue = writeQueue.then(() => {
        db.prepare("DELETE FROM review_logs WHERE qid = ?").run(id);
        db.prepare("DELETE FROM questions WHERE id = ?").run(id);
      });
      await writeQueue;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === "/api/review-logs" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare("INSERT INTO review_logs(id, qid, at, result) VALUES (?,?,?,?)").run(body.id, body.qid, body.at, body.result));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/study" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('study_seconds', ?)").run(String(body.seconds || 0)));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/dedup/check" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const windowMs = 7 * 86400000;
        const hits = readQuestions().filter(q =>
          q.id !== body.excludeId && q.subject === body.subject && q.type === body.type &&
          Date.now() - q.createdAt <= windowMs && jaccard(q.titleTex, body.titleTex) > 0.7);
        sendJson(res, 200, hits);
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/ocr/recognize" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const t0 = Date.now();
        const isSolution = !!body.isSolution;
        if (MINERU_AVAILABLE) {
          const r = await mineruRecognize(body.dataUrl);
          sendJson(res, 200, {
            taskId: "mineru-" + Date.now(),
            titleTex: isSolution ? "" : r.text,
            solutionTex: isSolution ? r.text : "",
            lowConf: [],
            source: r.source,
            costSec: Math.round((Date.now() - t0) / 1000)
          });
        } else {
          await new Promise(r => setTimeout(r, 900 + Math.random() * 900));
          sendJson(res, 200, {
            taskId: "mock-" + Date.now(),
            titleTex: isSolution ? "" : "\\lim_{x \\to 0} \\frac{1 - \\cos x}{x \\sin x}",
            solutionTex: isSolution ? "1 - \\cos x \\sim \\frac{x^2}{2}，x \\sin x \\sim x^2，故极限 = \\frac{1}{2}" : "",
            lowConf: [],
            source: "mock-server"
          });
        }
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    sendJson(res, 404, { code: 40400, message: "接口不存在" });
    return;
  }

  // 静态文件
  const rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { sendJson(res, 403, { code: 40300, message: "禁止访问" }); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (file === path.join(ROOT, "index.html")) res.writeHead(404).end("404");
      else res.writeHead(404).end("404");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`考研错题本本地服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`数据库：${DB_FILE}（SQLite）`);
  console.log(`OCR：${MINERU_AVAILABLE ? "MinerU 真实识别（mineru-open-api）" : "模拟识别（未检测到 mineru-open-api）"}`);
  console.log("按 Ctrl+C 停止服务");
});
