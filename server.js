/* ============================================================
   个人工作台 · 本地服务（v1.17.0）
   托管前端页面 + 提供 API + 数据存本地 SQLite（mistake-book.db）
   启动：node server.js  然后浏览器打开 http://127.0.0.1:8788
   v1.17.0：前端业务逻辑拆分为 js/01-core ~ js/12-boot（经典 script 顺序加载）。
   v1.16.0：知识点树自动升级为完整章节体系（数学 18 章 / 408 四科 25 章）。
   v1.15.0：自建复习集 CRUD（/api/review-sets）；备份恢复
   （/api/restore，校验 SQLite 头 + 恢复前自动备份当前库）；
   settings 扩展（theme / remindDate / reviewResume）；启动自检横幅。
   v1.14.0：个人数据/题目/复习记录全部支持增量写接口；题目原图上传
   （/api/question-image）；整库备份（/api/backup，VACUUM INTO）与
   启动自动备份（backups/，保留 7 份）；删除收藏连带清理上传文件；
   重置演示数据（/api/reset）统一走 seed-data.js 重播。
   v1.13.3：修复畸形 URL 导致服务崩溃；除登录相关与试卷 HTML（随机 token 保护）
   外的所有 API 强制 Cookie 会话鉴权；移除 CORS 通配；静态文件禁止下载
   数据库与 .git；过期会话定期清理。
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

/* Node 版本检查：node:sqlite 需要 Node >= 22.5 */
(function checkNodeVersion() {
  const v = process.versions.node.split(".").map(Number);
  if (!(v[0] > 22 || (v[0] === 22 && v[1] >= 5))) {
    console.error(`当前 Node.js 版本 ${process.versions.node} 过旧：本应用依赖 node:sqlite，需要 Node.js >= 22.5.0。`);
    console.error("请到 https://nodejs.org 安装最新的 LTS 版本后重试。");
    process.exit(1);
  }
})();

let db = new DatabaseSync(DB_FILE);
/* 建表 + 轻量迁移（恢复备份后重开连接时也要执行一次） */
function initDb() {
  db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS questions(
    id INTEGER PRIMARY KEY,
    type TEXT, subject TEXT, sub_subject TEXT, chapter TEXT,
    kps TEXT, tags TEXT, title_tex TEXT, solution_tex TEXT,
    wrong_answer TEXT, note TEXT, marks TEXT, created_at INTEGER,
    urgent INTEGER DEFAULT 0, calc_weak INTEGER DEFAULT 0, need_consolidate INTEGER DEFAULT 0,
    imgs TEXT DEFAULT '[]'
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
  CREATE TABLE IF NOT EXISTS review_sets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    qids TEXT DEFAULT '[]',
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
  ensureColumn("questions", "imgs", "TEXT DEFAULT '[]'");
  /* 健康模块移除：老库直接删除健康表 */
  db.exec("DROP TABLE IF EXISTS health_logs;");
}
initDb();

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

/* 知识点树升级（v1.16.0）：检测到旧版树（缺完整章节体系）时整树替换为种子树。
   题目数据不受影响；用户自定义节点会被重置（单用户工具，升级日志会说明）。 */
function upgradeSeedTree() {
  const hasNew = db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE id IN ('ch-c2','ch-d1','ch-co1','ch-os1','ch-n1')").get().n;
  if (hasNew >= 3) return; // 已是最新章节体系
  db.exec("DELETE FROM nodes");
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
  walk(TREE, null, "subject");
  console.log("知识点树已升级为完整章节体系（数学 18 章 / 408 四科 25 章，共 46 章 90 知识点）");
}
upgradeSeedTree();

/* 启动自动备份：每天一份（VACUUM INTO 一致性快照），保留最近 7 份 */
function autoBackup() {
  const dir = path.join(ROOT, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `mistake-book-${today}.db`);
  if (fs.existsSync(target)) return;
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const olds = fs.readdirSync(dir).filter(f => /^mistake-book-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    while (olds.length > 7) fs.unlinkSync(path.join(dir, olds.shift()));
    console.log(`已自动备份数据库：${target}`);
  } catch (e) { console.warn("自动备份失败（可忽略）：", e.message); }
}
autoBackup();

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
    urgent: !!r.urgent, calcWeak: !!r.calc_weak, needConsolidate: !!r.need_consolidate,
    imgs: JSON.parse(r.imgs || "[]")
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

function readReviewSets() {
  return db.prepare("SELECT id, name, qids, created_at FROM review_sets ORDER BY id").all()
    .map(r => ({ id: r.id, name: r.name, qids: JSON.parse(r.qids || "[]"), createdAt: r.created_at }));
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
    theme: s.theme === "dark" ? "dark" : "light",
    remindDate: s.remindDate || "",
    reviewResume: (() => { try { return JSON.parse(s.reviewResume || "null"); } catch (e) { return null; } })(),
    reviewCfg: JSON.parse(s.reviewCfg || '{"sub":"all","chapter":"","lv":"all","num":3}'),
    personal: readPersonal(),
    reviewSets: readReviewSets(),
    qidSeq: Math.max(100, ...questions.map(q => q.id || 0)),
    reviewSeq: reviewLogs.length || 0
  };
}

function saveDb(data) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM questions; DELETE FROM review_logs; DELETE FROM nodes; DELETE FROM settings; DELETE FROM study_days; DELETE FROM todos; DELETE FROM goals; DELETE FROM daily_reviews; DELETE FROM inbox_items; DELETE FROM bookmarks; DELETE FROM review_sets;");
    const insQ = db.prepare(`INSERT INTO questions
      (id, type, subject, sub_subject, chapter, kps, tags, title_tex, solution_tex,
       wrong_answer, note, marks, created_at, urgent, calc_weak, need_consolidate, imgs)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const q of (data.questions || [])) {
      insQ.run(q.id, q.type, q.subject, q.subSubject, q.chapter,
        JSON.stringify(q.kps || []), JSON.stringify(q.tags || []), q.titleTex, q.solutionTex || "",
        q.wrongAnswer || "", q.note || "", JSON.stringify(q.marks || {}), q.createdAt,
        q.urgent ? 1 : 0, q.calcWeak ? 1 : 0, q.needConsolidate ? 1 : 0,
        JSON.stringify(q.imgs || []));
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
    insS.run("theme", data.theme === "dark" ? "dark" : "light");
    insS.run("remindDate", data.remindDate || "");
    insS.run("reviewResume", JSON.stringify(data.reviewResume || null));
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
    const insRS = db.prepare("INSERT INTO review_sets(id, name, qids, created_at) VALUES (?,?,?,?)");
    (data.reviewSets || []).forEach(rs => insRS.run(rs.id, String(rs.name || "").slice(0, 100),
      JSON.stringify(rs.qids || []), rs.createdAt || Date.now()));
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
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
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
  if (hotCache.size > 100) {
    const oldest = [...hotCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) hotCache.delete(oldest[0]);
  }
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
/* 试卷 HTML 缓存定时清理（超 10 分钟未消费的 token） */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of paperStore) {
    if (now - v.at > 10 * 60000) paperStore.delete(k);
  }
}, 10 * 60000);

/* 过期会话定期清理（每小时一次） */
setInterval(() => {
  try { db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()); }
  catch (e) { /* 忽略清理失败 */ }
}, 3600000);

/* ---------- HTTP 路由 ---------- */
let writeQueue = Promise.resolve();

/* 会话鉴权：除登录/注册/会话查询/试卷 HTML（随机 token 保护）外，所有 API 必须已登录 */
function requireSession(req, res) {
  const user = getUserByCookie(req);
  if (!user) { sendJson(res, 401, { code: 40100, message: "未登录" }); return null; }
  return user;
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // API
  if (p.startsWith("/api/")) {
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    // 公开路径白名单（无头浏览器打印 PDF 时无 Cookie，靠随机 token 保护）
    const publicPath =
      p === "/api/auth/login" || p === "/api/auth/register" ||
      p === "/api/auth/me" || p === "/api/auth/logout" ||
      p === "/api/paper/html";
    if (!publicPath && !requireSession(req, res)) return;
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
    if (p === "/api/questions" && req.method === "GET") { sendJson(res, 200, { data: readQuestions() }); return; }
    if (p === "/api/questions" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => {
          const insQ = db.prepare(`INSERT INTO questions
            (id, type, subject, sub_subject, chapter, kps, tags, title_tex, solution_tex,
             wrong_answer, note, marks, created_at, urgent, calc_weak, need_consolidate, imgs)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          insQ.run(body.id, body.type, body.subject, body.subSubject, body.chapter,
            JSON.stringify(body.kps || []), JSON.stringify(body.tags || []), body.titleTex, body.solutionTex || "",
            body.wrongAnswer || "", body.note || "", JSON.stringify(body.marks || {}), body.createdAt,
            body.urgent ? 1 : 0, body.calcWeak ? 1 : 0, body.needConsolidate ? 1 : 0,
            JSON.stringify(body.imgs || []));
        });
        await writeQueue;
        sendJson(res, 200, { ok: true, id: body.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const putM = p.match(/^\/api\/questions\/(\d+)$/);
    if (putM && req.method === "PUT") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => {
          db.prepare(`UPDATE questions SET type=?, subject=?, sub_subject=?, chapter=?, kps=?, tags=?,
            title_tex=?, solution_tex=?, wrong_answer=?, note=?, marks=?, urgent=?, calc_weak=?,
            need_consolidate=?, imgs=? WHERE id=?`)
            .run(body.type, body.subject, body.subSubject, body.chapter,
              JSON.stringify(body.kps || []), JSON.stringify(body.tags || []), body.titleTex, body.solutionTex || "",
              body.wrongAnswer || "", body.note || "", JSON.stringify(body.marks || {}),
              body.urgent ? 1 : 0, body.calcWeak ? 1 : 0, body.needConsolidate ? 1 : 0,
              JSON.stringify(body.imgs || []), Number(putM[1]));
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
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
        writeQueue = writeQueue.then(() => {
          db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('study_seconds', ?)").run(String(body.seconds || 0));
          if (typeof body.blurPrompt === "boolean") db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('blur_prompt', ?)").run(String(body.blurPrompt));
          const days = body.perDay || {};
          const ins = db.prepare("INSERT INTO study_days(day, seconds) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET seconds=excluded.seconds");
          for (const [day, sec] of Object.entries(days)) ins.run(String(day), Number(sec) || 0);
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/settings" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => {
          if (typeof body.remindOn === "boolean") db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('remindOn', ?)").run(String(body.remindOn));
          if (body.reviewCfg && typeof body.reviewCfg === "object") db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('reviewCfg', ?)").run(JSON.stringify(body.reviewCfg));
          if (body.theme && typeof body.theme === "string") db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('theme', ?)").run(body.theme);
          if (body.reviewResume !== undefined) db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('reviewResume', ?)").run(JSON.stringify(body.reviewResume));
          if (body.remindDate && typeof body.remindDate === "string") db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('remindDate', ?)").run(body.remindDate);
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/tree" && req.method === "POST") {
      try {
        const body = await readBody(req);
        writeQueue = writeQueue.then(() => {
          db.exec("DELETE FROM nodes");
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
          walk(body.tree || [], null, "subject");
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    /* ---------- 个人数据增量接口（todo / goal / 复盘 / 收件箱 / 收藏） ---------- */
    if (p === "/api/todos" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO todos(id, title, done, due, priority, subtasks, tags, note, remind, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(b.id ?? null, String(b.title || "").slice(0, 200), b.done ? 1 : 0, b.due || "", b.priority || 0,
            JSON.stringify(b.subtasks || []), JSON.stringify(b.tags || []), b.note || "", b.remind || "", b.createdAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true, id: b.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const todoM = p.match(/^\/api\/todos\/(\d+)$/);
    if (todoM && req.method === "PUT") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`UPDATE todos SET title=?, done=?, due=?, priority=?, subtasks=?, tags=?, note=?, remind=? WHERE id=?`)
          .run(String(b.title || "").slice(0, 200), b.done ? 1 : 0, b.due || "", b.priority || 0,
            JSON.stringify(b.subtasks || []), JSON.stringify(b.tags || []), b.note || "", b.remind || "", Number(todoM[1])));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (todoM && req.method === "DELETE") {
      writeQueue = writeQueue.then(() => db.prepare("DELETE FROM todos WHERE id = ?").run(Number(todoM[1])));
      await writeQueue;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === "/api/goals" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO goals(id, title, category, progress, milestone, target_date, status, linked_todos, milestones, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(b.id ?? null, String(b.title || "").slice(0, 200), b.category || "学习", b.progress || 0, b.milestone || "",
            b.targetDate || "", b.status || "active", JSON.stringify(b.linkedTodoIds || []),
            JSON.stringify(b.milestones || []), b.note || "", b.createdAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true, id: b.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const goalM = p.match(/^\/api\/goals\/(\d+)$/);
    if (goalM && req.method === "PUT") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`UPDATE goals SET title=?, category=?, progress=?, milestone=?, target_date=?, status=?, linked_todos=?, milestones=?, note=? WHERE id=?`)
          .run(String(b.title || "").slice(0, 200), b.category || "学习", b.progress || 0, b.milestone || "",
            b.targetDate || "", b.status || "active", JSON.stringify(b.linkedTodoIds || []),
            JSON.stringify(b.milestones || []), b.note || "", Number(goalM[1])));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (goalM && req.method === "DELETE") {
      writeQueue = writeQueue.then(() => db.prepare("DELETE FROM goals WHERE id = ?").run(Number(goalM[1])));
      await writeQueue;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === "/api/daily-reviews" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO daily_reviews(day, done, stuck, plan, mood, stats, updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(day) DO UPDATE SET done=excluded.done, stuck=excluded.stuck, plan=excluded.plan,
          mood=excluded.mood, stats=excluded.stats, updated_at=excluded.updated_at`)
          .run(b.day, b.done || "", b.stuck || "", b.plan || "", b.mood || "",
            JSON.stringify(b.stats || {}), b.updatedAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/inbox" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO inbox_items(id, text, tags, status, created_at) VALUES (?,?,?,?,?)`)
          .run(b.id ?? null, String(b.text || "").slice(0, 1000), JSON.stringify(b.tags || []), b.status || "open", b.createdAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true, id: b.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const inboxM = p.match(/^\/api\/inbox\/(\d+)$/);
    if (inboxM && req.method === "PUT") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`UPDATE inbox_items SET text=?, tags=?, status=? WHERE id=?`)
          .run(String(b.text || "").slice(0, 1000), JSON.stringify(b.tags || []), b.status || "open", Number(inboxM[1])));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (inboxM && req.method === "DELETE") {
      writeQueue = writeQueue.then(() => db.prepare("DELETE FROM inbox_items WHERE id = ?").run(Number(inboxM[1])));
      await writeQueue;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === "/api/bookmarks" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO bookmarks(id, title, kind, url, note, tags, created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(b.id ?? null, String(b.title || "").slice(0, 200), b.kind || "link",
            String(b.url || "").slice(0, 2000), String(b.note || "").slice(0, 1000),
            JSON.stringify(b.tags || []), b.createdAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true, id: b.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const bmM = p.match(/^\/api\/bookmarks\/(\d+)$/);
    if (bmM && req.method === "DELETE") {
      try {
        const id = Number(bmM[1]);
        writeQueue = writeQueue.then(() => {
          const row = db.prepare("SELECT url FROM bookmarks WHERE id = ?").get(id);
          db.prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
          // 连带删除上传的文件（仅限本应用生成的上传文件）
          if (row && row.url && row.url.startsWith("/uploads/")) {
            const name = path.basename(row.url);
            if (/^bm-[0-9a-f]{16}\./.test(name)) fs.unlink(path.join(ROOT, "uploads", name), () => {});
          }
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/review-sets" && req.method === "GET") { sendJson(res, 200, { data: readReviewSets() }); return; }
    if (p === "/api/review-sets" && req.method === "POST") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`INSERT INTO review_sets(id, name, qids, created_at) VALUES (?,?,?,?)`)
          .run(b.id ?? null, String(b.name || "").slice(0, 100), JSON.stringify(b.qids || []), b.createdAt || Date.now()));
        await writeQueue;
        sendJson(res, 200, { ok: true, id: b.id });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    const rsM = p.match(/^\/api\/review-sets\/(\d+)$/);
    if (rsM && req.method === "PUT") {
      try {
        const b = await readBody(req);
        writeQueue = writeQueue.then(() => db.prepare(`UPDATE review_sets SET name=?, qids=? WHERE id=?`)
          .run(String(b.name || "").slice(0, 100), JSON.stringify(b.qids || []), Number(rsM[1])));
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (rsM && req.method === "DELETE") {
      writeQueue = writeQueue.then(() => db.prepare("DELETE FROM review_sets WHERE id = ?").run(Number(rsM[1])));
      await writeQueue;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === "/api/reset" && req.method === "POST") {
      try {
        writeQueue = writeQueue.then(() => {
          db.exec("DELETE FROM questions; DELETE FROM review_logs; DELETE FROM nodes; DELETE FROM settings; DELETE FROM study_days; DELETE FROM todos; DELETE FROM goals; DELETE FROM daily_reviews; DELETE FROM inbox_items; DELETE FROM bookmarks; DELETE FROM review_sets;");
          seedIfEmpty();
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: e.message }); }
      return;
    }
    if (p === "/api/backup" && req.method === "GET") {
      try {
        const backupFile = path.join(os.tmpdir(), `mb-backup-${Date.now()}.db`);
        db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
        const buf = fs.readFileSync(backupFile);
        fs.unlink(backupFile, () => {});
        const day = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="mistake-book-backup-${day}.db"`
        });
        res.end(buf);
      } catch (e) { sendJson(res, 500, { code: 50000, message: "备份失败：" + e.message }); }
      return;
    }
    if (p === "/api/restore" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const buf = Buffer.from(String(body.dataUrl || "").split(",")[1] || "", "base64");
        if (!buf.length) return sendJson(res, 400, { code: 40001, message: "备份文件数据为空" });
        if (buf.slice(0, 15).toString("latin1") !== "SQLite format 3") {
          return sendJson(res, 400, { code: 40002, message: "不是有效的 SQLite 备份文件" });
        }
        // 恢复前先把当前库备份到 backups/（安全网）
        const pre = path.join(ROOT, "backups", `pre-restore-${Date.now()}.db`);
        try { fs.mkdirSync(path.join(ROOT, "backups"), { recursive: true }); db.exec(`VACUUM INTO '${pre.replace(/'/g, "''")}'`); }
        catch (e) { console.warn("恢复前自备份失败（可忽略）：", e.message); }
        writeQueue = writeQueue.then(() => {
          db.close();
          fs.writeFileSync(DB_FILE, buf);
          db = new DatabaseSync(DB_FILE);
          initDb();
        });
        await writeQueue;
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { code: 40000, message: "恢复失败：" + e.message }); }
      return;
    }
    if (p === "/api/question-image" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const name = String(body.name || "question.png");
        const buf = Buffer.from(String(body.dataUrl || "").split(",")[1] || "", "base64");
        if (!buf.length) return sendJson(res, 400, { code: 40001, message: "图片数据为空" });
        const ext = path.extname(name).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
          return sendJson(res, 400, { code: 40002, message: "不支持的图片类型：" + (ext || "未知") });
        }
        const dir = path.join(ROOT, "uploads");
        fs.mkdirSync(dir, { recursive: true });
        const safe = "bm-" + crypto.randomBytes(8).toString("hex") + ext;
        fs.writeFileSync(path.join(dir, safe), buf);
        sendJson(res, 200, { ok: true, url: "/uploads/" + safe });
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
    if (p === "/api/ocr/status" && req.method === "GET") {
      // 本地服务 OCR 为同步返回，轮询接口恒为 done
      sendJson(res, 200, { status: "done", result: null });
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
        const ext = path.extname(name).toLowerCase();
        const allow = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".md", ".zip"];
        if (!allow.includes(ext)) {
          return sendJson(res, 400, { code: 40002, message: "不支持的文件类型：" + (ext || "未知") + "（仅允许 PDF/Office/图片/文本/Markdown/ZIP）" });
        }
        const dir = path.join(ROOT, "uploads");
        fs.mkdirSync(dir, { recursive: true });
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
  let rel;
  try { rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, ""); }
  catch (e) { sendJson(res, 400, { code: 40000, message: "URL 编码无效" }); return; }
  // 禁止下载敏感文件：.git 目录、SQLite 数据库、node_modules
  const lower = rel.toLowerCase();
  if (/(^|\/)\.git(\/|$)/.test(lower) || /\.db(-wal|-shm)?$/.test(lower) || /(^|\/)node_modules(\/|$)/.test(lower)) {
    sendJson(res, 403, { code: 40300, message: "禁止访问" });
    return;
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { sendJson(res, 403, { code: 40300, message: "禁止访问" }); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404).end("404");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
  } catch (e) {
    console.error("请求处理异常：", e);
    if (res.headersSent) { res.destroy(); return; }
    sendJson(res, 500, { code: 50000, message: "服务内部错误" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const dbSize = fs.existsSync(DB_FILE) ? Math.max(1, Math.round(fs.statSync(DB_FILE).size / 1024)) : 0;
  const upDir = path.join(ROOT, "uploads");
  const upCount = fs.existsSync(upDir) ? fs.readdirSync(upDir).filter(f => !fs.statSync(path.join(upDir, f)).isDirectory()).length : 0;
  const qCount = db.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
  const uCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  console.log("==============================================");
  console.log(`个人工作台本地服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`版本：v1.17.0 · Node ${process.versions.node}`);
  console.log(`数据库：${DB_FILE}（${dbSize} KB · 题目 ${qCount} 道 · 账号 ${uCount} 个）`);
  console.log(`备份：backups/ 每日自动（保留 7 份） · 上传文件 ${upCount} 个`);
  console.log(`OCR：${MINERU_AVAILABLE ? "MinerU 真实识别（mineru-open-api）" : "模拟识别（未检测到 mineru-open-api）"}`);
  console.log("按 Ctrl+C 停止服务");
  console.log("==============================================");
});
