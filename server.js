/* ============================================================
   个人工作台 · 本地服务（v1.13.0）
   托管前端页面 + 提供 API + 数据存本地 SQLite（mistake-book.db）
   启动：node server.js  然后浏览器打开 http://127.0.0.1:8788
   ============================================================ */
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
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
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS todos(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    due TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS goals(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT '学习',
    progress INTEGER DEFAULT 0,
    milestone TEXT DEFAULT '',
    target_date TEXT DEFAULT '',
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS daily_reviews(
    day TEXT PRIMARY KEY,
    done TEXT DEFAULT '',
    stuck TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    mood TEXT DEFAULT '',
    updated_at INTEGER,
    stats TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS inbox_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'open',
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS bookmarks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT DEFAULT 'link',
    url TEXT DEFAULT '',
    note TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    created_at INTEGER
  );
`);

/* ---------- 轻量迁移：老库补新列（CREATE TABLE IF NOT EXISTS 不会改已有表） ---------- */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn("todos", "subtasks", "TEXT DEFAULT '[]'");
ensureColumn("todos", "tags", "TEXT DEFAULT '[]'");
ensureColumn("todos", "note", "TEXT DEFAULT ''");
ensureColumn("todos", "remind", "TEXT DEFAULT ''");
ensureColumn("goals", "status", "TEXT DEFAULT 'active'");
ensureColumn("goals", "linked_todos", "TEXT DEFAULT '[]'");
ensureColumn("goals", "milestones", "TEXT DEFAULT '[]'");
ensureColumn("goals", "note", "TEXT DEFAULT ''");
ensureColumn("daily_reviews", "stats", "TEXT DEFAULT '{}'");
/* 健康模块移除：老库直接删除健康表 */
db.exec("DROP TABLE IF EXISTS health_logs;");

/* ---------- 账号与会话（cookie 登录） ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  try {
    const calc = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), calc);
  } catch (e) { return false; }
}
function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  const expires = Date.now() + 7 * 86400000;
  db.prepare("INSERT INTO sessions(token, username, expires_at) VALUES (?,?,?)").run(token, username, expires);
  return { token, expires };
}
function getUserByCookie(req) {
  const m = String(req.headers.cookie || "").match(/mb_session=([^;]+)/);
  if (!m) return null;
  const row = db.prepare("SELECT username, expires_at FROM sessions WHERE token = ?").get(m[1]);
  if (!row || row.expires_at < Date.now()) return null;
  return row.username;
}

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

/* 演示账号：users 表为空时创建（与题库种子独立，已有数据库也会补建） */
function seedUsersIfEmpty() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (n === 0) {
    db.prepare("INSERT INTO users(username, password_hash, created_at) VALUES (?,?,?)")
      .run("admin", hashPassword("admin123"), Date.now());
    console.log("已创建演示账号：admin / admin123（可在登录页注册新账号）");
  }
}
seedUsersIfEmpty();

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

function readTodos() {
  return db.prepare("SELECT id, title, done, due, priority, subtasks, tags, note, remind, created_at FROM todos ORDER BY done, due, priority DESC, id DESC").all()
    .map(r => ({
      id: r.id, title: r.title, done: !!r.done, due: r.due || "", priority: r.priority || 0,
      subtasks: JSON.parse(r.subtasks || "[]"), tags: JSON.parse(r.tags || "[]"),
      note: r.note || "", remind: r.remind || "", createdAt: r.created_at
    }));
}

function readGoals() {
  return db.prepare("SELECT id, title, category, progress, milestone, target_date, status, linked_todos, milestones, note, created_at FROM goals ORDER BY id").all()
    .map(r => ({
      id: r.id, title: r.title, category: r.category, progress: r.progress || 0,
      milestone: r.milestone || "", targetDate: r.target_date || "", status: r.status || "active",
      linkedTodoIds: JSON.parse(r.linked_todos || "[]"), milestones: JSON.parse(r.milestones || "[]"),
      note: r.note || "", createdAt: r.created_at
    }));
}

function readReviews() {
  const rows = db.prepare("SELECT day, done, stuck, plan, mood, stats, updated_at FROM daily_reviews ORDER BY day DESC").all();
  return rows.map(r => ({ day: r.day, done: r.done || "", stuck: r.stuck || "", plan: r.plan || "",
    mood: r.mood || "", stats: JSON.parse(r.stats || "{}"), updatedAt: r.updated_at }));
}

function readInbox() {
  return db.prepare("SELECT id, text, tags, status, created_at FROM inbox_items ORDER BY created_at DESC, id DESC").all()
    .map(r => ({ id: r.id, text: r.text, tags: JSON.parse(r.tags || "[]"), status: r.status || "open", createdAt: r.created_at }));
}

function readBookmarks() {
  return db.prepare("SELECT id, title, kind, url, note, tags, created_at FROM bookmarks ORDER BY created_at DESC, id DESC").all()
    .map(r => ({ id: r.id, title: r.title, kind: r.kind || "link", url: r.url || "", note: r.note || "",
      tags: JSON.parse(r.tags || "[]"), createdAt: r.created_at }));
}

function readPersonal() {
  const s = readSettings();
  return {
    todos: readTodos(),
    goals: readGoals(),
    reviews: readReviews(),
    inbox: readInbox(),
    bookmarks: readBookmarks()
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
    personal: readPersonal(),
    qidSeq: Math.max(100, ...questions.map(q => q.id || 0)),
    reviewSeq: reviewLogs.length || 0
  };
}

function saveDb(data) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM questions; DELETE FROM review_logs; DELETE FROM nodes; DELETE FROM settings; DELETE FROM study_days; DELETE FROM todos; DELETE FROM goals; DELETE FROM daily_reviews; DELETE FROM inbox_items; DELETE FROM bookmarks;");
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
    const p = data.personal || {};
    const insT = db.prepare("INSERT INTO todos(title, done, due, priority, subtasks, tags, note, remind, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    (p.todos || []).forEach(t => insT.run(
      String(t.title || "").slice(0, 200), t.done ? 1 : 0, t.due || "", t.priority || 0,
      JSON.stringify(t.subtasks || []), JSON.stringify(t.tags || []), t.note || "", t.remind || "",
      t.createdAt || Date.now()));
    const insG = db.prepare("INSERT INTO goals(title, category, progress, milestone, target_date, status, linked_todos, milestones, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    (p.goals || []).forEach(g => insG.run(
      String(g.title || "").slice(0, 200), g.category || "学习", g.progress || 0, g.milestone || "",
      g.targetDate || "", g.status || "active", JSON.stringify(g.linkedTodoIds || []),
      JSON.stringify(g.milestones || []), g.note || "", g.createdAt || Date.now()));
    const insR = db.prepare("INSERT INTO daily_reviews(day, done, stuck, plan, mood, stats, updated_at) VALUES (?,?,?,?,?,?,?)");
    (p.reviews || []).forEach(rv => insR.run(rv.day, rv.done || "", rv.stuck || "", rv.plan || "", rv.mood || "",
      JSON.stringify(rv.stats || {}), rv.updatedAt || Date.now()));
    const insI = db.prepare("INSERT INTO inbox_items(id, text, tags, status, created_at) VALUES (?,?,?,?,?)");
    (p.inbox || []).forEach(it => insI.run(it.id, String(it.text || "").slice(0, 1000),
      JSON.stringify(it.tags || []), it.status || "open", it.createdAt || Date.now()));
    const insB = db.prepare("INSERT INTO bookmarks(id, title, kind, url, note, tags, created_at) VALUES (?,?,?,?,?,?,?)");
    (p.bookmarks || []).forEach(b => insB.run(b.id, String(b.title || "").slice(0, 200), b.kind || "link",
      String(b.url || "").slice(0, 2000), String(b.note || "").slice(0, 1000),
      JSON.stringify(b.tags || []), b.createdAt || Date.now()));
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
  ,".pdf": "application/pdf"
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

/* ---------- AI HOT 资讯代理（匿名只读 + 60 秒缓存） ---------- */
const HOT_BASE = "https://aihot.virxact.com/api/v1";
const hotCache = new Map();
async function hotFetch(path) {
  const cached = hotCache.get(path);
  if (cached && Date.now() - cached.at < 60000) return cached.data;
  const res = await fetch(HOT_BASE + path, {
    headers: { "User-Agent": "aihot-skill/1.2.3 (+https://aihot.virxact.com/aihot-skill/)" }
  });
  if (!res.ok) throw new Error(`AI HOT 请求失败（${res.status}）`);
  const data = await res.json();
  hotCache.set(path, { at: Date.now(), data });
  return data;
}

/* ---------- 试卷 PDF 生成（本机无头浏览器打印，KaTeX 渲染公式） ---------- */
const PDF_BROWSERS = [
  process.env.PDF_BROWSER || "",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
function findPdfBrowser() {
  return PDF_BROWSERS.find(p => fs.existsSync(p)) || null;
}
const paperStore = new Map(); // token -> { html, at }

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function paperLatex(s) {
  let t = String(s || "");
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/([（(]?[A-Fa-f][.、)）]\s*)/g, "\n$1"); // 选项换行
  t = t.replace(/```latex|```/g, "");
  t = t.replace(/\$/g, "");
  t = t.replace(/\\begin\{align\*?\}/g, "\\begin{aligned}").replace(/\\end\{align\*?\}/g, "\\end{aligned}");
  t = t.replace(/\\begin\{equation\*?\}/g, "").replace(/\\end\{equation\*?\}/g, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function buildPaperHtml(paper) {
  const qs = (paper.questions || []).map((q, i) => {
    const tag = q.type === "vocabulary" ? "【单词辨析】" : q.type === "essay" ? "【写作/背诵】" : "";
    return `<div class="q">
      <div class="q-num">${i + 1}. ${tag}</div>
      <div class="q-body"><span class="katex-render" data-tex="${escHtml(paperLatex(q.titleTex))}"></span></div>
    </div>`;
  }).join("");
  const ans = paper.answers ? (paper.questions || []).map((q, i) => `
    <div class="q">
      <div class="q-num">${i + 1}.</div>
      <div class="q-ans"><b>答案：</b><span class="katex-render" data-tex="${escHtml(paperLatex(q.solutionTex || "略"))}"></span></div>
    </div>`).join("") : "";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
  <link rel="stylesheet" href="/vendor/katex/katex.min.css">
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; color: #222; line-height: 1.8; }
    .paper-title { text-align:center; font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .paper-sub { text-align:center; font-size: 12px; color: #666; margin-bottom: 18px; }
    .paper-meta { display: flex; justify-content: space-between; font-size: 12px; color: #555; margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
    .q { margin-bottom: 22px; page-break-inside: avoid; }
    .q-num { font-weight: 700; margin-bottom: 4px; }
    .q-body { font-size: 14px; }
    .q-ans { margin-top: 8px; font-size: 12px; color: #555; border-left: 3px solid #eee; padding-left: 8px; }
    .page-break { page-break-before: always; }
  </style></head><body>
  <div class="paper-title">${escHtml(paper.title || "错题巩固卷")}</div>
  <div class="paper-sub">${escHtml(paper.subtitle || "")}</div>
  <div class="paper-meta"><span>姓名：____________</span><span>日期：____年__月__日</span><span>共 ${qs.length} 题</span></div>
  ${qs}
  ${paper.answers ? `<div class="page-break"></div><div class="paper-title">参考答案与解析</div><div style="margin-top:12px;">${ans}</div>` : ""}
  <script src="/vendor/katex/katex.min.js"></script>
  <script>
    document.querySelectorAll(".katex-render").forEach(node => {
      try { katex.render(node.getAttribute("data-tex"), node, { throwOnError: false, displayMode: false }); }
      catch (e) { node.textContent = node.getAttribute("data-tex"); }
    });
  </script>
  </body></html>`;
}

function generatePdfFromHtml(html) {
  return new Promise((resolve, reject) => {
    const browser = findPdfBrowser();
    if (!browser) return reject(new Error("未检测到 Edge / Chrome，无法导出 PDF"));
    const token = crypto.randomBytes(12).toString("hex");
    paperStore.set(token, { html, at: Date.now() });
    const htmlUrl = `http://127.0.0.1:${PORT}/api/paper/html?t=${token}`;
    const outFile = path.join(os.tmpdir(), `mb-paper-${token}.pdf`);
    execFile(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--virtual-time-budget=5000", "--print-to-pdf-no-header",
      `--print-to-pdf=${outFile}`, htmlUrl
    ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err) => {
      paperStore.delete(token);
      if (err) {
        fs.unlink(outFile, () => {});
        return reject(new Error("PDF 生成失败：" + String(err.message).slice(0, 200)));
      }
      fs.readFile(outFile, (e2, buf) => {
        fs.unlink(outFile, () => {});
        if (e2) return reject(e2);
        resolve(buf);
      });
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
    // 账号与会话
    if (p === "/api/auth/register" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const name = String(body.username || "").trim();
        const pw = String(body.password || "");
        if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(name)) return sendJson(res, 400, { code: 40001, message: "用户名需 3-20 位（字母/数字/中文/下划线）" });
        if (pw.length < 6 || pw.length > 64) return sendJson(res, 400, { code: 40002, message: "密码需 6-64 位" });
        const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
        if (exists) return sendJson(res, 409, { code: 40901, message: "用户名已存在" });
        db.prepare("INSERT INTO users(username, password_hash, created_at) VALUES (?,?,?)").run(name, hashPassword(pw), Date.now());
        const { token, expires } = createSession(name);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": `mb_session=${token}; Path=/; HttpOnly; Max-Age=${Math.floor(expires / 1000)}; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true, user: name }));
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/auth/login" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const name = String(body.username || "").trim();
        const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(name);
        if (!row || !verifyPassword(String(body.password || ""), row.password_hash)) return sendJson(res, 401, { code: 40101, message: "用户名或密码错误" });
        const { token, expires } = createSession(name);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": `mb_session=${token}; Path=/; HttpOnly; Max-Age=${Math.floor(expires / 1000)}; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true, user: name }));
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/auth/logout" && req.method === "POST") {
      const m = String(req.headers.cookie || "").match(/mb_session=([^;]+)/);
      if (m) db.prepare("DELETE FROM sessions WHERE token = ?").run(m[1]);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": "mb_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (p === "/api/auth/me" && req.method === "GET") {
      const user = getUserByCookie(req);
      if (!user) return sendJson(res, 401, { code: 40100, message: "未登录" });
      sendJson(res, 200, { user });
      return;
    }
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
    if (p === "/api/hot/items" && req.method === "GET") {
      try {
        const params = new URLSearchParams({
          mode: "selected",
          window: url.searchParams.get("window") || "24h",
          limit: url.searchParams.get("limit") || "30"
        });
        if (url.searchParams.get("q")) params.set("q", url.searchParams.get("q"));
        if (url.searchParams.get("category")) params.set("category", url.searchParams.get("category"));
        sendJson(res, 200, await hotFetch("/items?" + params.toString()));
      } catch (e) { sendJson(res, 502, { code: 50201, message: e.message }); }
      return;
    }
    if (p === "/api/hot/topics" && req.method === "GET") {
      try { sendJson(res, 200, await hotFetch("/hot-topics")); }
      catch (e) { sendJson(res, 502, { code: 50201, message: e.message }); }
      return;
    }
    if (p === "/api/hot/daily" && req.method === "GET") {
      try { sendJson(res, 200, await hotFetch("/dailies/latest")); }
      catch (e) { sendJson(res, 502, { code: 50201, message: e.message }); }
      return;
    }
    if (p === "/api/paper/html" && req.method === "GET") {
      const entry = paperStore.get(url.searchParams.get("t") || "");
      if (!entry) { res.writeHead(404).end("404"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(entry.html);
      return;
    }
    if (p === "/api/paper/pdf" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const buf = await generatePdfFromHtml(buildPaperHtml(body));
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="paper-${Date.now()}.pdf"`
        });
        res.end(buf);
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/bookmark/file" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const name = String(body.name || "file.pdf");
        const buf = Buffer.from(String(body.dataUrl || "").split(",")[1] || "", "base64");
        if (!buf.length) return sendJson(res, 400, { code: 40001, message: "文件数据为空" });
        const dir = path.join(ROOT, "uploads");
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(name).toLowerCase().slice(0, 10) || ".pdf";
        const safe = "bm-" + crypto.randomBytes(8).toString("hex") + ext;
        fs.writeFileSync(path.join(dir, safe), buf);
        sendJson(res, 200, { ok: true, url: "/uploads/" + safe, name });
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
  console.log(`个人工作台本地服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`数据库：${DB_FILE}（SQLite）`);
  console.log(`OCR：${MINERU_AVAILABLE ? "MinerU 真实识别（mineru-open-api）" : "模拟识别（未检测到 mineru-open-api）"}`);
  console.log("按 Ctrl+C 停止服务");
});
