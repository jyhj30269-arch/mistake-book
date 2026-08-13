/* ============================================================
   个人工作台 · 业务逻辑 v1.13.3
   版本：v1.13.3（修复：服务端 API 强制登录鉴权、畸形 URL 崩溃、
   移除 CORS 通配、静态文件禁止下载数据库/.git；登录成功后才加载数据）
   实现范围：单题与批量合一识别录入 / 仪表盘一体化（顶部指标+推荐+随机复习+数据统计）/
   仪表盘总览（问候/概览卡/快捷入口/目标进度/今日待办/最近动态）/
   今日待办（子任务/优先级/标签/提醒/列表看板/快速添加解析）/
   目标与规划（状态分组/里程碑清单/挂待办自动进度）/
   收件箱（随手记→转待办/目标/复盘）/
   日历视图（待办截止/目标日期/复盘学习记录月视图）/
   周月总结（学习+心情趋势）/ 今日复盘（模板+历史+当日数据自动附带+周汇总）/
   备注框始终可编辑 / 保存后留在录入页（成功失败均有提示）/
   题库与详情公式 KaTeX 渲染 / 选择题选项自动换行 /
   Cookie 登录（SQLite users/sessions，scrypt 加盐哈希，注册/登录/登出）/
   今日推荐直接用推荐列表 / 章节选择保留 / 抽题算法覆盖性验证 /
   题目+过程自动配对（不点配对也识别）/ 默认只显示渲染公式（源码折叠可编辑）/
   原图对照左右并排缩小 / 公式渲染预览（LaTeX 预处理）/
   该题无过程选项 / MinerU 真实识别（服务端 mineru-open-api）/
   本地 SQLite（server.js + node:sqlite，mistake-book.db，种子数据在服务端）/
   复习自由选题（题目导航/跳过/任意切换）/
   设置简化（新增科目/统一弹窗/加分支示例）/ MinerU 真实识别（可配置+连通性测试）/
   真实 JSON 导入 / 复习断点续传 / 按天学习时长 / 题目编辑 / 知识点增删改 /
   分层优先+加权随机抽题 / 四档自评 /
   六级掌握度+时间衰减 / 7 天去重窗口 / 多知识点 / 笔记标记 / 今日推荐 /
   导入导出预检 / 学习时长 / 统计图表
   ============================================================ */

/* ---------------- 工具 ---------------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(ts) { return Math.floor((Date.now() - ts) / 86400000); }

function toast(msg, type) {
  const box = $("#toast-box");
  const t = document.createElement("div");
  t.className = "toast" + (type ? " toast-" + type : "");
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}

function openModal(title, bodyHtml, footHtml) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal-foot").innerHTML = footHtml || "";
  $("#modal-mask").style.display = "flex";
  renderMath($("#modal-body"));
}

function closeModal() { $("#modal-mask").style.display = "none"; }
$("#modal-mask").addEventListener("click", e => { if (e.target.id === "modal-mask") closeModal(); });

/* KaTeX 渲染：所有带 data-tex 的 .katex-render 节点 */
function renderMath(el) {
  if (!el || typeof katex === "undefined") return;
  el.querySelectorAll(".katex-render").forEach(node => {
    const tex = node.getAttribute("data-tex");
    if (tex == null) return;
    try {
      const clean = normalizeLatex(tex);
      const finalTex = node.dataset.display === "1" ? clean : clean.replace(/\\\\/g, " ");
      katex.render(finalTex, node, { throwOnError: false, displayMode: node.dataset.display === "1" });
    } catch (e) { node.textContent = tex; }
  });
}

function renderTex(node, tex, display) {
  const s = document.createElement("span");
  s.className = "katex-render";
  s.setAttribute("data-tex", tex);
  if (display) s.setAttribute("data-display", "1");
  node.appendChild(s);
}

/* ---------------- 数据模型 ---------------- */
const TAGS = [
  { key: "knowledge", icon: "🧠", name: "知识点不会", weight: 2 },
  { key: "careless", icon: "✏️", name: "粗心/审题失误", weight: 1 },
  { key: "calc", icon: "🔢", name: "计算错误", weight: 1.5 },
  { key: "method", icon: "💡", name: "思路/方法错误", weight: 2 },
  { key: "time", icon: "⏱️", name: "时间/心态", weight: 1 },
  { key: "other", icon: "❓", name: "其他", weight: 1 }
];

const LV = {
  unreviewed: { key: "unreviewed", icon: "⬜", name: "未复习", cls: "lv-gray", weight: 5 },
  yellow: { key: "yellow", icon: "🟡", name: "基本掌握", cls: "lv-yellow", weight: 3 },
  green: { key: "green", icon: "🟢", name: "比较掌握", cls: "lv-green", weight: 2 },
  blue: { key: "blue", icon: "✅", name: "完全掌握", cls: "lv-blue", weight: 1 },
  orange: { key: "orange", icon: "🟠", name: "需要关注", cls: "lv-orange", weight: 5 },
  red: { key: "red", icon: "🔴", name: "重点攻克", cls: "lv-red", weight: 5 },
  darkred: { key: "darkred", icon: "⛔", name: "顽固错题", cls: "lv-darkred", weight: 5 }
};
const OK_TRACK = ["yellow", "green", "blue"];
const ERR_TRACK = ["orange", "red", "darkred"];
const DECAY_DAYS = 7; // 超过 7 天未复习，展示等级降一档
const APP_VERSION = "1.13.3";

const TREE = [
  {
    id: "subj-math", name: "数学", children: [
      {
        id: "ss-gaoshu", name: "高等数学", children: [
          { id: "ch-c1", name: "第 1 章 函数、极限与连续", children: ["极限计算", "连续性讨论"] },
          { id: "ch-c3", name: "第 3 章 一元函数积分学", children: ["定积分计算", "分部积分"] },
          { id: "ch-c5", name: "第 5 章 多元函数积分学（仅数一）", children: ["二重积分"] }
        ]
      },
      {
        id: "ss-xdai", name: "线性代数", children: [
          { id: "ch-l2", name: "第 2 章 矩阵", children: ["矩阵的秩", "逆矩阵"] },
          { id: "ch-l5", name: "第 5 章 特征值与特征向量", children: ["相似对角化"] }
        ]
      },
      { id: "ss-gailv", name: "概率论与数理统计", children: [{ id: "ch-p1", name: "第 1 章 随机事件与概率", children: ["全概率与贝叶斯公式"] }] }
    ]
  },
  {
    id: "subj-eng", name: "英语", children: [
      { id: "ss-word", name: "单词", children: [{ id: "ch-w1", name: "易混词辨析", children: ["动词辨析"] }] },
      { id: "ss-read", name: "阅读", children: [{ id: "ch-r1", name: "推理题", children: [] }] },
      { id: "ss-essay", name: "作文", children: [{ id: "ch-e1", name: "模板句型与过渡语", children: [] }] }
    ]
  },
  {
    id: "subj-408", name: "408", children: [
      { id: "ss-ds", name: "数据结构", children: [{ id: "ch-d6", name: "第 6 章 查找", children: ["B 树与 B+ 树"] }] },
      { id: "ss-net", name: "计算机网络", children: [{ id: "ch-n5", name: "第 5 章 传输层", children: ["TCP 可靠传输"] }] }
    ]
  }
];

let qidSeq = 100;
function nextQid() { return ++qidSeq; }

let questions = [];
let reviewLogs = [];
let sessionId = 0;
let reviewSeq = 0;

/* ---------------- 个人工作台：待办 / 目标 / 复盘 / 收件箱 ---------------- */
let personal = {
  todos: [],       // { id, title, done, due, priority, subtasks, tags, note, remind, createdAt }
  goals: [],       // { id, title, category, progress, milestone, targetDate, status, linkedTodoIds, milestones, note, createdAt }
  reviews: [],     // { day, done, stuck, plan, mood, stats, updatedAt }
  inbox: [],       // { id, text, tags, status, createdAt }
  bookmarks: []    // { id, title, kind, url, note, tags, createdAt }
};
let personalIdSeq = 1;
let summaryRange = "week";
let dailyMood = "";
let todoViewMode = "list";   // 待办：list | board
let goalFilter = "all";      // 目标：all | active | done | paused
function nextTodoId() { return personalIdSeq++; }

function mkQ(o) {
  return {
    id: nextQid(), type: "problem", subject: "subj-math", subSubject: "ss-gaoshu",
    chapter: "", kps: [], tags: [], note: "", marks: {}, wrongAnswer: "",
    titleTex: "", solutionTex: "", createdAt: Date.now(), urgent: false, ...o
  };
}

function seed() {
  const now = Date.now();
  const d = n => now - n * 86400000;
  questions = [
    mkQ({ id: 1, titleTex: "\\lim_{x \\to 0} \\frac{\\sin x - x}{x^3}", solutionTex: "由泰勒展开：\\sin x = x - \\frac{x^3}{6} + o(x^3)，原式 = \\lim \\frac{-x^3/6 + o(x^3)}{x^3} = -\\frac{1}{6}", chapter: "ch-c1", kps: ["极限计算"], tags: ["method"], createdAt: d(8), note: "关键：看到 sin x − x 要想到泰勒展开，洛必达要三次很慢", marks: { rescratch: true } }),
    mkQ({ id: 2, titleTex: "设 f(x) 在 [0,1] 上连续，证明 \\exists \\xi \\in (0,1) 使 f(\\xi) = \\xi", solutionTex: "构造 F(x) = f(x) - x，F(0) = f(0) \\ge 0，F(1) = f(1) - 1 \\le 0，由零点定理得证", chapter: "ch-c1", kps: ["极限计算"], tags: ["knowledge"], createdAt: d(6), note: "" }),
    mkQ({ id: 3, titleTex: "\\int_0^1 x e^x \\, dx", solutionTex: "分部积分：= [x e^x]_0^1 - \\int_0^1 e^x dx = e - (e - 1) = 1", chapter: "ch-c3", kps: ["定积分计算"], tags: ["calc"], createdAt: d(3), note: "分部积分符号别漏" }),
    mkQ({ id: 4, titleTex: "计算 \\iint_D (x + y) \\, dxdy，D: x^2 + y^2 \\le 1", solutionTex: "极坐标：= \\int_0^{2\\pi} \\int_0^1 r(\\cos\\theta + \\sin\\theta) r \\, dr d\\theta = 0", chapter: "ch-c5", kps: ["二重积分"], tags: ["method"], createdAt: d(1) }),
    mkQ({ id: 5, titleTex: "求 f(x) = e^x 在 x=0 处的泰勒展开到 3 阶", solutionTex: "e^x = 1 + x + \\frac{x^2}{2} + \\frac{x^3}{6} + o(x^3)", chapter: "ch-c1", kps: ["极限计算"], tags: ["calc"], createdAt: d(12) }),
    mkQ({ id: 6, titleTex: "解微分方程 y' + y = e^{-x}", solutionTex: "一阶线性：y = e^{-\\int dx}(\\int e^{-x} e^{\\int dx} dx + C) = e^{-x}(x + C)", chapter: "", kps: [], tags: ["knowledge"], createdAt: d(10) }),
    mkQ({ id: 7, titleTex: "求曲线 y = x^2 与 y = x 围成的面积", solutionTex: "S = \\int_0^1 (x - x^2) dx = \\frac{1}{6}", chapter: "ch-c3", kps: ["定积分计算"], tags: ["calc"], createdAt: d(20) }),
    mkQ({ id: 8, titleTex: "证明 r(A) = r(A^T)", solutionTex: "行秩 = 列秩，用初等变换化阶梯形", chapter: "ch-l2", kps: ["矩阵的秩"], tags: ["method"], createdAt: d(18) }),
    mkQ({ id: 9, titleTex: "A = \\begin{pmatrix} 2 & 1 \\\\ 0 & 2 \\end{pmatrix} 能否对角化？", solutionTex: "特征值 λ=2 重根，特征向量只有一个，不能对角化", chapter: "ch-l5", kps: ["相似对角化"], tags: ["knowledge"], createdAt: d(4) }),
    mkQ({ id: 10, titleTex: "两批产品合格率分别为 0.9、0.8，任取一件求合格概率", solutionTex: "全概率：P = \\frac{1}{2} \\times 0.9 + \\frac{1}{2} \\times 0.8 = 0.85", chapter: "ch-p1", kps: ["全概率与贝叶斯公式"], tags: ["calc"], createdAt: d(2) }),
    mkQ({ id: 11, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w1", kps: ["动词辨析"], titleTex: "determine / decide / conclude", solutionTex: "determine 确定（客观）· decide 决定（主观）· conclude 推断（结论）", tags: ["other"], createdAt: d(1) }),
    mkQ({ id: 12, type: "problem", subject: "subj-eng", subSubject: "ss-read", chapter: "ch-r1", kps: [], titleTex: "阅读理解推理题：作者态度题解题方法", solutionTex: "找转折词 but/however，态度词 positive/negative/neutral", tags: ["method"], createdAt: d(5) }),
    mkQ({ id: 13, type: "essay", subject: "subj-eng", subSubject: "ss-essay", chapter: "ch-e1", kps: [], titleTex: "图画作文开头模板句", solutionTex: "As is vividly depicted in the picture, ... The picture is thought-provoking in that ...", tags: ["other"], createdAt: d(9) }),
    mkQ({ id: 14, type: "problem", subject: "subj-408", subSubject: "ss-ds", chapter: "ch-d6", kps: ["B 树与 B+ 树"], titleTex: "B 树与 B+ 树的区别", solutionTex: "B+ 树数据都在叶子、叶子链表、更适合范围查询和数据库索引", tags: ["knowledge"], createdAt: d(11) }),
    mkQ({ id: 15, type: "problem", subject: "subj-408", subSubject: "ss-net", chapter: "ch-n5", kps: ["TCP 可靠传输"], titleTex: "TCP 三次握手各状态含义", solutionTex: "SYN_SENT / SYN_RCVD / ESTABLISHED，防历史连接", tags: ["careless"], createdAt: d(14) })
  ];

  // 预设复习记录（产生演示掌握度）
  const R = (qid, at, result) => reviewLogs.push({ id: ++reviewSeq, qid, at, result });
  R(1, d(8), "fail"); R(1, d(7), "fail"); R(1, d(5), "fail"); // ⛔ 顽固错题
  R(2, d(6), "fail"); R(2, d(4), "half"); R(2, d(2), "fail"); // 🔴 重点攻克（连续 fail 2）
  R(3, d(3), "fail"); // 🟠 需要关注
  R(5, d(12), "ok"); R(5, d(8), "fail"); R(5, d(3), "half"); // 🟡 基本掌握
  R(6, d(10), "ok"); R(6, d(6), "ok"); // 🟢 比较掌握
  R(7, d(20), "ok"); R(7, d(12), "ok"); R(7, d(4), "ok"); // ✅ 完全掌握
  R(8, d(18), "ok"); R(8, d(9), "ok"); R(8, d(2), "ok"); // ✅
  R(9, d(4), "fail"); R(9, d(1), "fail"); // 🔴（连续 fail 2）
  R(12, d(5), "fail"); // 🟠
  R(13, d(9), "ok"); R(13, d(2), "fail"); // 🟡
  R(14, d(11), "ok"); R(14, d(5), "fail"); R(14, d(1), "half"); // 🟡（最新 half，保持）
  R(15, d(14), "ok"); R(15, d(7), "ok"); // 🟢
}

/* ---------------- 掌握度 ---------------- */
function logsOf(qid) {
  return reviewLogs.filter(l => l.qid === qid).sort((a, b) => a.at - b.at);
}

/* 四档自评映射到连续计数：ok=对, fail=错, half/stuck 打断连续段但不升降级 */
function computeMastery(qid) {
  const logs = logsOf(qid);
  if (!logs.length) return { lv: LV.unreviewed, streak: 0, lastAt: null };
  const last = logs[logs.length - 1];
  let streak = 0;
  if (last.result === "ok" || last.result === "fail") {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].result === last.result) streak++;
      else break;
    }
    const key = last.result === "ok" ? OK_TRACK[Math.min(streak, 3) - 1] : ERR_TRACK[Math.min(streak, 3) - 1];
    return { lv: LV[key], streak, lastAt: last.at };
  }
  // 最新是 half / stuck：取上一个有效结果对应的等级，不升不降
  let prev = null;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].result === "ok" || logs[i].result === "fail") { prev = logs[i]; break; }
  }
  if (!prev) return { lv: LV.unreviewed, streak: 0, lastAt: last.at, pause: true };
  let s = 0;
  for (let i = logs.indexOf(prev); i >= 0; i--) {
    if (logs[i].result === prev.result) s++;
    else break;
  }
  const key = prev.result === "ok" ? OK_TRACK[Math.min(s, 3) - 1] : ERR_TRACK[Math.min(s, 3) - 1];
  return { lv: LV[key], streak: s, lastAt: last.at, pause: true };
}

/* 时间衰减：超过 N 天未复习，展示等级降一档 */
function displayMastery(qid) {
  const m = computeMastery(qid);
  const base = m.lastAt || (questions.find(q => q.id === qid) || {}).createdAt;
  const aged = base && daysAgo(base) > DECAY_DAYS;
  if (!aged) return { ...m, decay: false };
  const drop = {
    blue: "green", green: "yellow", yellow: "unreviewed",
    darkred: "red", red: "orange", orange: "unreviewed"
  };
  const lv = drop[m.lv.key] ? LV[drop[m.lv.key]] : m.lv;
  return { ...m, lv, decay: true };
}

function lvTag(lv, decay) {
  return `<span class="lv ${lv.cls}${decay ? " decay" : ""}">${lv.icon} ${lv.name}${decay ? " · 衰减中" : ""}</span>`;
}

/* ---------------- 去重（7 天窗口 + bigram Jaccard） ---------------- */
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function jaccard(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size && !B.size) return a === b ? 1 : 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

function findDupCandidates(titleTex, subject, type, excludeId) {
  const n = norm(titleTex);
  const windowMs = 7 * 86400000;
  return questions.filter(q =>
    q.id !== excludeId &&
    q.subject === subject &&
    q.type === type &&
    Date.now() - q.createdAt <= windowMs &&
    jaccard(n, norm(q.titleTex)) > 0.7
  );
}

function dupCountFor(q) {
  return findDupCandidates(q.titleTex, q.subject, q.type, q.id).length;
}

/* ---------------- 导航 ---------------- */
let currentView = "dashboard";
let serverDown = false; // 本地 SQLite 服务是否可用
function go(view) {
  $$("#view-app section").forEach(s => s.style.display = "none");
  $("#view-" + view).style.display = "block";
  $$(".nav-item, .mobile-tabbar a").forEach(a => a.classList.toggle("active", a.dataset.view === view));
  currentView = view;
  if (view === "dashboard") renderDashboard();
  if (view === "questions") renderQuestions();
  if (view === "settings") renderSettings();
  if (view === "input") { fillInputSelects(); renderInput(); }
  if (view === "todos") renderTodos();
  if (view === "goals") renderGoals();
  if (view === "summary") renderSummary();
  if (view === "daily") renderDaily();
  if (view === "inbox") renderInbox();
  if (view === "calendar") renderCalendar();
  if (view === "hot") renderHot();
  if (view === "bookmarks") renderBookmarks();
  window.scrollTo(0, 0);
}

/* 仪表盘内分区定位：随机复习 / 数据统计 */
function goDashSection(sec) {
  go("dashboard");
  setTimeout(() => {
    const el = document.getElementById("dash-" + sec);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

/* 移动端底部「更多」抽屉 */
function toggleMobileMenu() {
  const menu = $("#mobile-menu");
  if (!menu) return;
  menu.style.display = menu.style.display === "none" ? "block" : "none";
}
function hideMobileMenu() {
  const menu = $("#mobile-menu");
  if (menu) menu.style.display = "none";
}

let loginMode = "login";
function toggleLoginMode() {
  loginMode = loginMode === "login" ? "register" : "login";
  const btn = $("#login-btn"), tg = $("#login-toggle");
  if (btn) btn.textContent = loginMode === "login" ? "登录并进入工作台" : "注册并进入工作台";
  if (tg) tg.textContent = loginMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
  const pw = $("#login-pass");
  if (pw) pw.autocomplete = loginMode === "login" ? "current-password" : "new-password";
}
async function doLogin() {
  const u = $("#login-user").value.trim();
  const p = $("#login-pass").value;
  if (!u || !p) { toast("请输入用户名和密码", "error"); return; }
  try {
    if (loginMode === "register") await API.authRegister(u, p);
    else await API.authLogin(u, p);
    window.__currentUser = u;
    // 登录成功后才加载数据（服务端 API 已强制会话鉴权）
    const ok = await loadLocal();
    if (!ok) { seed(); persistLocal(); }
    enterApp();
    toast(`欢迎，${u}`, "success");
  } catch (e) {
    toast(e.message || "登录失败", "error");
  }
}
function enterApp() {
  $("#view-login").style.display = "none";
  $("#view-app").style.display = "block";
  go("dashboard");
  setTimeout(remindCheckToday, 1200);
}
async function doLogout() {
  try { await API.authLogout(); } catch (e) { /* 忽略 */ }
  $("#view-app").style.display = "none";
  $("#mobile-tabbar").style.display = "none";
  $("#view-login").style.display = "grid";
  window.__currentUser = null;
}
function goSearch() {
  const kw = $("#global-search").value.trim();
  if (kw) { $("#q-search").value = kw; go("questions"); }
}

/* ---------------- 仪表盘 ---------------- */
function recScore(q) {
  const m = displayMastery(q.id);
  const logs = logsOf(q.id);
  let okStreak = 0;
  for (let i = logs.length - 1; i >= 0; i--) { if (logs[i].result === "ok") okStreak++; else break; }
  const intervals = [1, 3, 7, 14, 30];
  const last = logs.length ? logs[logs.length - 1] : null;
  const lastAt = last ? last.at : q.createdAt;
  const due = lastAt + (last && last.result === "fail" ? 1 : intervals[Math.min(okStreak, 4)]) * 86400000;
  const overdue = Math.max(0, (Date.now() - due) / 86400000);
  const tagW = Math.max(...q.tags.map(t => (TAGS.find(x => x.key === t) || {}).weight || 1));
  return overdue * 10 + m.lv.weight * 2 + tagW + (logs.length ? 0 : 5);
}

function recommendQuestions(n) {
  return questions
    .map(q => ({ q, s: recScore(q) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(x => x.q);
}

function renderDashboard() {
  const dateEl = $("#dash-date");
  const now = new Date();
  dateEl.textContent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} · 个人工作台`;

  const rec = recommendQuestions(10);
  $("#rec-count").textContent = rec.length;
  $("#rec-desc").textContent = `已按"到期最久 + 掌握度差 + 错因权重"排序，前 ${rec.length} 道；可手动调数量`;
  window.__rec = rec;
  renderRecPanel();

  // 仪表盘内联：随机复习 + 数据统计
  renderReviewConfig();
  renderStats();
  renderOverview();
  renderTodayOverview();
}

function weakKps() {
  const map = {};
  questions.forEach(q => {
    const lv = displayMastery(q.id).lv;
    const keys = q.kps.length ? q.kps : ["未分类"];
    keys.forEach(k => {
      if (!map[k]) map[k] = { count: 0, mastered: 0, err: 0 };
      map[k].count++;
      if (lv.key === "blue") map[k].mastered++;
      if (ERR_TRACK.includes(lv.key)) map[k].err++;
    });
  });
  return Object.entries(map)
    .map(([name, v]) => ({ name, ...v, score: v.err * 10 + v.count - v.mastered }))
    .sort((a, b) => b.score - a.score);
}

function startReviewFromRec() {
  const n = window.__rec ? window.__rec.length : 10;
  startReviewWith(n, window.__rec);
}

/* ---------------- 单题录入 ---------------- */
let inputType = "problem";
let inputTags = new Set();
let __previewBound = false;

function fillInputSelects() {
  $("#input-tags").innerHTML = "";
  $("#input-subject").innerHTML = TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#input-type").querySelectorAll(".radio-pill").forEach(p => p.onclick = () => {
    inputType = p.dataset.t;
    $$("#input-type .radio-pill").forEach(x => x.classList.remove("on"));
    p.classList.add("on");
    renderInputKps();
  });
  $("#input-subject").onchange = fillInputSub;
  $("#input-subsub").onchange = fillInputChapter;
  $("#input-chapter").onchange = renderInputKps;
  TAGS.forEach(t => {
    const el = document.createElement("span");
    el.className = "chip";
    el.textContent = `${t.icon} ${t.name}`;
    el.onclick = () => {
      if (inputTags.has(t.key)) { inputTags.delete(t.key); el.classList.remove("on"); }
      else {
        const prim = inputTags.size === 0; // 第一个为主因
        inputTags.add(t.key);
        el.classList.add("on");
        if (prim) toast(`已设 ${t.name} 为主因（主因最多 1 个）`);
      }
    };
    $("#input-tags").appendChild(el);
  });
  fillInputSub();
  if (!__previewBound) { bindInputPreview(); __previewBound = true; }
}

function fillInputSub() {
  const subj = TREE.find(s => s.id === $("#input-subject").value);
  $("#input-subsub").innerHTML = (subj ? subj.children : []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  fillInputChapter();
}
function fillInputChapter() {
  const subj = TREE.find(s => s.id === $("#input-subject").value);
  const ss = subj ? subj.children.find(c => c.id === $("#input-subsub").value) : null;
  $("#input-chapter").innerHTML = `<option value="">未分章</option>` + (ss ? ss.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  renderInputKps();
}
function renderInputKps() {
  const ch = TREE.flatMap(s => s.children).find(c => c.id === $("#input-chapter").value);
  const kps = ch ? ch.children : [];
  const wrap = $("#input-kps");
  wrap.innerHTML = `<span class="chip" data-k="" onclick="toggleInputKp(this)">∅ 未分类</span>` +
    kps.map(k => `<span class="chip" data-k="${esc(k)}" onclick="toggleInputKp(this)">${esc(k)}</span>`).join("");
}
function toggleInputKp(el) {
  el.classList.toggle("on");
  const prev = $("#input-kps .chip.on:not([data-k=''])");
  if (el.dataset.k !== "" && el.classList.contains("on")) {
    // 多知识点关联：允许保留已有选择（不再单选）
    toast("已关联知识点（支持多选）");
  }
}

function bindInputPreview() {
  const render = () => {
    renderTexPreview($("#input-preview"), $("#input-title").value);
    renderTexPreview($("#input-solution-preview"), $("#input-solution").value);
  };
  $("#input-title").addEventListener("input", render);
  $("#input-solution").addEventListener("input", render);
}

/* 选择题选项换行：A. xxx B. xxx → 每个选项独立一行 */
function formatOptions(s) {
  const t = String(s || "").replace(/\r\n/g, "\n");
  const re = /([（(]?[A-Fa-f][.、)）]\s*)/g;
  let first = true;
  return t.replace(re, (m) => {
    if (first) { first = false; return m; }
    return "\n" + m;
  });
}

/* MinerU 输出 → KaTeX 可渲染：去 $ 包裹 / HTML 标签 / align→aligned / 选项换行等 */
function normalizeLatex(s) {
  let t = formatOptions(String(s || ""));
  t = t.replace(/```latex|```/g, "");
  t = t.replace(/\$\$/g, "").replace(/\\\(|\\\)/g, "").replace(/\\\[|\\\]/g, "");
  t = t.replace(/\$([^$]+)\$/g, (m, inner) => inner.trim());
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\\begin\{align\*\}/g, "\\begin{aligned}").replace(/\\end\{align\*\}/g, "\\end{aligned}");
  t = t.replace(/\\begin\{align\}/g, "\\begin{aligned}").replace(/\\end\{align\}/g, "\\end{aligned}");
  t = t.replace(/\\begin\{equation\*\}/g, "").replace(/\\end\{equation\*\}/g, "");
  t = t.replace(/\\begin\{equation\}/g, "").replace(/\\end\{equation\}/g, "");
  t = t.replace(/\\begin\{array\}/g, "\\begin{aligned}").replace(/\\end\{array\}/g, "\\end{aligned}");
  t = t.replace(/\\text\{([^}]*)\}/g, (m, inner) => `\\text{${inner.replace(/[{}]/g, "")}}`);
  t = t.replace(/\n/g, " \\\\ ");
  return t.replace(/[ \t]+/g, " ").trim();
}

function renderTexPreview(box, tex) {
  if (!box) return;
  box.innerHTML = "";
  const clean = normalizeLatex(tex);
  if (!clean) {
    box.innerHTML = `<span class="small muted">渲染预览（公式会自动渲染）</span>`;
    return;
  }
  try {
    const node = document.createElement("div");
    if (typeof katex !== "undefined") katex.render(clean, node, { throwOnError: false, displayMode: true });
    else node.textContent = clean;
    box.appendChild(node);
  } catch (e) {
    box.textContent = clean;
  }
}

/* ============================================================
   统一识别录入：1 张 = 单题流程，多张 = 批量流程
   OCR 统一走 window.API（本地模拟；后端接入后契约不变）
   ============================================================ */
let inputSeq = 0;
let inputImgs = [];        // { id, kind: "q"|"s", name, dataUrl }
let inputPairs = [];       // [{ q, s }]
let inputSelQ = null;      // 点选配对：当前选中的题目图 id
let inputQueue = [];       // [{ qImgId, sImgId, titleTex, solutionTex, status }]
let inputCursor = 0;
let texView = "render";

/* ---------- 图片添加：题目(q) / 过程(s) 两个区，各自支持拍照/相册/粘贴 ---------- */
function addInputFiles(kind) {
  const el = $("#input-file-" + kind);
  el.value = "";
  el.onchange = () => handleFiles(el.files, kind);
  el.click();
}
function addInputPhotos(kind) {
  const el = $("#input-cam-" + kind);
  el.value = "";
  el.onchange = () => handleFiles(el.files, kind);
  el.click();
}
async function pasteInput(kind) {
  window.__pasteKind = kind;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) {
        const t = it.types.find(x => x.startsWith("image/"));
        if (t) files.push(await it.getType(t));
      }
      if (files.length) { handleFiles(files, kind); toast(`已粘贴 ${files.length} 张截图到${kind === "s" ? "解题" : "题目"}区`, "success"); return; }
    }
  } catch (e) { /* 无剪贴板权限时引导用户直接 Ctrl+V */ }
  toast(`请按 Ctrl+V 粘贴到${kind === "s" ? "解题" : "题目"}区`);
}
document.addEventListener("paste", e => {
  if (!$("#view-input") || $("#view-input").style.display === "none") return;
  const kind = window.__pasteKind || "q";
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) { handleFiles(files, kind); toast(`已粘贴 ${files.length} 张截图到${kind === "s" ? "解题" : "题目"}区`, "success"); }
});

function handleFiles(files, kind) {
  const arr = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  if (!arr.length) { toast("未识别到图片文件", "error"); return; }
  let pending = arr.length;
  arr.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => {
      inputImgs.push({ id: ++inputSeq, kind: kind === "s" ? "s" : "q", name: f.name || `图片 ${inputSeq}`, dataUrl: reader.result, noSolution: false });
      if (--pending === 0) {
        renderInput();
        toast(`已添加 ${arr.length} 张${kind === "s" ? "过程" : "题目"}图片`, "success");
      }
    };
    reader.readAsDataURL(f);
  });
}

/* ---------- 图片队列：点选配对 / 自动配对 / 该题无过程 ---------- */
function renderInput() {
  const qGrid = $("#input-q-imgs");
  if (!qGrid) return;
  const qs = inputImgs.filter(x => x.kind === "q");
  const ss = inputImgs.filter(x => x.kind === "s");
  $("#input-mode-tag").textContent = !qs.length ? "待添加图片" : qs.length === 1 && !ss.length ? "单题模式" : "批量模式";
  $("#input-pair-actions").style.display = qs.length && ss.length ? "" : "none";
  const card = (img) => `
    <div class="bimg-card ${inputSelQ === img.id ? "sel" : ""} ${img.noSolution ? "no-sol" : ""}" onclick="selectInputImg(${img.id})">
      <img src="${img.dataUrl}" alt="" />
      ${img.kind === "q"
        ? `<span class="bimg-kind" onclick="event.stopPropagation();toggleNoSolution(${img.id})">${img.noSolution ? "🚫 无过程" : "题目"}</span>`
        : `<span class="bimg-kind is-s">解题</span>`}
      <span class="bimg-del" onclick="event.stopPropagation();removeInputImg(${img.id})">✕</span>
    </div>`;
  qGrid.innerHTML = qs.length ? qs.map(card).join("") : `<div class="small muted" style="padding:8px 0;">还没有题目图片，点上方按钮添加</div>`;
  $("#input-s-imgs").innerHTML = ss.length ? ss.map(card).join("") : `<div class="small muted" style="padding:8px 0;">可选的解题过程图；不需要过程可留空</div>`;
  renderPairs();
  renderQueue();
}

/* 该题不需要解题过程：只识别题面 */
function toggleNoSolution(id) {
  const img = inputImgs.find(x => x.id === id);
  if (!img || img.kind !== "q") return;
  img.noSolution = !img.noSolution;
  inputPairs = inputPairs.filter(p => p.q !== id && p.s !== id);
  if (inputSelQ === id) inputSelQ = null;
  renderInput();
  toast(img.noSolution ? "该题标记为「无过程」，只识别题面" : "已取消「无过程」标记");
}
function removeInputImg(id) {
  inputImgs = inputImgs.filter(x => x.id !== id);
  inputPairs = inputPairs.filter(p => p.q !== id && p.s !== id);
  if (inputSelQ === id) inputSelQ = null;
  renderInput();
}
function selectInputImg(id) {
  const img = inputImgs.find(x => x.id === id);
  if (!img) return;
  if (img.kind === "s") {
    if (inputSelQ == null) { toast("请先点选一张「题目」图，再点「解题」图完成配对", "error"); return; }
    if (inputPairs.some(p => p.s === id || p.q === inputSelQ)) { toast("该图片已参与配对，请先取消", "error"); return; }
    inputPairs.push({ q: inputSelQ, s: id });
    inputSelQ = null;
    renderInput();
    toast("已配对", "success");
    return;
  }
  inputSelQ = inputSelQ === id ? null : id;
  renderInput();
}
function autoPairInput() {
  const qs = inputImgs.filter(x => x.kind === "q" && !x.noSolution);
  const ss = inputImgs.filter(x => x.kind === "s");
  if (!qs.length) { toast("请先添加题目图", "error"); return; }
  inputPairs = [];
  const n = Math.min(qs.length, ss.length);
  for (let i = 0; i < n; i++) inputPairs.push({ q: qs[i].id, s: ss[i].id });
  const msg = ss.length > qs.length
    ? `已按上传顺序配对 ${n} 题，多余 ${ss.length - n} 张解题图将忽略`
    : `已按上传顺序配对 ${n} 题，${qs.length - n} 张题目图无解题过程`;
  inputSelQ = null;
  renderInput();
  toast(msg, "success");
}
function renderPairs() {
  const box = $("#batch-pairs");
  if (!inputPairs.length) { box.innerHTML = `<div class="small muted">暂无配对</div>`; $("#batch-count").textContent = "0 题"; return; }
  box.innerHTML = inputPairs.map((p, i) => {
    const q = inputImgs.find(x => x.id === p.q);
    const s = inputImgs.find(x => x.id === p.s);
    return `
    <div class="pair-row">
      <div class="thumb" style="overflow:hidden;"><img src="${q && q.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" /></div>
      <div class="small">第 ${i + 1} 道 · 题图 ${p.q}</div>
      <div class="pair-arrow">↔</div>
      <div class="flex" style="justify-content:space-between;width:100%;">
        <div class="thumb" style="overflow:hidden;"><img src="${s && s.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" /></div>
        <button class="btn btn-sm" onclick="unpair(${i})">取消</button>
      </div>
    </div>`;
  }).join("");
  $("#batch-count").textContent = `${inputPairs.length} 题（未配对的题目图将标记「无解题过程」）`;
}
function unpair(i) { inputPairs.splice(i, 1); renderInput(); }

/* ---------- OCR 与逐题校对 ---------- */
function buildQueue() {
  const qImgs = inputImgs.filter(x => x.kind === "q");
  const sImgs = inputImgs.filter(x => x.kind === "s");
  const pairByQ = {};
  inputPairs.forEach(p => { pairByQ[p.q] = p.s; });
  const usedS = new Set(inputPairs.map(p => p.s));
  let si = 0;
  return qImgs.map(x => {
    let sId = pairByQ[x.id];
    if (!sId && !x.noSolution) {
      // 自动按上传顺序把解题图分给未标记「无过程」的题目（题目与过程各 1 张时自动成对）
      while (si < sImgs.length && usedS.has(sImgs[si].id)) si++;
      if (si < sImgs.length) { sId = sImgs[si].id; usedS.add(sId); si++; }
    }
    return {
      qImgId: x.id,
      sImgId: sId || null,
      titleTex: "",
      solutionTex: "",
      wrongAnswer: "",
      status: "pending",
      noSolution: !!x.noSolution || !sId
    };
  });
}

/* 源码 / 渲染视图切换 */
function applyTexView() {
  const show = texView === "render" ? "none" : "";
  const t1 = $("#input-title"), t2 = $("#input-solution");
  const p1 = $("#input-preview"), p2 = $("#input-solution-preview");
  if (t1) t1.style.display = show;
  if (t2) t2.style.display = show;
  if (p1) p1.style.display = texView === "render" ? "" : "none";
  if (p2) p2.style.display = texView === "render" ? "" : "none";
  const btn = $("#tex-toggle-btn");
  if (btn) btn.textContent = texView === "render" ? "✏️ 编辑源码" : "👁 只看渲染";
}

async function startInputOCR() {
  const qImgs = inputImgs.filter(x => x.kind === "q");
  if (!qImgs.length) { toast("请先添加题目图片", "error"); return; }
  inputQueue = buildQueue();
  if (!inputQueue.length) { toast("没有可识别的题目", "error"); return; }
  inputCursor = 0;
  $("#input-ocr-btn").disabled = true;
  $("#input-ocr-state").textContent = "识别中…";
  $("#input-ocr-progress-wrap").style.display = "";
  renderQueue();
  // 逐题 OCR，单题失败隔离
  for (let i = 0; i < inputQueue.length; i++) {
    const it = inputQueue[i];
    it.status = "ocr";
    renderQueue();
    try {
      const qImg = inputImgs.find(x => x.id === it.qImgId);
      const r = await API.ocrRecognize({ dataUrl: qImg.dataUrl, name: qImg.name }, { isSolution: false });
      it.titleTex = r.titleTex || "";
      it.lowConf = r.lowConf || [];
      if (it.sImgId) {
        const sImg = inputImgs.find(x => x.id === it.sImgId);
        const rs = await API.ocrRecognize({ dataUrl: sImg.dataUrl, name: sImg.name }, { isSolution: true });
        it.solutionTex = rs.solutionTex || "";
      }
      it.status = "done";
    } catch (e) {
      it.status = "failed";
      console.warn("单题 OCR 失败（已隔离，不影响其他题）", e);
    }
    $("#input-ocr-progress").style.width = Math.round(((i + 1) / inputQueue.length) * 100) + "%";
    renderQueue();
  }
  $("#input-ocr-btn").disabled = false;
  texView = "render";
  applyTexView();
  const ok = inputQueue.filter(x => x.status === "done").length;
  const bad = inputQueue.length - ok;
  $("#input-ocr-state").textContent = bad ? `识别完成（${bad} 道失败，可重试）` : "识别完成，请逐题校对";
  toast(`OCR 完成：${ok} 道成功 / ${bad} 道失败（失败不影响其他题）`, bad ? "error" : "success");
  renderInputReview();
}

function captureCurrent() {
  if (!inputQueue.length) return;
  const cur = inputQueue[inputCursor];
  cur.titleTex = $("#input-title").value.trim();
  cur.solutionTex = $("#input-solution").value.trim();
  cur.wrongAnswer = $("#input-wrong").value.trim();
}

function renderInputReview() {
  if (!inputQueue.length) {
    $("#input-q-img-box").innerHTML = "暂无题目图";
    $("#input-s-img-box").innerHTML = "暂无过程图（该题可无过程）";
    $("#input-cursor").textContent = "0 / 0";
    $("#input-prev-btn").style.display = "none";
    $("#input-next-btn").style.display = "none";
    $("#input-save-all-btn").style.display = "none";
    renderQueue();
    return;
  }
  const cur = inputQueue[Math.min(inputCursor, inputQueue.length - 1)];
  const qImg = inputImgs.find(x => x.id === cur.qImgId);
  const sImg = cur.sImgId ? inputImgs.find(x => x.id === cur.sImgId) : null;
  if (qImg) {
    $("#input-q-img-box").innerHTML = `<img src="${qImg.dataUrl}" style="max-width:100%;border-radius:8px;" alt="题目原图" />`;
  }
  $("#input-s-img-box").innerHTML = sImg
    ? `<img src="${sImg.dataUrl}" style="max-width:100%;border-radius:8px;" alt="解题原图" />`
    : `<div class="small muted">${cur.noSolution ? "该题标记为「无过程」" : "暂无解题过程图（可留空）"}</div>`;
  $("#input-title").value = cur.titleTex || "";
  $("#input-solution").value = cur.solutionTex || "";
  $("#input-wrong").value = cur.wrongAnswer || "";
  $("#input-title").dispatchEvent(new Event("input"));
  $("#input-solution").dispatchEvent(new Event("input"));
  $("#input-cursor").textContent = `${inputCursor + 1} / ${inputQueue.length}`;
  $("#input-prev-btn").style.display = inputCursor > 0 ? "" : "none";
  $("#input-next-btn").style.display = inputCursor < inputQueue.length - 1 ? "" : "none";
  $("#input-save-all-btn").style.display = inputQueue.length > 1 ? "" : "none";
  renderQueue();
}

function renderQueue() {
  const box = $("#input-queue");
  if (!inputQueue.length) { box.innerHTML = ""; return; }
  box.innerHTML = inputQueue.map((it, i) => {
    const map = { pending: "待识别", ocr: "识别中…", done: "待校对", saved: "已保存", failed: "失败" };
    const cls = i === inputCursor ? "now" : "";
    const extra = it.status === "saved" ? "ok" : it.status === "failed" ? "bad" : "";
    return `<div class="input-queue-item ${cls} ${extra}">
      <span class="num">${i + 1}</span>
      <span class="txt">题图 ${it.qImgId}${it.sImgId ? " ↔ 解图 " + it.sImgId : it.noSolution ? " · 该题无过程" : " · 无解题图"}</span>
      <span class="tag">${map[it.status] || it.status}</span>
    </div>`;
  }).join("");
  $("#input-queue-info").textContent =
    `共 ${inputQueue.length} 道 · 已保存 ${inputQueue.filter(x => x.status === "saved").length} · 待校对 ${inputQueue.filter(x => x.status === "done" || x.status === "pending").length}`;
}

function inputPrev() { if (inputCursor > 0) { captureCurrent(); inputCursor--; renderInputReview(); } }
function inputNext() { if (inputCursor < inputQueue.length - 1) { captureCurrent(); inputCursor++; renderInputReview(); } }

function toggleTexView() {
  texView = texView === "render" ? "source" : "render";
  applyTexView();
  toast(texView === "render" ? "渲染视图（KaTeX）" : "源码视图");
}

/* OCR 失败 / 不想识别时：直接手动录入 */
function switchManualInput() {
  $("#input-ocr-state").textContent = "手动输入模式";
  $("#input-ocr-status").textContent = "已切换为手动输入：直接填写题面与解题过程，无需识别。";
  $("#input-ocr-btn").disabled = false;
  $("#input-ocr-progress-wrap").style.display = "none";
  texView = "source";
  applyTexView();
  if (!inputQueue.length && inputImgs.length) {
    inputQueue = buildQueue().map(it => ({ ...it, status: "done" }));
    inputCursor = 0;
    renderInputReview();
  }
  const t = $("#input-title");
  if (t) t.focus();
  toast("已切换手动输入");
}

function resetInput() {
  $("#input-title").value = "";
  $("#input-solution").value = "";
  $("#input-wrong").value = "";
  renderTexPreview($("#input-preview"), "");
  renderTexPreview($("#input-solution-preview"), "");
  window.__pasteKind = "q";
  texView = "render";
  applyTexView();
  inputTags.clear();
  $$("#input-tags .chip").forEach(c => c.classList.remove("on"));
  inputImgs = [];
  inputPairs = [];
  inputQueue = [];
  inputCursor = 0;
  inputSelQ = null;
  $("#batch-hint").textContent = "";
  $("#input-ocr-state").textContent = "待识别";
  $("#input-ocr-progress-wrap").style.display = "none";
  $("#input-q-img-box").innerHTML = "暂无题目图";
  $("#input-s-img-box").innerHTML = "暂无过程图（该题可无过程）";
  renderInput();
  toast("已清空，重新录入");
}

/* ---------- 保存（单题去重弹窗 / 批量不弹窗） ---------- */
function collectForm(titleTex, solutionTex, wrongAnswer) {
  const kps = $$("#input-kps .chip.on").map(c => c.dataset.k).filter(Boolean);
  return mkQ({
    type: inputType,
    subject: $("#input-subject").value,
    subSubject: $("#input-subsub").value,
    chapter: $("#input-chapter").value,
    kps,
    tags: Array.from(inputTags),
    titleTex: formatOptions(titleTex),
    solutionTex: solutionTex !== undefined ? solutionTex : $("#input-solution").value.trim(),
    wrongAnswer: wrongAnswer !== undefined ? wrongAnswer : $("#input-wrong").value.trim()
  });
}

function saveCurrentQuestion() {
  captureCurrent();
  const titleTex = $("#input-title").value.trim();
  if (!titleTex) { toast("题面不能为空（OCR 结果或手动输入）", "error"); return; }
  const q = collectForm(titleTex);
  // 单题保留去重弹窗；批量不弹窗，保存后由题库列表角标提示
  if (inputQueue.length <= 1) {
    const dups = findDupCandidates(titleTex, q.subject, q.type);
    if (dups.length) {
      const d = dups[0];
      openModal("⚠️ 疑似重复（7 天内录入）", `
        <div class="small muted">已存在同科目同类型、7 天内的相似题目（相似度 > 0.7）：</div>
        <div class="mt-8" style="background:var(--primary-soft);border-radius:10px;padding:12px;">
          <div class="katex-render" data-tex="${esc(d.titleTex)}"></div>
          <div class="small muted mt-8">录入于 ${fmtDate(d.createdAt)} · 当前掌握度：${displayMastery(d.id).lv.icon} ${displayMastery(d.id).lv.name}</div>
        </div>
        <div class="small muted mt-8">也可打开详情页与本次内容并排对比。</div>`,
        `<button class="btn" onclick="closeModal();go('questions')">查看题库</button>
         <button class="btn" onclick="closeModal()">取消不录入</button>
         <button class="btn btn-primary" onclick="closeModal();commitQuestion(${q.id})">仍然录入为新题</button>`
      );
      window.__pending = q;
      return;
    }
  }
  commitQuestion(null, q);
}

function saveAllQuestions() {
  captureCurrent();
  let n = 0;
  inputQueue.forEach(it => {
    if (!it.titleTex || it.status === "saved") return;
    questions.push(collectForm(it.titleTex, it.solutionTex, it.wrongAnswer));
    it.status = "saved";
    n++;
  });
  if (!n) { toast("没有待保存的题目（需识别完成且已填题面）", "error"); return; }
  persistLocal();
  inputQueue = [];
  inputImgs = [];
  inputPairs = [];
  renderInput();
  setTimeout(() => {
    if (serverDown) toast(`⚠️ 保存失败：${n} 道题未写入数据库，请检查本地服务`, "error");
    else toast(`✅ 已批量录入 ${n} 道题（题库在左侧导航，疑似重复以角标提示）`, "success");
  }, 800);
}

function commitQuestion(id, q) {
  const item = id ? questions.find(x => x.id === id) : q;
  if (!id) {
    if (window.__pending && !questions.includes(window.__pending)) { questions.push(window.__pending); }
    else questions.push(item);
  }
  window.__pending = null;
  persistLocal();
  if (inputQueue.length > 1) {
    const cur = inputQueue[inputCursor];
    if (cur) cur.status = "saved";
    inputCursor++;
    if (inputCursor < inputQueue.length) {
      renderInputReview();
      toast(`已保存第 ${inputCursor} 题，继续校对第 ${inputCursor + 1} / ${inputQueue.length} 题`, "success");
    } else {
      toast("本批已全部保存（可在左侧导航查看题库）", "success");
      inputQueue = [];
      inputImgs = [];
      inputPairs = [];
      renderInput();
    }
    return;
  }
  resetInput();
  toast("✅ 已保存，可继续录入；题库在左侧导航", "success");
  setTimeout(() => {
    if (serverDown) toast("⚠️ 保存到数据库失败：本地服务未连接，请检查服务", "error");
  }, 800);
}

/* ---------------- 题库 ---------------- */
const filters = { lv: new Set(), tag: new Set(), uncat: false, dup: false, mark: null };
let treeMode = true;
let qSel = new Set();

function toggleFilter(el) {
  const f = el.dataset.f, v = el.dataset.v;
  if (f === "lv" || f === "tag") {
    const set = filters[f];
    set.has(v) ? set.delete(v) : set.add(v);
  } else if (f === "uncat") filters.uncat = !filters.uncat;
  else if (f === "dup") filters.dup = !filters.dup;
  else if (f === "mark") filters.mark = filters.mark === v ? null : v;
  el.classList.toggle("on");
  renderQuestions();
}

function filteredQuestions() {
  const kw = $("#q-search").value.trim().toLowerCase();
  return questions.filter(q => {
    if (filters.lv.size && !filters.lv.has(displayMastery(q.id).lv.key)) return false;
    if (filters.tag.size && !q.tags.some(t => filters.tag.has(t))) return false;
    if (filters.uncat && q.kps.length) return false;
    if (filters.dup && dupCountFor(q) === 0) return false;
    if (filters.mark && !q.marks[filters.mark]) return false;
    const tf = window.__treeFilter || {};
    if (tf.sub === "uncat") {
      if (q.kps.length) return false;
    } else if (tf.sub && tf.sub !== "all") {
      if (q.subject !== tf.sub) return false;
      if (tf.subsub && tf.subsub !== "all" && q.subSubject !== tf.subsub) return false;
      if (tf.chapter && tf.chapter !== "all" && q.chapter !== tf.chapter) return false;
      if (tf.kp && tf.kp !== "all" && !q.kps.includes(tf.kp)) return false;
    }
    if (kw) {
      const hay = (q.titleTex + " " + q.solutionTex + " " + q.kps.join(" ") + " " + TAGS.filter(t => q.tags.includes(t.key)).map(t => t.name).join(" ")).toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderTree() {
  const card = $("#q-tree-card");
  const box = $("#q-tree");
  if (!treeMode || !card) { if (card) card.style.display = "none"; return; }
  card.style.display = "";
  const tf = window.__treeFilter || {};
  const countOf = sub => questions.filter(q => q.subject === sub.id || TREE.find(s => s.id === q.subject) === sub).length;
  const subjSel = tf.sub && tf.sub !== "all" && tf.sub !== "uncat" ? TREE.find(s => s.id === tf.sub) : null;
  const subsubSel = subjSel && tf.subsub && tf.subsub !== "all" ? subjSel.children.find(c => c.id === tf.subsub) : null;
  const chapterSel = subsubSel && tf.chapter && tf.chapter !== "all" ? subsubSel.children.find(ch => ch.id === tf.chapter) : null;
  const chip = (data, label, count, active) =>
    `<span class="chip htree-chip${active ? " active" : ""}" ${data} onclick="treePick(this)">${label}${count != null ? ` <span class="count">${count}</span>` : ""}</span>`;
  const rows = [];
  rows.push(`<div class="htree-row"><span class="htree-label">科目</span>` +
    chip(`data-sub="all"`, "🗂 全部", questions.length, !tf.sub || tf.sub === "all") +
    chip(`data-sub="uncat"`, "∅ 未分类", questions.filter(q => !q.kps.length).length, tf.sub === "uncat") +
    TREE.map(s => chip(`data-sub="${s.id}"`, (s.name === "数学" ? "📐 " : s.name === "英语" ? "🇬🇧 " : "💻 ") + esc(s.name), countOf(s), tf.sub === s.id)).join("") +
    `</div>`);
  if (subjSel) {
    rows.push(`<div class="htree-row"><span class="htree-label">子科目</span>` +
      chip(`data-subsub="all"`, "全部", null, !tf.subsub || tf.subsub === "all") +
      subjSel.children.map(c => chip(`data-subsub="${c.id}"`, esc(c.name), questions.filter(q => q.subSubject === c.id).length, tf.subsub === c.id)).join("") +
      `</div>`);
  }
  if (subsubSel) {
    rows.push(`<div class="htree-row"><span class="htree-label">章节</span>` +
      chip(`data-chapter="all"`, "全部", null, !tf.chapter || tf.chapter === "all") +
      subsubSel.children.map(ch => chip(`data-chapter="${ch.id}"`, esc(ch.name), questions.filter(q => q.chapter === ch.id).length, tf.chapter === ch.id)).join("") +
      `</div>`);
  }
  if (chapterSel) {
    rows.push(`<div class="htree-row"><span class="htree-label">知识点</span>` +
      chip(`data-kp="all"`, "全部", null, !tf.kp || tf.kp === "all") +
      chapterSel.children.map(k => chip(`data-kp="${esc(k)}"`, esc(k), questions.filter(q => q.kps.includes(k)).length, tf.kp === k)).join("") +
      `</div>`);
  }
  box.innerHTML = rows.join("");
}

function treePick(el) {
  $$(".htree-chip").forEach(x => x.classList.remove("active"));
  el.classList.add("active");
  const tf = window.__treeFilter || {};
  if (el.dataset.sub !== undefined) { tf.sub = el.dataset.sub; tf.subsub = undefined; tf.chapter = undefined; tf.kp = undefined; }
  else if (el.dataset.subsub !== undefined) { tf.subsub = el.dataset.subsub; tf.chapter = undefined; tf.kp = undefined; }
  else if (el.dataset.chapter !== undefined) { tf.chapter = el.dataset.chapter; tf.kp = undefined; }
  else if (el.dataset.kp !== undefined) { tf.kp = el.dataset.kp; }
  window.__treeFilter = tf;
  renderTree();
  renderQuestions();
}

function toggleTree() {
  treeMode = !treeMode;
  $("#q-tree-btn").textContent = treeMode ? "☰ 列表视图" : "🌲 树形视图";
  renderTree();
  renderQuestions();
}

function renderQuestions() {
  renderTree();
  const list = filteredQuestions();
  $("#q-sub").textContent = `共 ${questions.length} 题 · 当前筛选 ${list.length} 题`;
  $("#q-count").textContent = `显示 ${list.length} / ${questions.length} 条`;
  $("#q-batch-btn").style.display = qSel.size ? "" : "none";
  $("#q-sel-all").checked = list.length > 0 && list.every(q => qSel.has(q.id));

  $("#q-body").innerHTML = list.map(q => {
    const m = displayMastery(q.id);
    const dup = dupCountFor(q);
    const tagTxt = TAGS.filter(t => q.tags.includes(t.key)).map(t => `${t.icon} ${t.name.split("/")[0]}`).join(" ");
    const kpTxt = q.kps.length ? q.kps.join(" / ") : '<span class="tag">未分类</span>';
    const aged = m.decay;
    return `<tr>
      <td><input type="checkbox" ${qSel.has(q.id) ? "checked" : ""} onclick="toggleSel(${q.id},this)" /></td>
      <td>${lvTag(m.lv, m.decay)}</td>
      <td>
        <div class="katex-render" data-tex="${esc(q.titleTex)}"></div>
        <div class="small muted mt-8">${esc(TREE.flatMap(s => s.children).find(c => c.id === q.subSubject)?.name || "")} · ${fmtDate(q.createdAt)} 录入${dup ? ` · <span class="text-danger">⚠ 疑似重复 ${dup}</span>` : ""}${aged ? " · 超过 7 天未复习" : ""}</div>
      </td>
      <td><div class="flex" style="flex-wrap:wrap;">${kpTxt}</div></td>
      <td>${tagTxt || '<span class="muted">—</span>'}</td>
      <td>${logsOf(q.id).length}</td>
      <td>
        <div class="flex">
          <button class="btn btn-sm" onclick="openDetail(${q.id})">详情</button>
          <button class="btn btn-sm ${q.marks.star ? "btn-primary" : ""}" onclick="toggleMark(${q.id},'star',this)">★</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  renderMath($("#q-body"));
}

function toggleSel(id, el) {
  el.checked ? qSel.add(id) : qSel.delete(id);
  renderQuestions();
}
function toggleSelectAll(el) {
  const list = filteredQuestions();
  list.forEach(q => el.checked ? qSel.add(q.id) : qSel.delete(q.id));
  renderQuestions();
}
function toggleMark(id, key, el) {
  const q = questions.find(x => x.id === id);
  q.marks[key] = !q.marks[key];
  if (el) el.classList.toggle("btn-primary", q.marks[key]);
  persistLocal();
  toast(q.marks[key] ? "已标记 ★" : "取消标记");
  renderQuestions();
}

function batchClassify() {
  const sel = questions.filter(q => qSel.has(q.id));
  if (!sel.length) return;
  openModal(`批量归类（已选 ${sel.length} 题）`, `
    <div class="small muted mb-16">没动的项保持原值：只选科目 → 只改科目；只勾知识点 → 只改知识点。</div>
    <div class="grid grid-2">
      <div class="field"><label>科目</label><select class="select" id="bc-subject"><option value="">（保持不变）</option>${TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>子科目</label><select class="select" id="bc-subsub"><option value="">（保持不变）</option></select></div>
    </div>
    <div class="field">
      <label>章节</label>
      <select class="select" id="bc-chapter"><option value="">（保持不变）</option></select>
    </div>
    <div class="field">
      <label>知识点（勾选覆盖，不勾保持原值）</label>
      <div class="flex" id="bc-kps" style="flex-wrap:wrap;"><span class="small muted">选完章节后这里会出现知识点</span></div>
    </div>
    <label class="flex mt-8" style="gap:8px;cursor:pointer;"><input type="checkbox" id="bc-uncat" /> 全部设为「未分类」（清空知识点；未分类 = 无知识点）</label>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doBatchClassify()">应用</button>`
  );
  $("#bc-subject").onchange = fillBcSub;
  $("#bc-subsub").onchange = fillBcChapter;
  $("#bc-chapter").onchange = fillBcChapter;
  fillBcSub();
}

function fillBcSub() {
  const subj = TREE.find(s => s.id === $("#bc-subject").value);
  $("#bc-subsub").innerHTML = `<option value="">（保持不变）</option>` +
    (subj ? subj.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  fillBcChapter();
}

function fillBcChapter() {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#bc-subsub").value);
  const prev = $("#bc-chapter").value;
  $("#bc-chapter").innerHTML = `<option value="">（保持不变）</option>` +
    (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
  $("#bc-chapter").value = ss && ss.children.some(ch => ch.id === prev) ? prev : "";
  const kps = ss ? ss.children.find(ch => ch.id === $("#bc-chapter").value) : null;
  const wrap = $("#bc-kps");
  wrap.innerHTML = kps
    ? kps.children.map(k => `<span class="chip" data-k="${esc(k)}" onclick="this.classList.toggle('on')">${esc(k)}</span>`).join("")
    : `<span class="small muted">${ss ? "选完章节后这里会出现知识点" : "先选 科目 → 子科目 → 章节"}</span>`;
}

function doBatchClassify() {
  const subj = $("#bc-subject").value;
  const subsub = $("#bc-subsub").value;
  const chapter = $("#bc-chapter").value;
  const kps = $$("#bc-kps .chip.on").map(c => c.dataset.k);
  const uncat = $("#bc-uncat").checked;
  const selected = questions.filter(q => qSel.has(q.id));
  const n = selected.length;
  selected.forEach(q => {
    if (subj) q.subject = subj;
    if (subsub) q.subSubject = subsub;
    if (chapter) q.chapter = chapter;
    if (kps.length) q.kps = kps.slice();
    if (uncat) q.kps = [];
  });
  qSel.clear();
  persistLocal();
  closeModal();
  toast(`已归类 ${n} 题`, "success");
  renderQuestions();
}

/* ---------------- 题目详情 ---------------- */
function openDetail(id) {
  go("detail");
  const q = questions.find(x => x.id === id);
  const m = displayMastery(q.id);
  const logs = logsOf(q.id);
  const tagNames = TAGS.filter(t => q.tags.includes(t.key));
  const resultMeta = {
    ok: ["✅ 完全做对", "text-success"],
    half: ["🟡 思路对细节错", "text-warn"],
    stuck: ["🟠 卡住/做不完", "text-orange"],
    fail: ["❌ 完全不会", "text-danger"]
  };
  $("#detail-body").innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title"><a onclick="go('questions')" class="muted">‹ 题库</a> · 题目详情 #${q.id}</div>
        <div class="page-sub">${esc(TREE.find(s => s.id === q.subject)?.name || "")} → ${esc(TREE.flatMap(s => s.children).find(c => c.id === q.subSubject)?.name || "")} · ${fmtDate(q.createdAt)} 录入</div>
      </div>
      <div class="topbar-right">
        <button class="btn" onclick="openEditModal(${q.id})">✏️ 编辑</button>
        <button class="btn" onclick="toggleMark(${q.id},'star')">★ 星标${q.marks.star ? "（已标）" : ""}</button>
        <button class="btn" onclick="toggleMark(${q.id},'rescratch')">↻ 待二刷${q.marks.rescratch ? "（已标）" : ""}</button>
        <button class="btn" onclick="toggleMark(${q.id},'classic')">✦ 经典好题${q.marks.classic ? "（已标）" : ""}</button>
        <button class="btn btn-danger" onclick="askDelete(${q.id})">删除</button>
      </div>
    </div>
    <div class="grid grid-3">
      <div class="stat-card">
        <div class="stat-label">当前掌握度${m.decay ? "（衰减中）" : ""}</div>
        <div class="stat-value" style="font-size:19px;">${lvTag(m.lv, m.decay)}</div>
        <div class="stat-delta ${m.lv.key === "blue" ? "" : "down"}">${m.pause ? "自评档位未改变连续计数" : `连续 ${m.lv.key === "blue" ? "对" : "错"} ${m.streak} 次`}${m.decay ? " · 超过 7 天未复习" : ""}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">累计复习</div>
        <div class="stat-value" style="font-size:19px;">${logs.length} 次</div>
        <div class="stat-delta">最近 ${logs.length ? fmtDate(logs[logs.length - 1].at) : "—"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">错因（主因 + 次因）</div>
        <div class="stat-value" style="font-size:15px;font-weight:600;">${tagNames.length ? tagNames.map(t => `${t.icon} ${t.name}`).join(" · ") : "未设置"}</div>
        <div class="stat-delta">${q.urgent ? "⏫ 做错加急标记（下次抽题 ×2）" : "四档自评会标记 计算薄弱 / 需巩固"}</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div class="card-title">题目</div><span class="tag">content_type: ${q.type}${q.marks.rescratch ? " · 待二刷" : ""}</span></div>
      <div class="katex-render" data-tex="${esc(q.titleTex)}" data-display="1"></div>
      <div class="divider"></div>
      <div class="card-title small mb-16">解题过程</div>
      <div class="katex-render" data-tex="${esc(q.solutionTex || "（未填写）")}" data-display="1"></div>
      ${q.note ? `<div class="mt-16"><span class="tag tag-primary">📝 我的笔记</span><div class="small mt-8" style="background:var(--primary-soft);border-radius:10px;padding:10px;">${esc(q.note)}</div></div>` : ""}
    </div>

    <div class="card mt-16">
      <div class="card-head"><div class="card-title">关联知识点（支持多知识点）</div></div>
      <div class="flex" style="flex-wrap:wrap;">${q.kps.length ? q.kps.map(k => `<span class="tag tag-primary">${esc(k)}</span>`).join("") : '<span class="tag">未分类</span>'}</div>
      <div class="divider"></div>
      <div class="card-title small mb-16">📝 题目笔记 / 心得</div>
      <textarea class="textarea" id="detail-note" placeholder="记下这题的关键点，比如：这题的关键是换元">${esc(q.note)}</textarea>
      <button class="btn btn-sm mt-8" onclick="saveNote(${q.id})">保存笔记</button>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div class="card-title">复习记录时间线</div><span class="tag">${logs.length} 条</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${logs.length ? logs.slice().reverse().map((l, i) => {
          const meta = resultMeta[l.result] || ["—", "muted"];
          return `<div class="flex-between small">
            <span><span class="tag ${meta[1]}">${meta[0]}</span> 第 ${logs.length - i} 次 · ${fmtDate(l.at)}</span>
            <span class="muted">${i === 0 ? "← 最新" : ""}</span>
          </div>`;
        }).join("") : '<div class="small muted">尚无复习记录</div>'}
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div class="card-title">四档自评（立即体验）</div></div>
      <div class="small muted mb-16">✅ 完全做对=正常升级 · 🟡 思路对细节错=升半级/不升（标记计算薄弱）· 🟠 卡住=不升级 · ❌ 不会=降级重置</div>
      <div class="self-rate">
        <button class="rate-btn ok" onclick="quickRate(${q.id},'ok')">✅ 做对</button>
        <button class="rate-btn" style="border-color:#F59F00;color:#B97700;" onclick="quickRate(${q.id},'half')">🟡 半对</button>
        <button class="rate-btn" style="border-color:#F76707;color:#F76707;" onclick="quickRate(${q.id},'stuck')">🟠 卡住</button>
        <button class="rate-btn no" onclick="quickRate(${q.id},'fail')">❌ 不会</button>
      </div>
    </div>`;
  renderMath($("#detail-body"));
}

function saveNote(id) {
  const q = questions.find(x => x.id === id);
  q.note = $("#detail-note").value;
  persistLocal();
  toast("笔记已保存");
}

/* ---------------- 题目编辑 ---------------- */
function openEditModal(id) {
  const q = questions.find(x => x.id === id);
  if (!q) return;
  const subjOptions = TREE.map(s => `<option value="${s.id}" ${q.subject === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const subj = TREE.find(s => s.id === q.subject);
  const ssOptions = (subj ? subj.children : []).map(c => `<option value="${c.id}" ${q.subSubject === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const ss = subj ? subj.children.find(c => c.id === q.subSubject) : null;
  const chOptions = `<option value="">未分章</option>` + (ss ? ss.children.map(ch => `<option value="${ch.id}" ${q.chapter === ch.id ? "selected" : ""}>${esc(ch.name)}</option>`).join("") : "");
  const kps = ss && ss.children.find(ch => ch.id === q.chapter);
  const kpChips = `<span class="chip ${!q.kps.length ? "on" : ""}" data-k="" onclick="toggleEditKp(this)">∅ 未分类</span>` +
    ((kps ? kps.children : []).map(k => `<span class="chip ${q.kps.includes(k) ? "on" : ""}" data-k="${esc(k)}" onclick="toggleEditKp(this)">${esc(k)}</span>`).join(""));
  const tagChips = TAGS.map(t => `<span class="chip ${q.tags.includes(t.key) ? "on" : ""}" data-k="${t.key}" onclick="toggleEditTag(this)">${t.icon} ${t.name}</span>`).join("");
  window.__editQ = q;
  window.__editKps = new Set(q.kps);
  window.__editTags = new Set(q.tags);
  openModal(`编辑题目 #${q.id}`, `
    <div class="field"><label>题面（LaTeX）</label><textarea class="textarea" id="edit-title" rows="4">${esc(q.titleTex)}</textarea></div>
    <div class="field"><label>解题过程</label><textarea class="textarea" id="edit-solution" rows="3">${esc(q.solutionTex || "")}</textarea></div>
    <div class="field"><label>笔记 / 心得</label><textarea class="textarea" id="edit-note" rows="2">${esc(q.note || "")}</textarea></div>
    <div class="grid grid-2">
      <div class="field"><label>科目</label><select class="select" id="edit-subject" onchange="editFillSub()">${subjOptions}</select></div>
      <div class="field"><label>子科目</label><select class="select" id="edit-subsub" onchange="editFillChapter()">${ssOptions}</select></div>
    </div>
    <div class="field"><label>章节</label><select class="select" id="edit-chapter" onchange="editFillKps()">${chOptions}</select></div>
    <div class="field"><label>知识点（多选）</label><div class="flex" id="edit-kps" style="flex-wrap:wrap;">${kpChips}</div></div>
    <div class="field"><label>错因标签</label><div class="flex" id="edit-tags" style="flex-wrap:wrap;">${tagChips}</div></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="saveEditQuestion()">保存修改</button>`
  );
}

function editFillSub() {
  const subj = TREE.find(s => s.id === $("#edit-subject").value);
  $("#edit-subsub").innerHTML = (subj ? subj.children : []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  editFillChapter();
}
function editFillChapter() {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#edit-subsub").value);
  $("#edit-chapter").innerHTML = `<option value="">未分章</option>` + (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
  editFillKps();
}
function editFillKps() {
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === $("#edit-chapter").value);
  const kps = ch ? ch.children : [];
  $("#edit-kps").innerHTML = `<span class="chip on" data-k="" onclick="toggleEditKp(this)">∅ 未分类</span>` +
    kps.map(k => `<span class="chip" data-k="${esc(k)}" onclick="toggleEditKp(this)">${esc(k)}</span>`).join("");
  window.__editKps = new Set();
  $$("#edit-kps .chip.on").forEach(c => window.__editKps.add(c.dataset.k));
}
function toggleEditKp(el) {
  el.classList.toggle("on");
  const k = el.dataset.k;
  if (el.classList.contains("on")) window.__editKps.add(k); else window.__editKps.delete(k);
}
function toggleEditTag(el) {
  el.classList.toggle("on");
  const k = el.dataset.k;
  if (el.classList.contains("on")) window.__editTags.add(k); else window.__editTags.delete(k);
}
function saveEditQuestion() {
  const q = window.__editQ;
  if (!q) return;
  const titleTex = $("#edit-title").value.trim();
  if (!titleTex) { toast("题面不能为空", "error"); return; }
  q.titleTex = titleTex;
  q.solutionTex = $("#edit-solution").value.trim();
  q.note = $("#edit-note").value.trim();
  q.subject = $("#edit-subject").value;
  q.subSubject = $("#edit-subsub").value;
  q.chapter = $("#edit-chapter").value;
  q.kps = Array.from(window.__editKps).filter(Boolean);
  q.tags = Array.from(window.__editTags);
  persistLocal();
  closeModal();
  toast("题目已更新", "success");
  openDetail(q.id);
}

function quickRate(id, result) {
  reviewLogs.push({ id: ++reviewSeq, qid: id, at: Date.now(), result });
  const q = questions.find(x => x.id === id);
  if (result === "fail") q.urgent = true;
  if (result === "half") q.calcWeak = true;
  if (result === "stuck") q.needConsolidate = true;
  persistLocal();
  const m = displayMastery(id);
  toast(`已记录自评 → 当前 ${m.lv.icon} ${m.lv.name}`, "success");
  openDetail(id);
}

function askDelete(id) {
  openModal("确认删除？此操作不可撤销", `
    <div class="small muted">删除后题目消失，复习记录保留但题目置空（SET NULL）。</div>
    <div class="field mt-16"><label>输入「删除」二字确认</label><input class="input" id="del-confirm" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="doDelete(${id})">确认删除</button>`
  );
}
function doDelete(id) {
  if ($("#del-confirm").value.trim() !== "删除") { toast("需输入「删除」二字", "error"); return; }
  questions = questions.filter(q => q.id !== id);
  reviewLogs = reviewLogs.filter(l => l.qid !== id);
  persistLocal();
  closeModal();
  toast("已删除");
  go("questions");
}

/* ---------------- 复习 ---------------- */
let reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", num: 3 };
let reviewQueue = [];
let reviewIdx = 0;
let reviewDone = new Set();    // 已自评的题号（队列下标）
let reviewSkipped = new Set(); // 跳过的题号
let reviewStartedAt = 0;
let reviewResults = [];

function renderReviewConfig() {
  $("#review-sub").textContent = "分层优先 + 加权随机 · 做错加急 · 覆盖保证";
  $("#rev-subject").innerHTML = `<option value="all">全部科目</option>` +
    TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#rev-subject").value = reviewCfg.subject || "all";
  $("#rev-subject").onchange = e => {
    reviewCfg.subject = e.target.value;
    reviewCfg.sub = "all";
    fillRevSub();
    persistLocal();
  };
  fillRevSub();
  $$("#rev-lv-filter .chip").forEach(c => c.onclick = () => {
    reviewCfg.lv = c.dataset.v;
    $$("#rev-lv-filter .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    $("#rev-deadlock-hint").style.display = reviewCfg.lv === "err" ? "" : "none";
    persistLocal();
  });
  $$("#rev-lv-filter .chip").forEach(x => x.classList.toggle("on", x.dataset.v === reviewCfg.lv));
  $("#rev-deadlock-hint").style.display = reviewCfg.lv === "err" ? "" : "none";
  $$("#rev-num .chip").forEach(c => c.onclick = () => {
    reviewCfg.num = Number(c.dataset.v);
    $$("#rev-num .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    persistLocal();
  });
  $$("#rev-num .chip").forEach(x => x.classList.toggle("on", x.dataset.v === String(reviewCfg.num)));
  $("#review-config").style.display = "";
  $("#review-play").style.display = "none";
  $("#review-done").style.display = "none";
  renderResumeButton();
}

function fillRevSub() {
  const subj = TREE.find(s => s.id === $("#rev-subject").value);
  $("#rev-subsub").innerHTML = `<option value="all">全部子科目</option>` +
    (subj ? subj.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  $("#rev-subsub").value = reviewCfg.sub || "all";
  $("#rev-subsub").onchange = e => { reviewCfg.sub = e.target.value; fillRevChapter(); persistLocal(); };
  fillRevChapter();
}

/* 复习断点续传 */
function renderResumeButton() {
  const btn = $("#review-resume-btn");
  if (!btn) return;
  try {
    const r = JSON.parse(localStorage.getItem("review-resume") || "null");
    if (r && Array.isArray(r.queue) && r.idx < r.queue.length) {
      btn.style.display = "";
      btn.textContent = `↻ 继续上次复习（已做 ${r.idx} / ${r.queue.length}）`;
    } else {
      btn.style.display = "none";
    }
  } catch (e) { btn.style.display = "none"; }
}

function continueResume() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem("review-resume") || "null"); } catch (e) { /* 忽略 */ }
  if (!r || !Array.isArray(r.queue)) { toast("没有可继续的复习进度", "error"); return; }
  const pool = r.queue.map(id => questions.find(q => q.id === id)).filter(Boolean);
  if (!pool.length) {
    toast("上次的题目已被删除，无法继续", "error");
    localStorage.removeItem("review-resume");
    renderResumeButton();
    return;
  }
  reviewQueue = pool;
  reviewIdx = Math.min(r.idx, pool.length);
  reviewResults = [];
  reviewDone = new Set(r.done || []);
  reviewSkipped = new Set(r.skipped || []);
  reviewStartedAt = Date.now();
  localStorage.removeItem("review-resume");
  renderResumeButton();
  $("#review-config").style.display = "none";
  $("#review-done").style.display = "none";
  $("#review-play").style.display = "";
  showReviewCard();
  toast("已恢复上次复习进度", "success");
}

function renderRecPanel() {
  const box = $("#rec-panel");
  if (!box) return;
  const rec = recommendQuestions(5);
  box.innerHTML = rec.length
    ? rec.map(q => {
        const m = displayMastery(q.id);
        return `<div class="flex-between" style="gap:10px;">
          <span class="katex-render" data-tex="${esc(q.titleTex)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          ${lvTag(m.lv, m.decay)}
        </div>`;
      }).join("")
    : `<div class="small muted">暂无可推荐题目</div>`;
  renderMath(box);
}

function fillRevChapter() {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#rev-subsub").value);
  const prev = reviewCfg.chapter;
  $("#rev-chapter").innerHTML = `<option value="">全部章节</option>` +
    (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
  reviewCfg.chapter = "";
  if (ss && ss.children.some(ch => ch.id === prev)) reviewCfg.chapter = prev;
  $("#rev-chapter").value = reviewCfg.chapter;
}

function startReview() {
  startReviewWith(reviewCfg.num, null);
}

function startReviewWith(n, presetList) {
  // 今日推荐：直接用推荐列表复习（不再随机抽取）
  if (presetList && Array.isArray(presetList) && presetList.length) {
    reviewQueue = presetList.slice(0, n);
    reviewIdx = 0;
    reviewResults = [];
    reviewDone = new Set();
    reviewSkipped = new Set();
    reviewStartedAt = Date.now();
    $("#review-config").style.display = "none";
    $("#review-done").style.display = "none";
    $("#review-play").style.display = "";
    showReviewCard();
    return;
  }
  // 候选筛选
  let pool = questions.filter(q => {
    if (q.subject !== "subj-math" && q.subject !== "subj-eng" && q.subject !== "subj-408") return false;
    if (reviewCfg.subject && reviewCfg.subject !== "all" && q.subject !== reviewCfg.subject) return false;
    if (reviewCfg.sub && reviewCfg.sub !== "all" && q.subSubject !== reviewCfg.sub) return false;
    if (reviewCfg.chapter && q.chapter !== reviewCfg.chapter) return false;
    const lv = displayMastery(q.id).lv.key;
    if (reviewCfg.lv === "err" && !ERR_TRACK.includes(lv)) return false;
    if (reviewCfg.lv === "worst" && lv !== "darkred" && lv !== "red") return false;
    if (lv === "blue") return false; // 默认排除完全掌握
    return true;
  });
  if (!pool.length) { toast("没有符合条件的题目", "error"); return; }

  // 分层优先：被抽次数 0 / 1 / ≥2
  const pickCount = q => logsOf(q.id).length;
  const layers = [[], [], []];
  pool.forEach(q => layers[Math.min(pickCount(q), 2)].push(q));
  const picked = [];
  const need = Math.min(n, pool.length);
  for (const layer of layers) {
    if (picked.length >= need) break;
    const candidates = layer.slice();
    while (candidates.length && picked.length < need) {
      const totalW = candidates.reduce((s, q) => s + weightOf(q), 0);
      let r = Math.random() * totalW;
      let chosen = candidates[0];
      for (const q of candidates) { r -= weightOf(q); if (r <= 0) { chosen = q; break; } }
      picked.push(chosen);
      candidates.splice(candidates.indexOf(chosen), 1);
    }
  }
  reviewQueue = picked;
  reviewIdx = 0;
  reviewResults = [];
  reviewDone = new Set();
  reviewSkipped = new Set();
  reviewStartedAt = Date.now();
  $("#review-config").style.display = "none";
  $("#review-done").style.display = "none";
  $("#review-play").style.display = "";
  showReviewCard();
}

function weightOf(q) {
  const lv = displayMastery(q.id).lv;
  let w = lv.weight;
  if (q.urgent) w *= 2;
  return w;
}

function showReviewCard() {
  if (reviewIdx >= reviewQueue.length) { showReviewDone(); return; }
  const q = reviewQueue[reviewIdx];
  const m = displayMastery(q.id);
  $("#rev-card-top").innerHTML = `${lvTag(m.lv, m.decay)}<span class="small muted">${m.pause ? "保持（半对/卡住，不升降级）" : `连续 ${m.lv.key === "blue" ? "对" : "错"} ${m.streak} 次`}${q.urgent ? " · ⏫ 做错加急 ×2" : ""}</span>`;
  $("#rev-progress").textContent = `已做 ${reviewDone.size} / 共 ${reviewQueue.length}`;
  renderRevNav();
  $("#rev-question").innerHTML = "";
  renderTex($("#rev-question"), q.titleTex, true);
  $("#rev-answer").style.display = "none";
  $("#rev-show-ans").style.display = "";
  $("#rev-rate").style.display = "none";
  $("#rev-rate-hint").textContent = "";
  window.__curQ = q;
  window.__curM = m;
  renderMath($("#rev-question"));
}

/* 题目导航：点击任意未做题号自由切换 */
function renderRevNav() {
  const box = $("#rev-nav");
  if (!box) return;
  box.innerHTML = reviewQueue.map((q, i) => {
    const state = reviewDone.has(i) ? "done" : reviewSkipped.has(i) ? "skipped" : i === reviewIdx ? "now" : "todo";
    const label = reviewDone.has(i) ? `✓ ${i + 1}` : reviewSkipped.has(i) ? `⏭ ${i + 1}` : `${i + 1}`;
    return `<span class="chip rev-nav-item ${state}" onclick="jumpTo(${i})">${label}</span>`;
  }).join("");
}

function jumpTo(i) {
  if (i < 0 || i >= reviewQueue.length) return;
  if (reviewDone.has(i)) { toast("这道题已完成自评", "error"); return; }
  reviewIdx = i;
  showReviewCard();
}

function skipCurrent() {
  if (!reviewQueue.length || reviewDone.has(reviewIdx)) return;
  reviewSkipped.add(reviewIdx);
  toast("已跳过此题，可随时点题号回来做");
  autoNext();
}

function autoNext() {
  // 优先未做且未跳过的；没有则优先未做（含跳过的）；再没有就完成
  for (let i = 0; i < reviewQueue.length; i++) {
    if (!reviewDone.has(i) && !reviewSkipped.has(i)) { reviewIdx = i; showReviewCard(); return; }
  }
  for (let i = 0; i < reviewQueue.length; i++) {
    if (!reviewDone.has(i)) { reviewIdx = i; showReviewCard(); return; }
  }
  showReviewDone();
}

function revealAnswer() {
  const q = window.__curQ;
  $("#rev-answer").innerHTML = `<div class="small muted mb-16">解题过程：</div><span class="katex-render" data-tex="${esc(q.solutionTex || "（未填写解析）")}" data-display="1"></span>`;
  renderMath($("#rev-answer"));
  $("#rev-answer").style.display = "";
  $("#rev-show-ans").style.display = "none";
  $("#rev-rate").style.display = "flex";
  $("#rev-rate-hint").textContent = "自评四档：✅ 完全做对=正常升级 · 🟡 思路对细节错=升半级/不升 · 🟠 卡住=不升级 · ❌ 不会=降级重置";
}

function selfRate(result) {
  const q = window.__curQ;
  reviewLogs.push({ id: ++reviewSeq, qid: q.id, at: Date.now(), result });
  if (result === "fail") q.urgent = true;
  if (result === "half") { q.calcWeak = true; q.urgent = false; }
  if (result === "stuck") q.needConsolidate = true;
  if (result === "ok") q.urgent = false;
  persistLocal();
  reviewResults.push({ q, result, before: window.__curM });
  const m = displayMastery(q.id);
  const msgs = {
    ok: `✅ → ${m.lv.icon} ${m.lv.name}（升级动画）`,
    half: `🟡 记录"计算薄弱"，${m.pause ? "保持" : m.lv.icon + " " + m.lv.name}`,
    stuck: `🟠 记录"需巩固"，保持 ${m.lv.icon} ${m.lv.name}`,
    fail: `❌ 做错加急 ⏫，→ ${m.lv.icon} ${m.lv.name}（红色闪烁提示）`
  };
  toast(msgs[result], result === "fail" ? "error" : "success");
  reviewDone.add(reviewIdx);
  autoNext();
}

function reviewExit() {
  openModal("复习进度已保存", `
    <div class="small muted">已做 ${reviewResults.length} / ${reviewQueue.length} 题，进度存 localStorage（断点续传）。</div>`,
    `<button class="btn" onclick="closeModal();go('dashboard')">知道了</button>`
  );
  localStorage.setItem("review-resume", JSON.stringify({
    queue: reviewQueue.map(q => q.id),
    idx: reviewIdx,
    done: Array.from(reviewDone),
    skipped: Array.from(reviewSkipped),
    results: reviewResults
  }));
}

function showReviewDone() {
  $("#review-play").style.display = "none";
  $("#review-done").style.display = "";
  const secs = Math.round((Date.now() - reviewStartedAt) / 1000);
  $("#rev-done-time").textContent = `用时 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
  const ok = reviewResults.filter(r => r.result === "ok").length;
  const half = reviewResults.filter(r => r.result === "half").length;
  const stuck = reviewResults.filter(r => r.result === "stuck").length;
  const fail = reviewResults.filter(r => r.result === "fail").length;
  const skipped = reviewSkipped.size;
  $("#rev-done-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">抽题 / 完成</div><div class="stat-value">${reviewQueue.length} / ${reviewResults.length}</div></div>
    <div class="stat-card"><div class="stat-label">✅ 做对</div><div class="stat-value" style="color:var(--success);">${ok}</div></div>
    <div class="stat-card"><div class="stat-label">⏭ 跳过</div><div class="stat-value" style="color:var(--text-3);">${skipped}</div></div>`;
  $("#rev-done-list").innerHTML = reviewResults.map(r => {
    const after = displayMastery(r.q.id);
    const arrow = r.before.lv.key === after.lv.key ? "→" : "→";
    const cls = after.lv.key === r.before.lv.key ? "muted" : (ERR_TRACK.includes(after.lv.key) ? "text-danger" : "text-success");
    return `<div class="flex-between small">
      <span class="katex-render" data-tex="${esc(r.q.titleTex)}"></span>
      <span class="${cls}">${r.before.lv.icon} ${r.before.lv.name} ${arrow} ${after.lv.icon} ${after.lv.name}${after.decay ? "（衰减）" : ""}</span>
    </div>`;
  }).join("");
  renderMath($("#rev-done-list"));
  if (skipped) {
    const warn = document.createElement("div");
    warn.className = "alert alert-warn";
    warn.innerHTML = `已跳过 ${skipped} 道题：${Array.from(reviewSkipped).map(i => `第 ${i + 1} 题`).join("、")}。可「再来一轮」重抽，或回题库单独重做。`;
    $("#rev-done-list").prepend(warn);
  }
}

/* ---------------- 统计 ---------------- */
function renderStats() {
  // 概览统计行
  const total = questions.length;
  const blue = questions.filter(q => displayMastery(q.id).lv.key === "blue").length;
  const err = questions.filter(q => ERR_TRACK.includes(displayMastery(q.id).lv.key)).length;
  const unmastered = total - blue;
  const studyMin = Math.floor(study.seconds / 60);
  const avg = total ? reviewLogs.length / total : 0;
  $("#stats-total").textContent = total;
  $("#stats-total-delta").textContent = `完全掌握 ${blue} 道`;
  $("#stats-unmastered").textContent = unmastered;
  $("#stats-unmastered-delta").textContent = `掌握率 ${total ? Math.round(blue / total * 100) : 0}%`;
  $("#stats-err").textContent = err;
  $("#stats-err-delta").textContent = "需优先攻克";
  $("#stats-time").textContent = studyMin;
  $("#stats-avg").textContent = `平均复习 ${avg.toFixed(1)} 次 / 题`;

  const pie = $("#stats-pie"), tagPie = $("#stats-tag-pie"), weak = $("#stats-weak"), studyChart = $("#stats-study");
  if (!window.echarts) { [pie, tagPie, weak, studyChart].forEach(el => el.innerHTML = `<div class="muted" style="padding:40px;">ECharts 未加载</div>`); return; }
  const lvData = Object.values(LV).map(lv => ({
    name: lv.icon + " " + lv.name,
    value: questions.filter(q => displayMastery(q.id).lv.key === lv.key).length
  })).filter(x => x.value > 0);
  echarts.init(pie).setOption({
    color: ["#862E2E", "#E03131", "#F76707", "#ADB5BD", "#F59F00", "#2F9E44", "#1971C2"],
    tooltip: { trigger: "item" },
    series: [{ type: "pie", radius: ["42%", "68%"], label: { formatter: "{b}: {c}" }, data: lvData }]
  });
  const tagData = TAGS.map(t => ({
    name: t.icon + " " + t.name,
    value: questions.filter(q => q.tags.includes(t.key)).length
  })).filter(x => x.value > 0);
  echarts.init(tagPie).setOption({
    color: ["#4C6EF5", "#F59F00", "#F76707", "#2F9E44", "#E03131", "#ADB5BD"],
    tooltip: { trigger: "item" },
    series: [{ type: "pie", radius: ["42%", "68%"], label: { formatter: "{b}: {c}" }, data: tagData }]
  });
  const wk = weakKps().slice(0, 10);
  echarts.init(weak).setOption({
    tooltip: {},
    grid: { left: 120, right: 30, top: 10, bottom: 24 },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: wk.map(w => w.name).reverse() },
    series: [{
      type: "bar", data: wk.map(w => w.err).reverse(),
      itemStyle: { color: "#E03131", borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right" }
    }]
  });
  const days = [], vals = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(`${d.getMonth() + 1}/${d.getDate()}`);
    vals.push(Math.round((study.perDay[fmtDate(d.getTime())] || 0) / 60)); // 真实按天记录（秒 → 分钟）
  }
  echarts.init(studyChart).setOption({
    tooltip: {},
    grid: { left: 40, right: 10, top: 12, bottom: 24 },
    xAxis: { type: "category", data: days, axisLabel: { interval: 4 } },
    yAxis: { type: "value", name: "分钟" },
    series: [{ type: "line", smooth: true, data: vals, areaStyle: { opacity: .15 }, itemStyle: { color: "#4C6EF5" } }]
  });
}

/* ---------------- 设置 ---------------- */
let remindOn = true;
function selectDefaultNum(v) {
  reviewCfg.num = Number(v);
  persistLocal();
  $$("#rev-num-default .chip").forEach(x => x.classList.toggle("on", x.dataset.v === String(v)));
  toast(`默认抽题数量已设为 ${v} 题`, "success");
}
function toggleRemind() {
  remindOn = !remindOn;
  const el = $("#remind-switch");
  el.textContent = remindOn ? "已开启" : "已关闭";
  el.style.background = remindOn ? "var(--success-light)" : "#F1F3F7";
  el.style.color = remindOn ? "var(--success)" : "var(--text-3)";
  persistLocal();
  toast(remindOn ? "打开应用时提醒已开启" : "提醒已关闭");
}
function demoNotify() {
  if ("Notification" in window) {
    if (Notification.permission !== "granted") Notification.requestPermission();
    const unmastered = questions.length - questions.filter(q => displayMastery(q.id).lv.key === "blue").length;
    if (Notification.permission === "granted") new Notification("个人工作台", { body: `今天该复习错题了，当前共有 ${unmastered} 道未掌握题目` });
  }
  toast("演示通知（浏览器可能要求授权）");
}

/* 打开 App 时提醒：今天还没复习过则弹一次（同一天不重复） */
function remindCheckToday() {
  if (!remindOn) return;
  const today = fmtDate(Date.now());
  if (localStorage.getItem("mb-remind-date") === today) return;
  const reviewed = reviewLogs.some(l => fmtDate(l.at) === today);
  if (!reviewed) {
    localStorage.setItem("mb-remind-date", today);
    openModal("📌 今日复习提醒", `
      <div class="small">今天还没有复习记录。打开 App 是复习的最好时机，去抽几题吧。</div>`,
      `<button class="btn" onclick="closeModal()">稍后再说</button>
       <button class="btn btn-primary" onclick="closeModal();goDashSection('review')">去复习</button>`
    );
  }
}

function renderSettings() {
  $$("#rev-num-default .chip").forEach(c => c.onclick = () => selectDefaultNum(c.dataset.v));
  $$("#rev-num-default .chip").forEach(x => x.classList.toggle("on", x.dataset.v === String(reviewCfg.num)));
  const vEl = $("#app-version");
  if (vEl) vEl.textContent = "v" + APP_VERSION;
  const apiTag = $("#api-mode-tag");
  if (apiTag) apiTag.textContent = serverDown ? "API: 本地服务未启动" : "API: 本地 SQLite";
  loadOcrConfig();
  const box = $("#settings-tree");
  box.innerHTML = `
    <div class="flex-between mb-16" style="gap:12px;">
      <span class="small muted">层级：科目 → 子科目 → 章节 → 知识点。新增示例：点「数学」的＋加子科目（如已有高等数学则跳过）→ 点「高等数学」的＋加章节，名称填「无穷级数」→ 点该章节的＋加知识点。</span>
      <button class="btn btn-sm btn-primary" onclick="addSubject()">＋ 新增科目</button>
    </div>` +
    TREE.map(s => `
    <div class="flex-between" style="padding:5px 8px;">
      <b>${esc(s.name)}</b>
      <div class="flex">
        <button class="btn btn-sm" onclick="addNode('${s.id}')">＋加子科目</button>
        <button class="btn btn-sm" onclick="renameNode('${s.id}')">改</button>
        <button class="btn btn-sm btn-danger" onclick="delNode('${s.id}')">删</button>
      </div>
    </div>
    <div class="tree-children">
      ${s.children.map(ss => `
        <div class="flex-between" style="padding:4px 8px;">
          <span>∟ ${esc(ss.name)}</span>
          <div class="flex">
            <button class="btn btn-sm" onclick="addNode('${ss.id}')">＋加章节</button>
            <button class="btn btn-sm" onclick="renameNode('${ss.id}')">改</button>
            <button class="btn btn-sm btn-danger" onclick="delNode('${ss.id}')">删</button>
          </div>
        </div>
        <div class="tree-children">
          ${ss.children.map(ch => `
            <div class="flex-between" style="padding:3px 8px;">
              <span>∟ ${esc(ch.name)}</span>
              <div class="flex">
                <button class="btn btn-sm" onclick="addKp('${ch.id}')">＋加知识点</button>
                <button class="btn btn-sm" onclick="renameNode('${ch.id}')">改</button>
                <button class="btn btn-sm btn-danger" onclick="delNode('${ch.id}')">删</button>
              </div>
            </div>
            <div class="tree-children">
              ${ch.children.map(k => `<div class="flex-between" style="padding:3px 8px 3px 16px;">
                <span>∟ ${esc(k)}</span>
                <button class="btn btn-sm btn-danger" data-ch="${ch.id}" data-k="${esc(k)}" onclick="askDelKp(this)">删</button>
              </div>`).join("")}
            </div>`).join("")}
        </div>`).join("")}
    </div>`).join("");
}

/* OCR 服务配置（模拟 / MinerU 真实识别） */
function loadOcrConfig() {
  const cfg = API.mineruConfig();
  const eng = $("#ocr-engine"); if (eng) eng.value = cfg.engine || "mock";
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" ? "引擎：MinerU（真实）" : "引擎：模拟";
}
function saveOcrConfig() {
  const cfg = {
    engine: $("#ocr-engine").value
  };
  localStorage.setItem("mb-mineru-config", JSON.stringify(cfg));
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" ? "引擎：MinerU（真实）" : "引擎：模拟";
  toast("OCR 配置已保存");
  testOcrConnection();
}
async function testOcrConnection() {
  const cfg = API.mineruConfig();
  if (cfg.engine !== "mineru") { toast("当前为模拟模式，未测试真实识别", "error"); return; }
  toast("正在测试 MinerU 连通性…");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 640, 200);
    ctx.fillStyle = "#000"; ctx.font = "36px sans-serif";
    ctx.fillText("Test 123 + x^2", 40, 110);
    const t0 = Date.now();
    const r = await API.ocrRecognize({ dataUrl: canvas.toDataURL("image/png"), name: "test.png" }, { isSolution: false });
    const cost = r.costSec || Math.round((Date.now() - t0) / 1000);
    openModal("MinerU 连通性测试通过", `
      <div class="small" style="line-height:2;">
        耗时：<b>${cost} 秒</b><br />
        识别来源：${r.source === "mineru" ? "MinerU（pipeline）" : r.source === "mineru-flash" ? "MinerU（flash）" : r.source}<br />
        识别文本：<span class="mono">${esc((r.titleTex || "").slice(0, 80))}</span>
      </div>`,
      `<button class="btn btn-primary" onclick="closeModal()">知道了</button>`
    );
  } catch (e) {
    openModal("MinerU 测试失败", `
      <div class="alert alert-danger">${esc(e.message)}</div>
      <div class="small muted">请检查 Token / API 地址，或把上面的错误信息发给开发者调整接口。</div>`,
      `<button class="btn btn-primary" onclick="closeModal()">知道了</button>`
    );
  }
}

function addNode(parentId) {
  const isSubject = TREE.some(s => s.id === parentId);
  openModal(isSubject ? "新增子科目" : "新增章节", `
    <div class="field"><label>名称</label><input class="input" id="new-node-name" placeholder="${isSubject ? "如：数学三 / 英语二" : "如：无穷级数"}" /></div>
    <div class="small muted">科目/子科目完全自定义，不写死（支持 数学一/二/三、英语一/二等）</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddNode('${parentId}')">添加</button>`
  );
}
function doAddNode(parentId) {
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  const subj = TREE.find(s => s.id === parentId);
  if (subj) subj.children.push({ id: "ss-" + Date.now(), name, children: [] });
  else {
    const ss = TREE.flatMap(s => s.children).find(c => c.id === parentId);
    if (ss) ss.children.push({ id: "ch-" + Date.now(), name, children: [] });
  }
  persistLocal();
  closeModal();
  renderSettings();
  toast("节点已添加（支持完全自定义）", "success");
}

function addSubject() {
  openModal("新增科目", `
    <div class="field"><label>科目名称</label><input class="input" id="new-node-name" placeholder="如：数学 / 英语 / 408" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddSubject()">添加</button>`
  );
}
function doAddSubject() {
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  if (TREE.some(s => s.name === name)) { toast("该科目已存在", "error"); return; }
  TREE.push({ id: "subj-" + Date.now(), name, children: [] });
  persistLocal(); closeModal(); renderSettings();
  toast("科目已添加", "success");
}

function addKp(chapterId) {
  openModal("新增知识点", `
    <div class="field"><label>知识点名称</label><input class="input" id="new-node-name" placeholder="如：无穷级数敛散性判断" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddKp('${chapterId}')">添加</button>`
  );
}
function doAddKp(chapterId) {
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === chapterId);
  const name = $("#new-node-name").value.trim();
  if (!ch || !name) return;
  if (ch.children.includes(name)) { toast("该知识点已存在", "error"); return; }
  ch.children.push(name);
  persistLocal(); closeModal(); renderSettings();
  toast("知识点已添加", "success");
}

function askDelKp(btn) {
  const chapterId = btn.dataset.ch;
  const name = btn.dataset.k;
  const qCount = questions.filter(q => q.kps.includes(name)).length;
  openModal("删除知识点", `
    <div class="small muted">${qCount ? `有 <b>${qCount}</b> 道题关联该知识点，删除后这些题将变为「未分类」。` : "确认删除该知识点？"}</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelKp('${chapterId}','${esc(name)}')">确认删除</button>`
  );
}

function doDelKp(chapterId, name) {
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === chapterId);
  if (!ch) return;
  ch.children = ch.children.filter(k => k !== name);
  questions.forEach(q => { if (q.kps.includes(name)) q.kps = []; });
  persistLocal();
  renderSettings();
  toast("知识点已删除，相关题目归入未分类", "success");
}

function renameNode(id) {
  const subj = TREE.find(s => s.id === id);
  let target = subj;
  if (!target) target = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (!target) target = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (!target) return;
  window.__renameId = id;
  openModal("重命名", `
    <div class="field"><label>新名称</label><input class="input" id="new-node-name" value="${esc(target.name)}" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doRenameNode()">保存</button>`
  );
}
function doRenameNode() {
  const id = window.__renameId;
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  let target = TREE.find(s => s.id === id);
  if (!target) target = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (!target) target = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (!target) return;
  target.name = name;
  persistLocal(); closeModal(); renderSettings();
  toast("已重命名", "success");
}

function delNode(id) {
  const subj = TREE.find(s => s.id === id);
  if (subj) {
    const qCount = questions.filter(q => q.subject === id).length;
    if (qCount) { toast(`禁止删除：该科目下有 ${qCount} 道错题（RESTRICT 保护）`, "error"); return; }
    openModal("删除科目", `确认删除科目「${esc(subj.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelSubject('${id}')">确认删除</button>`);
    return;
  }
  const ss = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (ss) {
    const qCount = questions.filter(q => q.subSubject === id).length;
    if (qCount) { toast(`禁止删除：该子科目下有 ${qCount} 道错题`, "error"); return; }
    if (ss.children.length) { toast("有子节点，禁止删除", "error"); return; }
    openModal("删除子科目", `确认删除子科目「${esc(ss.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelSubSubject('${id}')">确认删除</button>`);
    return;
  }
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (ch) {
    const qCount = questions.filter(q => q.chapter === id).length;
    openModal("删除章节", `${qCount ? `该章节下有 <b>${qCount}</b> 道错题，删除后这些题目将变为未分类。` : ""}确认删除章节「${esc(ch.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelChapterById('${id}')">确认删除</button>`);
  }
}
function doDelSubject(id) {
  const i = TREE.findIndex(s => s.id === id);
  if (i >= 0) TREE.splice(i, 1);
  persistLocal(); renderSettings(); toast("科目已删除", "success");
}
function doDelSubSubject(id) {
  TREE.forEach(s => { s.children = s.children.filter(c => c.id !== id); });
  persistLocal(); renderSettings(); toast("子科目已删除", "success");
}
function doDelChapterById(id) {
  TREE.forEach(s => s.children.forEach(c => { c.children = c.children.filter(ch => ch.id !== id); }));
  questions.forEach(q => { if (q.chapter === id) q.chapter = ""; });
  persistLocal(); renderSettings(); toast("章节已删除，相关题目归入未分类", "success");
}
function delChapter(ssId, name) {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === ssId);
  const ch = ss && ss.children.find(c => c.name === name);
  const qCount = questions.filter(q => q.chapter === ch.id).length;
  if (qCount) {
    openModal("删除章节", `<div class="small muted">该章节下有 ${qCount} 道错题，删除后这些题目将变为未分类，确认？</div>`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-primary" onclick="doDelChapter('${ssId}','${esc(name)}')">确认删除</button>`);
  } else {
    doDelChapter(ssId, name);
  }
}
function doDelChapter(ssId, name) {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === ssId);
  ss.children = ss.children.filter(c => c.name !== name);
  questions.forEach(q => { if (q.chapter && !TREE.flatMap(s => s.children).some(c => c.children.some(ch => ch.id === q.chapter))) q.chapter = ""; });
  persistLocal();
  closeModal();
  renderSettings();
  toast("章节已删除，相关题目归入未分类", "success");
}

function exportJSON() {
  const data = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    questions,
    reviewLogs,
    tree: TREE,
    study: { seconds: study.seconds, blurPrompt: study.blurPrompt, perDay: study.perDay },
    remindOn,
    reviewCfg: { ...reviewCfg },
    personal: {
      todos: personal.todos,
      goals: personal.goals,
      reviews: personal.reviews,
      inbox: personal.inbox,
      bookmarks: personal.bookmarks
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mistake-book-backup-${fmtDate(Date.now())}.json`;
  a.click();
  toast("JSON 已导出（含题库、个人数据与复习记录）", "success");
}

/* ---------------- 导入导出（真实实现） ---------------- */
/* 导入的题目对象字段规范化（补默认字段，防止缺 marks 等导致渲染崩溃） */
function normalizeQ(o) {
  return {
    id: o.id, type: o.type || "problem", subject: o.subject || "subj-math",
    subSubject: o.subSubject || "ss-gaoshu", chapter: o.chapter || "",
    kps: o.kps || [], tags: o.tags || [], note: o.note || "", marks: o.marks || {},
    wrongAnswer: o.wrongAnswer || "", titleTex: o.titleTex || "", solutionTex: o.solutionTex || "",
    createdAt: o.createdAt || Date.now(), urgent: !!o.urgent,
    calcWeak: !!o.calcWeak, needConsolidate: !!o.needConsolidate
  };
}

function handleImportFile(files) {
  const f = files && files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.questions)) throw new Error("缺少 questions 数组");
      window.__importData = data;
      showImportSummary(importPreview(data));
    } catch (e) {
      toast("导入文件解析失败：" + e.message, "error");
    }
  };
  reader.readAsText(f);
  $("#import-file").value = "";
}

function importPreview(data) {
  const existing = new Set(questions.map(q => norm(q.titleTex) + "|" + q.subject + "|" + q.type));
  let add = 0, upd = 0;
  data.questions.forEach(q => {
    const key = norm(q.titleTex) + "|" + q.subject + "|" + q.type;
    existing.has(key) ? upd++ : add++;
  });
  const logs = Array.isArray(data.reviewLogs) ? data.reviewLogs.length : 0;
  return { add, upd, logs, treeAdd: treeDiffCount(data.tree) };
}

function treeDiffCount(inTree) {
  if (!Array.isArray(inTree)) return 0;
  let n = 0;
  inTree.forEach(s => {
    const subj = TREE.find(x => x.id === s.id);
    if (!subj) { n++; return; }
    (s.children || []).forEach(c => {
      const ss = subj.children.find(y => y.id === c.id);
      if (!ss) { n++; return; }
      (c.children || []).forEach(ch => { if (!ss.children.includes(ch)) n++; });
    });
  });
  return n;
}

function showImportSummary(prev) {
  openModal("导入预检", `
    <div class="alert alert-info">解析完成，请确认以下导入摘要：</div>
    <div class="small" style="line-height:2;">
      将新增 <b>${prev.add}</b> 条题目（按 科目+类型+题面归一化 判定）<br />
      将更新 <b>${prev.upd}</b> 条（同题面已存在，覆盖解析/知识点/错因）<br />
      将导入 <b>${prev.logs}</b> 条复习记录（自动 ID 重映射 + 去重）<br />
      知识点树：将新增 <b>${prev.treeAdd}</b> 个节点（同名跳过）
    </div>
    <div class="divider"></div>
    <div class="small muted">默认「合并」保留现有数据；「覆盖」会清空现有数据，需输入确认文字。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="closeModal();doMergeImport()">确认合并</button>
     <button class="btn btn-danger" onclick="showOverwriteConfirm()">覆盖模式</button>`
  );
}

function mergeTree(inTree) {
  if (!Array.isArray(inTree)) return;
  inTree.forEach(s => {
    let subj = TREE.find(x => x.id === s.id);
    if (!subj) { subj = { id: s.id, name: s.name, children: [] }; TREE.push(subj); }
    (s.children || []).forEach(c => {
      let ss = subj.children.find(y => y.id === c.id);
      if (!ss) { ss = { id: c.id, name: c.name, children: [] }; subj.children.push(ss); }
      (c.children || []).forEach(ch => { if (!ss.children.includes(ch)) ss.children.push(ch); });
    });
  });
}

/* 合并导入：个人数据按 id / day 去重合并（不覆盖已有内容） */
function mergePersonal(p) {
  if (!p) return;
  const tids = new Set(personal.todos.map(t => t.id));
  (p.todos || []).forEach(t => { if (!tids.has(t.id)) { personal.todos.push(t); tids.add(t.id); } });
  const gids = new Set(personal.goals.map(g => g.id));
  (p.goals || []).forEach(g => { if (!gids.has(g.id)) { personal.goals.push(g); gids.add(g.id); } });
  const rdays = new Set(personal.reviews.map(r => r.day));
  (p.reviews || []).forEach(r => { if (!rdays.has(r.day)) { personal.reviews.push(r); rdays.add(r.day); } });
  const iids = new Set(personal.inbox.map(i => i.id));
  (p.inbox || []).forEach(i => { if (!iids.has(i.id)) { personal.inbox.push(i); iids.add(i.id); } });
  const bids = new Set(personal.bookmarks.map(b => b.id));
  (p.bookmarks || []).forEach(b => { if (!bids.has(b.id)) { personal.bookmarks.push(b); bids.add(b.id); } });
  personal.reviews.sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

function doMergeImport() {
  const data = window.__importData;
  if (!data) return;
  mergeTree(data.tree);
  mergePersonal(data.personal);
  const idMap = {};
  data.questions.forEach(q => {
    const hit = questions.find(x => x.subject === q.subject && x.type === q.type && norm(x.titleTex) === norm(q.titleTex));
    if (hit) {
      Object.assign(hit, normalizeQ(q), { id: hit.id, createdAt: hit.createdAt });
      idMap[q.id] = hit.id;
    } else {
      const newId = nextQid();
      idMap[q.id] = newId;
      questions.push(normalizeQ({ ...q, id: newId }));
    }
  });
  const seen = new Set(reviewLogs.map(l => l.qid + "|" + l.at + "|" + l.result));
  (data.reviewLogs || []).forEach(l => {
    const qid = idMap[l.qid];
    if (qid == null) return;
    const key = qid + "|" + l.at + "|" + l.result;
    if (seen.has(key)) return;
    seen.add(key);
    reviewLogs.push({ id: ++reviewSeq, qid, at: l.at, result: l.result });
  });
  window.__importData = null;
  persistLocal();
  toast("合并完成，复习记录已重映射", "success");
  go("dashboard");
}
function showOverwriteConfirm() {
  openModal("覆盖模式（危险操作）", `
    <div class="small muted">将清空现有数据并完整导入。请输入 <b>覆盖</b> 确认：</div>
    <div class="field mt-16"><input class="input" id="ov-confirm" placeholder="输入：覆盖" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="doOverwrite()">确认覆盖</button>`
  );
}
function doOverwrite() {
  if ($("#ov-confirm").value.trim() !== "覆盖") { toast("需输入「覆盖」二字", "error"); return; }
  const data = window.__importData;
  if (!data) { closeModal(); return; }
  questions = [];
  reviewLogs = [];
  if (Array.isArray(data.tree) && data.tree.length) {
    TREE.length = 0;
    data.tree.forEach(s => TREE.push(s));
  }
  data.questions.forEach(q => questions.push(normalizeQ(q)));
  (data.reviewLogs || []).forEach(l => reviewLogs.push({ id: ++reviewSeq, qid: l.qid, at: l.at, result: l.result }));
  personal.todos = Array.isArray(data.personal && data.personal.todos) ? data.personal.todos : [];
  personal.goals = Array.isArray(data.personal && data.personal.goals) ? data.personal.goals : [];
  personal.reviews = Array.isArray(data.personal && data.personal.reviews) ? data.personal.reviews : [];
  personal.inbox = Array.isArray(data.personal && data.personal.inbox) ? data.personal.inbox : [];
  personal.bookmarks = Array.isArray(data.personal && data.personal.bookmarks) ? data.personal.bookmarks : [];
  personal.reviews.sort((a, b) => String(b.day).localeCompare(String(a.day)));
  if (data.study) {
    study.seconds = data.study.seconds || 0;
    study.blurPrompt = !!data.study.blurPrompt;
    study.perDay = data.study.perDay || {};
  }
  if (typeof data.remindOn === "boolean") remindOn = data.remindOn;
  if (data.reviewCfg) reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", num: 3, ...data.reviewCfg };
  qidSeq = Math.max(100, ...questions.map(q => q.id || 0));
  window.__importData = null;
  persistLocal();
  closeModal();
  toast("已覆盖导入", "success");
  go("dashboard");
}

/* ================= 个人工作台：今日概览 / 待办 / 目标 / 总结 / 健康 / 复盘 ================= */

function dayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekStartKey() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 周一为一周开始
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeStartTs(mode) {
  if (mode === "month") return new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function renderTodayOverview() {
  const today = dayKey();
  const rv = personal.reviews.find(r => r.day === today);
  const set = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };
  if (rv) set("ov-review", "已写");
  set("ov-study", Math.floor((study.perDay[today] || 0) / 60));
}

/* 仪表盘总览：问候 / 概览卡 / 快捷入口 / 目标进度 / 今日待办 / 最近动态 */
function renderOverview() {
  const today = dayKey();
  const name = window.__currentUser || "同学";
  const g = $("#dash-greeting");
  if (g) {
    const undone = personal.todos.filter(t => !t.done).length;
    const donePct = personal.todos.length
      ? Math.round((personal.todos.length - undone) / personal.todos.length * 100) : 0;
    const tip = undone > 0
      ? `今天还有 ${undone} 条待办，先处理最要紧的那一条。`
      : personal.todos.length ? "今天的待办都完成了，可以安心复习错题 🎉" : "今天还没有安排，去收件箱里捡几条灵感想做的吧。";
    g.innerHTML = `<div class="dash-greeting">
      <div class="dash-greeting-title">${greeting()}，${esc(name)} 👋</div>
      <div class="small muted">${esc(tip)}</div>
    </div>`;
  }

  // 概览卡：今日学习 / 今日录入 / 今日复习 / 待办完成率
  const todayAdded = questions.filter(q => fmtDate(q.createdAt) === today).length;
  const todayReviewed = reviewLogs.filter(l => fmtDate(l.at) === today).length;
  const undone = personal.todos.filter(t => !t.done).length;
  const total = personal.todos.length;
  const donePct = total ? Math.round((total - undone) / total * 100) : 0;
  const ov = $("#ov-grid");
  if (ov) ov.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">今日学习</div>
      <div class="stat-value">${Math.floor((study.perDay[today] || 0) / 60)}</div>
      <div class="stat-delta">分钟（打开应用计时）</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">今日录入</div>
      <div class="stat-value">${todayAdded}</div>
      <div class="stat-delta">道错题进库</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">今日复习</div>
      <div class="stat-value">${todayReviewed}</div>
      <div class="stat-delta">次自评复习</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">待办完成率</div>
      <div class="stat-value">${donePct}%</div>
      <div class="stat-delta">${total - undone} / ${total} 条已完成</div>
    </div>`;

  // 快捷入口
  const qa = $("#dash-quick");
  if (qa) qa.innerHTML = `
    <a class="quick-action" data-goto="input"><span class="qa-icon">📸</span><div><b>识别录入</b><div class="small muted">拍照 / 粘贴错题，OCR 进库</div></div></a>
    <a class="quick-action" href="javascript:goDashSection('review')"><span class="qa-icon">🎯</span><div><b>随机复习</b><div class="small muted">抽一组错题，四档自评</div></div></a>
    <a class="quick-action" data-goto="inbox"><span class="qa-icon">📥</span><div><b>收件箱</b><div class="small muted">随手记，一键转待办 / 目标</div></div></a>
    <a class="quick-action" data-goto="calendar"><span class="qa-icon">📅</span><div><b>日历</b><div class="small muted">待办 / 目标 / 学习记录月视图</div></div></a>`;

  // 目标进度（进行中 top 3，按完成度升序）
  const activeGoals = personal.goals.filter(g => g.status !== "done").slice().sort((a, b) => goalAutoProgress(a) - goalAutoProgress(b)).slice(0, 3);
  const gb = $("#dash-goals");
  if (gb) gb.innerHTML = activeGoals.length ? activeGoals.map(gg => {
    const p = goalAutoProgress(gg);
    return `<div class="dash-goal">
      <div class="flex-between"><span class="small">${esc(gg.title)}</span><b class="small">${p}%</b></div>
      <div class="progress mt-4"><i style="width:${p}%"></i></div>
    </div>`;
  }).join("") : `<div class="small muted">还没有进行中的目标，<a href="javascript:go('goals')">去立一个</a>。</div>`;

  // 今日待办（今天到期 / 已过期优先，最多 6 条）
  const dueTodos = personal.todos
    .filter(t => !t.done && t.due && t.due <= today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.priority - a.priority))
    .slice(0, 6);
  const tb = $("#dash-todos");
  if (tb) tb.innerHTML = dueTodos.length ? dueTodos.map(t => `
    <div class="todo-row">
      <span class="todo-check" onclick="toggleTodo(${t.id})">○</span>
      <span class="todo-title">${esc(t.title)}</span>
      ${prioBadge(t.priority)}
      ${t.due === today ? `<span class="tag tag-primary">今天</span>` : t.due < today ? `<span class="tag tag-danger">过期</span>` : ""}
    </div>`).join("") : (undone ? `<div class="small muted">今天暂无到期待办（共 ${undone} 条未完成）。</div>` : `<div class="small muted">今日待办全部完成 🎉</div>`);

  // 最近动态流
  const feed = [];
  questions.slice(-5).reverse().forEach(q => feed.push({
    at: q.createdAt,
    icon: "📥",
    text: `录入错题：${esc(q.titleTex || "(无题面)").slice(0, 40)}`
  }));
  reviewLogs.slice(-5).reverse().forEach(l => {
    const q = questions.find(x => x.id === l.qid);
    const tag = { ok: "✅ 做对", half: "🟡 半对", stuck: "🟠 卡住", fail: "❌ 做错" }[l.result] || l.result;
    feed.push({ at: l.at, icon: "🔁", text: `复习${q ? "：" + esc(q.titleTex || "").slice(0, 30) : ""} ${tag}` });
  });
  personal.reviews.slice(0, 3).forEach(r => feed.push({
    at: new Date(r.day + "T23:59:59").getTime(),
    icon: "📝",
    text: `复盘 ${r.day}：${esc(r.done || "已记录").slice(0, 40)}`
  }));
  feed.sort((a, b) => b.at - a.at);
  const fb = $("#dash-feed");
  if (fb) fb.innerHTML = feed.slice(0, 8).map(f => `
    <div class="feed-row">
      <span class="feed-icon">${f.icon}</span>
      <span class="feed-text">${f.text}</span>
      <span class="small muted">${relTime(f.at)}</span>
    </div>`).join("") || `<div class="small muted">还没有动态，去录一道错题吧。</div>`;
}

/* ---------- 今日待办 ---------- */
let subIdSeq = 1;

const PRIO = [
  { v: 0, name: "无", icon: "" },
  { v: 1, name: "低", icon: "🟢" },
  { v: 2, name: "中", icon: "🟡" },
  { v: 3, name: "高", icon: "🔴" }
];

function prioName(v) {
  return (PRIO.find(p => p.v === v) || PRIO[0]).name;
}
function prioBadge(v) {
  const p = PRIO.find(x => x.v === v) || PRIO[0];
  return p.v ? `<span class="tag prio-${p.v}">${p.icon} ${p.name}</span>` : "";
}

function todoDueTag(t) {
  if (t.due === dayKey()) return `<span class="tag tag-primary">今天</span>`;
  if (t.due === dayKey(1)) return `<span class="tag">明天</span>`;
  if (t.due && t.due < dayKey()) return `<span class="tag tag-danger">${esc(t.due)} 过期</span>`;
  return t.due ? `<span class="tag">${esc(t.due)}</span>` : "";
}

/* 快速添加解析：今天/明天/后天/周X/星期X/下周一~日/MM-DD/YYYY-MM-DD + #标签 + !优先级 */
function parseQuickAdd(raw) {
  let s = String(raw || "").trim();
  const tags = [];
  let due = "";
  const WD = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }; // 周一=0
  const now = new Date();
  const cur = (now.getDay() + 6) % 7; // 周一=0…周日=6
  const addDays = n => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const nextMonday = ((7 - cur) % 7) || 7; // 距下一个周一的天数（今天周一则为 7）

  // 优先级：只有 !高/紧急/中/低 生效，其它 ! 内容原样保留
  let priority = 0;
  const pm = s.match(/!([\u4e00-\u9fa5A-Za-z]+)/);
  if (pm) {
    const pv = { 高: 3, 紧急: 3, 中: 2, 低: 1 }[pm[1]];
    if (pv) {
      priority = pv;
      s = s.replace(pm[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  // 精确日期
  const dm = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (dm) {
    due = dm[1];
    s = s.replace(dm[1], " ").replace(/\s+/g, " ").trim();
  }
  // 今天 / 明天 / 后天
  const rel = s.match(/(今天|今日|明天|明日|后天|后日)/);
  if (!due && rel) {
    const off = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 后日: 2 }[rel[1]];
    due = addDays(off);
    s = s.replace(rel[0], " ").replace(/\s+/g, " ").trim();
  }
  // 下下周X（先匹配，避免被"下周X"吞掉）
  const m2 = s.match(/下下[周星期](一|二|三|四|五|六|日|天)/);
  if (!due && m2) {
    due = addDays(nextMonday + 7 + WD[m2[1]]);
    s = s.replace(m2[0], " ").replace(/\s+/g, " ").trim();
  }
  // 下周X
  const m3 = s.match(/下[周星期](一|二|三|四|五|六|日|天)/);
  if (!due && m3) {
    due = addDays(nextMonday + WD[m3[1]]);
    s = s.replace(m3[0], " ").replace(/\s+/g, " ").trim();
  }
  // 本周X（下一个出现的周几，同一天则为下个自然周）
  const m4 = s.match(/[周星期](一|二|三|四|五|六|日|天)/);
  if (!due && m4) {
    let diff = (WD[m4[1]] - cur + 7) % 7;
    if (diff === 0) diff = 7;
    due = addDays(diff);
    s = s.replace(m4[0], " ").replace(/\s+/g, " ").trim();
  }
  // #标签
  s = s.replace(/#([\u4e00-\u9fa5A-Za-z0-9_+-]+)/g, (_, tg) => { tags.push(tg); return " "; });
  return { title: s.replace(/[！!]\s*$/, "").trim(), due, priority, tags };
}

function todoTagsHtml(t) {
  return (t.tags || []).map(x => `<span class="chip mini">#${esc(x)}</span>`).join("");
}

function subtaskInfo(t) {
  const subs = t.subtasks || [];
  if (!subs.length) return "";
  const done = subs.filter(x => x.done).length;
  return `<span class="small muted">子任务 ${done}/${subs.length}</span>`;
}

function todoRow(t, compact) {
  const remind = t.remind && t.remind === dayKey() ? `<span class="tag tag-warn">⏰ 今天提醒</span>` : "";
  const ops = compact ? `
    <span class="flex" style="margin-left:auto;gap:4px;">
      <button class="btn btn-sm" onclick="toggleTodo(${t.id})">完成</button>
      <button class="btn btn-sm" onclick="editTodo(${t.id})">编辑</button>
    </span>` : `
    <span class="flex" style="margin-left:auto;gap:4px;">
      <button class="btn btn-sm" onclick="editTodo(${t.id})">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="delTodo(${t.id})">删除</button>
    </span>`;
  return `
    <div class="todo-row${t.done ? " done" : ""}">
      <span class="todo-check" onclick="toggleTodo(${t.id})">${t.done ? "✓" : "○"}</span>
      <span class="todo-title">${esc(t.title)}</span>
      ${prioBadge(t.priority)}
      ${todoDueTag(t)}
      ${remind}
      ${todoTagsHtml(t)}
      ${subtaskInfo(t)}
      ${ops}
    </div>`;
}

function setTodoView(mode) {
  todoViewMode = mode;
  $$("#todo-view-mode .chip").forEach(c => c.classList.toggle("on", c.dataset.v === mode));
  renderTodos();
}

function renderTodos() {
  const sub = $("#todos-sub");
  const undone = personal.todos.filter(t => !t.done);
  const done = personal.todos.filter(t => t.done);
  if (sub) sub.textContent = `${undone.length} 条未完成 · ${done.length} 条已完成 · 支持 #标签 !优先级 快速解析`;
  const box = $("#todo-list");
  if (!personal.todos.length) {
    box.innerHTML = `<div class="small muted">还没有待办，试试快速添加：「周五交报告 #工作 !高」。</div>`;
    return;
  }
  if (todoViewMode === "board") {
    const today = dayKey();
    const wkEnd = dayKey(7 - ((new Date().getDay() + 6) % 7));
    const buckets = [
      { k: "today", name: "今天到期", items: undone.filter(t => t.due && t.due <= today) },
      { k: "week", name: "本周到期", items: undone.filter(t => t.due && t.due > today && t.due <= wkEnd) },
      { k: "later", name: "以后到期", items: undone.filter(t => t.due && t.due > wkEnd) },
      { k: "none", name: "无期限", items: undone.filter(t => !t.due) },
      { k: "done", name: "已完成", items: done }
    ];
    const sortBy = arr => arr.slice().sort((a, b) => b.priority - a.priority || String(a.title).localeCompare(String(b.title)));
    box.innerHTML = `<div class="todo-board">` + buckets.map(b => `
      <div class="todo-col">
        <div class="todo-col-head">${b.name} <span class="tag">${b.items.length}</span></div>
        <div class="todo-col-body">${sortBy(b.items).map(t => todoRow(t, true)).join("") || `<div class="small muted">空</div>`}</div>
      </div>`).join("") + `</div>`;
    return;
  }
  const sortUndone = undone.slice().sort((a, b) => {
    const ad = a.due || "9999-12-31", bd = b.due || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return b.priority - a.priority;
  });
  box.innerHTML =
    sortUndone.map(t => todoRow(t, false)).join("") +
    (done.length ? `<div class="small muted mt-16 mb-8">已完成</div>` + done.map(t => todoRow(t, false)).join("") : "");
}

function addTodo() {
  const input = $("#todo-input");
  const raw = input.value.trim();
  if (!raw) { toast("请输入待办内容", "error"); return; }
  const dueSel = $("#todo-due").value;
  const parsed = parseQuickAdd(raw);
  const title = parsed.title || raw;
  if (!title) { toast("请输入待办内容", "error"); return; }
  const due = parsed.due || (dueSel === "today" ? dayKey() : dueSel === "tomorrow" ? dayKey(1) : "");
  const prioSel = Number($("#todo-priority").value) || 0;
  personal.todos.unshift({
    id: nextTodoId(), title, done: false,
    due, priority: parsed.priority || prioSel,
    subtasks: [], tags: parsed.tags, note: "", remind: "",
    createdAt: Date.now()
  });
  input.value = "";
  persistLocal();
  renderTodos();
  toast("已添加待办", "success");
}

function toggleTodo(id) {
  const t = personal.todos.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  persistLocal();
  if (currentView === "todos") renderTodos();
  if (currentView === "dashboard") renderOverview();
  if (currentView === "goals") renderGoals();
}

function delTodo(id) {
  personal.todos = personal.todos.filter(x => x.id !== id);
  personal.goals.forEach(g => {
    if (g.linkedTodoIds) g.linkedTodoIds = g.linkedTodoIds.filter(x => x !== id);
  });
  persistLocal();
  renderTodos();
  toast("已删除待办");
}

function editTodo(id) {
  const t = personal.todos.find(x => x.id === id);
  if (!t) return;
  const subs = (t.subtasks || []).map(s => `
    <div class="flex todo-sub-row">
      <span class="todo-check" onclick="toggleTodoSub(${id},${s.id})">${s.done ? "✓" : "○"}</span>
      <span class="todo-title ${s.done ? "done" : ""}">${esc(s.title)}</span>
      <button class="btn btn-sm btn-danger" style="margin-left:auto;" onclick="delTodoSub(${id},${s.id})">删</button>
    </div>`).join("");
  openModal("编辑待办", `
    <div class="field"><label>内容</label><input class="input" id="et-title" value="${esc(t.title)}" /></div>
    <div class="grid grid-2">
      <div class="field"><label>截止日期</label><input class="input" id="et-due" type="date" value="${esc(t.due)}" /></div>
      <div class="field"><label>优先级</label>
        <select class="select" id="et-priority">${PRIO.map(p => `<option value="${p.v}" ${p.v === t.priority ? "selected" : ""}>${p.icon} ${p.name}</option>`).join("")}</select>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>标签（空格或逗号分隔）</label><input class="input" id="et-tags" value="${esc((t.tags || []).join(", "))}" /></div>
      <div class="field"><label>提醒日期（当天提示）</label><input class="input" id="et-remind" type="date" value="${esc(t.remind)}" /></div>
    </div>
    <div class="field"><label>备注</label><textarea class="textarea" id="et-note" rows="2">${esc(t.note || "")}</textarea></div>
    <div class="field">
      <label>子任务</label>
      <div id="et-subs">${subs || `<div class="small muted mb-8">暂无子任务</div>`}</div>
      <div class="flex mt-8" style="gap:6px;">
        <input class="input" id="et-sub-input" placeholder="新子任务…" style="flex:1;" onkeydown="if(event.key==='Enter')addTodoSub(${id})" />
        <button class="btn btn-sm" onclick="addTodoSub(${id})">添加</button>
      </div>
    </div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="saveTodoEdit(${id})">保存</button>`);
}

function addTodoSub(todoId) {
  const input = $("#et-sub-input");
  const title = input.value.trim();
  if (!title) return;
  const t = personal.todos.find(x => x.id === todoId);
  if (!t) return;
  t.subtasks = t.subtasks || [];
  t.subtasks.push({ id: subIdSeq++, title, done: false });
  input.value = "";
  editTodo(todoId);
}

function toggleTodoSub(todoId, subId) {
  const t = personal.todos.find(x => x.id === todoId);
  if (!t) return;
  const s = (t.subtasks || []).find(x => x.id === subId);
  if (!s) return;
  s.done = !s.done;
  editTodo(todoId);
}

function delTodoSub(todoId, subId) {
  const t = personal.todos.find(x => x.id === todoId);
  if (!t) return;
  t.subtasks = (t.subtasks || []).filter(x => x.id !== subId);
  editTodo(todoId);
}

function saveTodoEdit(id) {
  const t = personal.todos.find(x => x.id === id);
  if (!t) return;
  t.title = $("#et-title").value.trim() || t.title;
  t.due = $("#et-due").value || "";
  t.priority = Number($("#et-priority").value) || 0;
  t.tags = String($("#et-tags").value || "").split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
  t.remind = $("#et-remind").value || "";
  t.note = $("#et-note").value.trim();
  closeModal();
  persistLocal();
  renderTodos();
  toast("已保存待办", "success");
}

/* ---------- 目标与规划 ---------- */
const GOAL_STATUS = {
  active: { name: "进行中", icon: "▶" },
  done: { name: "已完成", icon: "✅" },
  paused: { name: "已搁置", icon: "⏸" }
};

/* 目标进度：挂了待办 → 按待办完成率；有里程碑 → 按里程碑完成率；都没有 → 手动 */
function goalAutoProgress(g) {
  if (g.linkedTodoIds && g.linkedTodoIds.length) {
    const linked = personal.todos.filter(t => g.linkedTodoIds.includes(t.id));
    if (linked.length) return Math.round(linked.filter(t => t.done).length / linked.length * 100);
  }
  if (g.milestones && g.milestones.length) {
    return Math.round(g.milestones.filter(m => m.done).length / g.milestones.length * 100);
  }
  return Math.max(0, Math.min(100, g.progress || 0));
}

function goalCard(g) {
  const left = g.targetDate ? Math.max(0, Math.ceil((new Date(g.targetDate) - Date.now()) / 86400000)) : null;
  const p = goalAutoProgress(g);
  const auto = !!(g.linkedTodoIds && g.linkedTodoIds.length) || !!(g.milestones && g.milestones.length);
  const st = GOAL_STATUS[g.status] || GOAL_STATUS.active;
  const linked = (g.linkedTodoIds || []).map(id => personal.todos.find(t => t.id === id)).filter(Boolean);
  const ms = (g.milestones || []).slice(0, 4);
  const manualBtns = auto ? "" : `
      <button class="btn btn-sm" onclick="goalProgress(${g.id}, -10)">−10%</button>
      <button class="btn btn-sm" onclick="goalProgress(${g.id}, 10)">+10%</button>`;
  return `
  <div class="card">
    <div class="flex-between">
      <div class="card-title">${esc(g.title)}</div>
      <span class="flex" style="gap:4px;"><span class="tag">${esc(g.category)}</span><span class="tag ${g.status === "done" ? "tag-success" : g.status === "paused" ? "" : "tag-primary"}">${st.icon} ${st.name}</span></span>
    </div>
    <div class="flex mt-8" style="gap:8px;align-items:center;">
      <span class="small muted">进度</span>
      <div class="progress" style="flex:1;"><i style="width:${p}%"></i></div>
      <b class="small">${p}%</b>
    </div>
    ${auto ? `<div class="small muted mt-4">${g.linkedTodoIds && g.linkedTodoIds.length ? "由关联待办自动计算" : "由里程碑自动计算"}</div>` : ""}
    ${ms.length ? `<div class="goal-ms mt-8">${ms.map(m => `
      <div class="goal-ms-item ${m.done ? "on" : ""}" onclick="toggleGoalMilestone(${g.id},${m.id})">
        <span class="goal-ms-check">${m.done ? "✓" : "○"}</span><span>${esc(m.title)}</span>
      </div>`).join("")}</div>` : ""}
    ${linked.length ? `<div class="flex mt-8" style="flex-wrap:wrap;gap:4px;">${linked.map(t => `<span class="chip mini ${t.done ? "chip-ok" : ""}">${t.done ? "✓ " : "○ "}${esc(t.title).slice(0, 14)}</span>`).join("")}</div>` : ""}
    ${g.milestone ? `<div class="small mt-8"><span class="muted">下一里程碑：</span>${esc(g.milestone)}</div>` : ""}
    ${left != null ? `<div class="small mt-8"><span class="muted">目标日期：</span>${esc(g.targetDate)} · 还剩 <b>${left}</b> 天</div>` : ""}
    <div class="flex mt-16" style="flex-wrap:wrap;">
      ${manualBtns}
      ${g.status !== "done" ? `<button class="btn btn-sm btn-success" onclick="markGoalDone(${g.id})">完成</button>` : `<button class="btn btn-sm" onclick="markGoalDone(${g.id})">恢复进行中</button>`}
      <button class="btn btn-sm" onclick="editGoal(${g.id})">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="delGoal(${g.id})">删除</button>
    </div>
  </div>`;
}

function setGoalFilter(v) {
  goalFilter = v;
  $$("#goal-filter .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  renderGoals();
}

function renderGoals() {
  const box = $("#goal-list");
  if (!personal.goals.length) {
    box.innerHTML = `<div class="card"><div class="small muted">还没有目标，先立一个吧，比如「考研初试」「毕业论文初稿」。</div></div>`;
    return;
  }
  const list = goalFilter === "all" ? personal.goals : personal.goals.filter(g => g.status === goalFilter);
  box.innerHTML = list.length ? list.map(goalCard).join("") : `<div class="card"><div class="small muted">该分组暂无目标。</div></div>`;
}

function addGoal() {
  const title = $("#goal-input").value.trim();
  if (!title) { toast("请输入目标名称", "error"); return; }
  personal.goals.push({
    id: nextTodoId(), title, category: $("#goal-cat").value, progress: 0,
    milestone: "", targetDate: $("#goal-date").value || "", status: "active",
    linkedTodoIds: [], milestones: [], note: "", createdAt: Date.now()
  });
  $("#goal-input").value = "";
  $("#goal-date").value = "";
  persistLocal();
  renderGoals();
  toast("已添加目标", "success");
}

function goalProgress(id, delta) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  if ((g.linkedTodoIds && g.linkedTodoIds.length) || (g.milestones && g.milestones.length)) {
    toast("该目标进度由待办/里程碑自动计算，无需手动调整", "error");
    return;
  }
  g.progress = Math.max(0, Math.min(100, g.progress + delta));
  persistLocal();
  renderGoals();
}

function markGoalDone(id) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  g.status = g.status === "done" ? "active" : "done";
  persistLocal();
  renderGoals();
  toast(g.status === "done" ? "目标已完成 🎉" : "已恢复进行中");
}

function toggleGoalMilestone(goalId, msId) {
  const g = personal.goals.find(x => x.id === goalId);
  if (!g) return;
  const m = (g.milestones || []).find(x => x.id === msId);
  if (!m) return;
  m.done = !m.done;
  persistLocal();
  renderGoals();
}

function addGoalMilestone(goalId) {
  const input = $("#eg-ms-input");
  const title = input.value.trim();
  if (!title) return;
  const g = personal.goals.find(x => x.id === goalId);
  if (!g) return;
  g.milestones = g.milestones || [];
  g.milestones.push({ id: subIdSeq++, title, done: false });
  input.value = "";
  editGoal(goalId);
}

function delGoalMilestone(goalId, msId) {
  const g = personal.goals.find(x => x.id === goalId);
  if (!g) return;
  g.milestones = (g.milestones || []).filter(x => x.id !== msId);
  editGoal(goalId);
}

function toggleGoalTodoLink(goalId, todoId) {
  const g = personal.goals.find(x => x.id === goalId);
  if (!g) return;
  g.linkedTodoIds = g.linkedTodoIds || [];
  g.linkedTodoIds = g.linkedTodoIds.includes(todoId)
    ? g.linkedTodoIds.filter(x => x !== todoId)
    : [...g.linkedTodoIds, todoId];
  editGoal(goalId);
}

function editGoal(id) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  const cats = ["学习", "科研", "生活"];
  const todoOptions = personal.todos.map(t => `
    <label class="flex goal-link-opt" style="gap:6px;cursor:pointer;">
      <input type="checkbox" ${(g.linkedTodoIds || []).includes(t.id) ? "checked" : ""} onchange="toggleGoalTodoLink(${id},${t.id})" />
      <span>${esc(t.title).slice(0, 24)}</span>
      ${t.done ? `<span class="tag tag-success">已办</span>` : ""}
    </label>`).join("");
  const ms = (g.milestones || []).map(m => `
    <div class="flex todo-sub-row">
      <span class="todo-check" onclick="toggleGoalMsModal(${id},${m.id})">${m.done ? "✓" : "○"}</span>
      <span class="todo-title ${m.done ? "done" : ""}">${esc(m.title)}</span>
      <button class="btn btn-sm btn-danger" style="margin-left:auto;" onclick="delGoalMilestone(${id},${m.id})">删</button>
    </div>`).join("");
  openModal("编辑目标", `
    <div class="field"><label>目标名称</label><input class="input" id="eg-title" value="${esc(g.title)}" /></div>
    <div class="grid grid-2">
      <div class="field"><label>分类</label><select class="select" id="eg-cat">${cats.map(c => `<option ${c === g.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>状态</label><select class="select" id="eg-status">${Object.entries(GOAL_STATUS).map(([k, v]) => `<option value="${k}" ${k === g.status ? "selected" : ""}>${v.icon} ${v.name}</option>`).join("")}</select></div>
    </div>
    ${(g.linkedTodoIds && g.linkedTodoIds.length) || (g.milestones && g.milestones.length)
      ? `<div class="small muted">进度由待办 / 里程碑自动计算</div>`
      : `<div class="field"><label>进度 %（手动）</label><input class="input" id="eg-progress" type="number" min="0" max="100" value="${g.progress}" /></div>`}
    <div class="field"><label>下一里程碑</label><input class="input" id="eg-milestone" value="${esc(g.milestone)}" placeholder="如：完成变量关系图与第一版假设" /></div>
    <div class="field"><label>目标日期（可选，用于倒数日）</label><input class="input" id="eg-date" type="date" value="${g.targetDate}" /></div>`,
    `<div class="field">
      <label>里程碑清单（点勾选自动推进度）</label>
      <div id="eg-ms">${ms || `<div class="small muted mb-8">暂无里程碑</div>`}</div>
      <div class="flex mt-8" style="gap:6px;">
        <input class="input" id="eg-ms-input" placeholder="新里程碑…" style="flex:1;" onkeydown="if(event.key==='Enter')addGoalMilestone(${id})" />
        <button class="btn btn-sm" onclick="addGoalMilestone(${id})">添加</button>
      </div>
    </div>
    <div class="field">
      <label>关联待办（勾选后按完成率自动计算进度）</label>
      <div class="goal-link-list">${todoOptions || `<div class="small muted">还没有待办，先去今日待办添加。</div>`}</div>
    </div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="saveGoalEdit(${id})">保存</button>`);
}

function toggleGoalMsModal(goalId, msId) {
  toggleGoalMilestone(goalId, msId);
}

function saveGoalEdit(id) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  g.title = $("#eg-title").value.trim() || g.title;
  g.category = $("#eg-cat").value;
  g.status = $("#eg-status").value || "active";
  if (!$("#eg-progress")) {
    g.progress = goalAutoProgress(g);
  } else {
    g.progress = Math.max(0, Math.min(100, Number($("#eg-progress").value) || 0));
  }
  g.milestone = $("#eg-milestone").value.trim();
  g.targetDate = $("#eg-date").value || "";
  closeModal();
  persistLocal();
  renderGoals();
  toast("已保存目标", "success");
}

function delGoal(id) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  openModal("删除目标", `<div class="small muted">确定删除「${esc(g.title)}」？此操作不可恢复。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelGoal(${id})">删除</button>`);
}

function doDelGoal(id) {
  personal.goals = personal.goals.filter(x => x.id !== id);
  persistLocal();
  renderGoals();
  toast("已删除目标");
}

/* ---------- 周月总结 ---------- */
function setSummaryRange(r) {
  summaryRange = r;
  $$("#summary-range .chip").forEach(c => c.classList.toggle("on", c.dataset.v === r));
  renderSummary();
}

function summaryData(mode) {
  const start = rangeStartTs(mode);
  const startKey = fmtDate(start);
  const inR = ts => ts >= start;
  const added = questions.filter(q => inR(q.createdAt)).length;
  const reviewed = reviewLogs.filter(l => inR(l.at)).length;
  const studySec = Object.entries(study.perDay)
    .filter(([day]) => day >= startKey)
    .reduce((s, [, v]) => s + v, 0);
  const todos = personal.todos.filter(t => inR(t.createdAt));
  const doneTodos = todos.filter(t => t.done).length;
  const rvCount = personal.reviews.filter(r => r.day >= startKey).length;
  const inboxCount = personal.inbox.filter(i => i.status === "open" && inR(i.createdAt)).length;
  return { startKey, added, reviewed, studySec, todoTotal: todos.length, todoDone: doneTodos, rvCount, inboxCount };
}

function renderSummary() {
  const d = summaryData(summaryRange);
  const sub = $("#summary-sub");
  if (sub) sub.textContent = `${summaryRange === "week" ? "本周" : "本月"}（自 ${d.startKey} 起）学习与生活汇总`;
  const cards = $("#summary-cards");
  if (cards) cards.innerHTML = `
    <div class="stat-card"><div class="stat-label">录入题数</div><div class="stat-value">${d.added}</div><div class="stat-delta">新增错题</div></div>
    <div class="stat-card"><div class="stat-label">复习次数</div><div class="stat-value">${d.reviewed}</div><div class="stat-delta">${questions.length ? "人均 " + (d.reviewed / questions.length).toFixed(1) + " 次/题" : "暂无题库"}</div></div>
    <div class="stat-card"><div class="stat-label">学习时长</div><div class="stat-value">${Math.floor(d.studySec / 60)}</div><div class="stat-delta">分钟</div></div>
    <div class="stat-card"><div class="stat-label">待办完成</div><div class="stat-value">${d.todoDone}/${d.todoTotal}</div><div class="stat-delta">${d.todoTotal ? Math.round(d.todoDone / d.todoTotal * 100) + "%" : "暂无待办"}</div></div>`;
  renderMoodTrend();
  const sr = $("#summary-review");
  if (sr) sr.innerHTML = `
    <div class="small">复盘 <b>${d.rvCount}</b> 天</div>
    <div class="small muted mt-8">${personal.reviews.length ? "坚持复盘，进步可见" : "还没有复盘记录"}</div>`;
}

const MOOD_SCORE = { "😀": 5, "🙂": 4, "😐": 3, "😣": 2, "😫": 1 };

function renderMoodTrend() {
  const box = $("#summary-health");
  if (!box) return;
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(-i));
  const data = days.map(day => {
    const rv = personal.reviews.find(r => r.day === day);
    return rv && MOOD_SCORE[rv.mood] ? MOOD_SCORE[rv.mood] : null;
  });
  const labels = days.map(d => d.slice(5));
  if (!data.some(v => v != null)) {
    box.innerHTML = `<div class="small muted">最近 14 天还没有心情记录，去「今日复盘」记一笔。</div>`;
    return;
  }
  box.innerHTML = `<div id="mood-chart" style="height:220px;"></div>`;
  const el = $("#mood-chart");
  if (!el || typeof echarts === "undefined") return;
  const chart = echarts.init(el);
  chart.setOption({
    grid: { left: 34, right: 14, top: 18, bottom: 26 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: labels, axisLabel: { fontSize: 11, color: "#9B9A97" }, axisLine: { lineStyle: { color: "#E9E9E7" } } },
    yAxis: { type: "value", min: 1, max: 5, interval: 1, axisLabel: { fontSize: 11, color: "#9B9A97" } },
    series: [{
      type: "line", data, smooth: true, connectNulls: false,
      symbolSize: 7, lineStyle: { color: "#2383E2", width: 2 },
      itemStyle: { color: "#2383E2" },
      areaStyle: { color: "rgba(35,131,226,.10)" },
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#D3D1CB", type: "dashed" }, data: [{ yAxis: 3 }] }
    }]
  });
}

/* ---------- 今日复盘 ---------- */
function todayStats() {
  const today = dayKey();
  const todos = personal.todos;
  return {
    studySec: study.perDay[today] || 0,
    added: questions.filter(q => fmtDate(q.createdAt) === today).length,
    reviewed: reviewLogs.filter(l => fmtDate(l.at) === today).length,
    todoDone: todos.filter(t => t.done).length,
    todoTotal: todos.length
  };
}

function renderDaily() {
  const today = dayKey();
  const sub = $("#daily-sub");
  const rv = personal.reviews.find(x => x.day === today);
  if (sub) sub.textContent = today + (rv ? " · 今天已复盘 ✓" : " · 还没写，留 10 分钟给自己");
  const st = $("#rv-stats");
  if (st) {
    const d = todayStats();
    st.innerHTML = `<span class="tag">今日学习 ${Math.floor(d.studySec / 60)} 分钟</span>
      <span class="tag">录入 ${d.added} 题</span>
      <span class="tag">复习 ${d.reviewed} 次</span>
      <span class="tag">待办 ${d.todoDone}/${d.todoTotal}</span>
      <span class="small muted">保存复盘时自动附带以上数据</span>`;
  }
  $("#rv-done").value = rv ? rv.done : "";
  $("#rv-stuck").value = rv ? rv.stuck : "";
  $("#rv-plan").value = rv ? rv.plan : "";
  dailyMood = rv ? rv.mood : "";
  $$("#rv-mood .chip").forEach(c => c.classList.toggle("on", c.dataset.v === dailyMood));
  renderWeekReview();
  const hist = $("#rv-history");
  hist.innerHTML = personal.reviews.slice(0, 7).map(r => `
    <div class="review-item">
      <div class="flex-between"><b class="small">${r.day}</b>
        <span class="small">${r.mood || ""}${r.stats && r.stats.studySec ? ` · 学 ${Math.floor(r.stats.studySec / 60)}min · 录 ${r.stats.added || 0} · 复 ${r.stats.reviewed || 0}` : ""}</span>
      </div>
      ${r.done ? `<div class="small mt-8"><span class="muted">完成：</span>${esc(r.done)}</div>` : ""}
      ${r.stuck ? `<div class="small mt-4"><span class="muted">卡住：</span>${esc(r.stuck)}</div>` : ""}
      ${r.plan ? `<div class="small mt-4"><span class="muted">计划：</span>${esc(r.plan)}</div>` : ""}
    </div>`).join("") || `<div class="small muted">还没有复盘记录</div>`;
}

function renderWeekReview() {
  const box = $("#rv-week");
  if (!box) return;
  const wkStart = weekStartKey();
  const week = personal.reviews.filter(r => r.day >= wkStart);
  if (!week.length) {
    box.innerHTML = `<div class="small muted">本周还没有复盘记录，写完今天的第一篇。</div>`;
    return;
  }
  const moods = week.map(r => MOOD_SCORE[r.mood]).filter(v => v);
  const avgMood = moods.length ? (moods.reduce((s, v) => s + v, 0) / moods.length).toFixed(1) : "—";
  const studyMin = Math.floor(week.reduce((s, r) => s + ((r.stats && r.stats.studySec) || 0), 0) / 60);
  const added = week.reduce((s, r) => s + ((r.stats && r.stats.added) || 0), 0);
  const reviewed = week.reduce((s, r) => s + ((r.stats && r.stats.reviewed) || 0), 0);
  const stuckTop = {};
  week.forEach(r => {
    const t = (r.stuck || "").trim();
    if (t) stuckTop[t.slice(0, 18)] = (stuckTop[t.slice(0, 18)] || 0) + 1;
  });
  const topStuck = Object.entries(stuckTop).sort((a, b) => b[1] - a[1]).slice(0, 3);
  box.innerHTML = `
    <div class="grid grid-4">
      <div class="stat-card" style="border:none;box-shadow:none;padding:8px 0;"><div class="stat-label">复盘天数</div><div class="stat-value" style="font-size:20px;">${week.length}</div></div>
      <div class="stat-card" style="border:none;box-shadow:none;padding:8px 0;"><div class="stat-label">平均心情</div><div class="stat-value" style="font-size:20px;">${avgMood}</div><div class="stat-delta">满分 5</div></div>
      <div class="stat-card" style="border:none;box-shadow:none;padding:8px 0;"><div class="stat-label">学习 / 录入 / 复习</div><div class="stat-value" style="font-size:20px;">${studyMin}min</div><div class="stat-delta">录 ${added} · 复 ${reviewed}</div></div>
      <div class="stat-card" style="border:none;box-shadow:none;padding:8px 0;"><div class="stat-label">高频卡点</div><div class="stat-value" style="font-size:20px;">${topStuck.length ? topStuck[0][1] + " 次" : "无"}</div><div class="stat-delta">${topStuck.length ? esc(topStuck[0][0]) : "继续保持"}</div></div>
    </div>`;
}

function pickMood(el) {
  dailyMood = el.dataset.v;
  $$("#rv-mood .chip").forEach(c => c.classList.remove("on"));
  el.classList.add("on");
}

function saveDailyReview() {
  const today = dayKey();
  const done = $("#rv-done").value.trim();
  const stuck = $("#rv-stuck").value.trim();
  const plan = $("#rv-plan").value.trim();
  let rv = personal.reviews.find(x => x.day === today);
  if (!rv) {
    rv = { day: today, done: "", stuck: "", plan: "", mood: "", stats: {}, updatedAt: 0 };
    personal.reviews.unshift(rv);
  }
  rv.done = done;
  rv.stuck = stuck;
  rv.plan = plan;
  rv.mood = dailyMood;
  rv.stats = todayStats();
  rv.updatedAt = Date.now();
  persistLocal();
  renderDaily();
  toast("今日复盘已保存", "success");
}

/* ---------------- 收件箱 ---------------- */
let inboxFilter = "open";

function setInboxFilter(v) {
  inboxFilter = v;
  $$("#inbox-filter .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  renderInbox();
}

function renderInbox() {
  const sub = $("#inbox-sub");
  const open = personal.inbox.filter(i => i.status === "open").length;
  if (sub) sub.textContent = `${open} 条待处理 · 随手记，稍后一键转待办 / 目标 / 复盘`;
  const list = $("#inbox-list");
  const items = personal.inbox.filter(i => inboxFilter === "all" ? true : i.status === inboxFilter);
  if (!personal.inbox.length) {
    list.innerHTML = `<div class="small muted">收件箱还空着。想到什么就记下来：比如「周三前给导师发初稿」「整理概率论错题」。</div>`;
    return;
  }
  list.innerHTML = items.map(it => `
    <div class="inbox-item">
      <div class="flex" style="gap:8px;align-items:flex-start;">
        <span class="inbox-dot ${it.status}"></span>
        <div style="flex:1;">
          <div class="todo-title ${it.status === "done" ? "done" : ""}">${esc(it.text)}</div>
          <div class="flex mt-4" style="gap:4px;flex-wrap:wrap;">
            ${(it.tags || []).map(x => `<span class="chip mini">#${esc(x)}</span>`).join("")}
            <span class="small muted">${fmtDate(it.createdAt)}</span>
          </div>
        </div>
      </div>
      ${it.status === "open" ? `
      <div class="flex mt-8" style="gap:4px;flex-wrap:wrap;">
        <button class="btn btn-sm" onclick="inboxToTodo(${it.id})">→ 转待办</button>
        <button class="btn btn-sm" onclick="inboxToGoal(${it.id})">→ 转目标</button>
        <button class="btn btn-sm" onclick="inboxToReview(${it.id})">→ 转复盘</button>
        <button class="btn btn-sm" onclick="archiveInboxItem(${it.id})">归档</button>
        <button class="btn btn-sm btn-danger" onclick="delInboxItem(${it.id})">删除</button>
      </div>` : `
      <div class="flex mt-8" style="gap:4px;">
        ${it.status === "done" ? `<span class="tag tag-success">已转出</span>` : `<span class="tag">已归档</span>`}
        <button class="btn btn-sm" onclick="reopenInboxItem(${it.id})">恢复</button>
        <button class="btn btn-sm btn-danger" onclick="delInboxItem(${it.id})">删除</button>
      </div>`}
    </div>`).join("") || `<div class="small muted">该分组暂无内容。</div>`;
}

function addInboxItem() {
  const input = $("#inbox-input");
  const text = input.value.trim();
  if (!text) { toast("先写点什么再收进来", "error"); return; }
  const tags = [];
  const clean = text.replace(/#([\u4e00-\u9fa5A-Za-z0-9_+-]+)/g, (_, tg) => { tags.push(tg); return " "; })
    .replace(/\s+/g, " ").trim();
  personal.inbox.unshift({
    id: nextTodoId(), text: clean || text,
    tags, status: "open", createdAt: Date.now()
  });
  input.value = "";
  persistLocal();
  renderInbox();
  toast("已收入收件箱", "success");
}

function markInboxDone(id, label) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "done";
  persistLocal();
  renderInbox();
  toast(`已转${label}并归档`, "success");
}

function inboxToTodo(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  openModal("转成待办", `
    <div class="field"><label>待办内容</label><input class="input" id="it-title" value="${esc(it.text)}" /></div>
    <div class="grid grid-2">
      <div class="field"><label>截止</label>
        <select class="select" id="it-due">
          <option value="">无期限</option>
          <option value="today">今天</option>
          <option value="tomorrow">明天</option>
        </select>
      </div>
      <div class="field"><label>优先级</label>
        <select class="select" id="it-priority">${PRIO.map(p => `<option value="${p.v}">${p.icon} ${p.name}</option>`).join("")}</select>
      </div>
    </div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doInboxToTodo(${id})">确认</button>`);
}

function doInboxToTodo(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  const due = $("#it-due").value;
  personal.todos.unshift({
    id: nextTodoId(), title: $("#it-title").value.trim() || it.text, done: false,
    due: due === "today" ? dayKey() : due === "tomorrow" ? dayKey(1) : "",
    priority: Number($("#it-priority").value) || 0,
    subtasks: [], tags: it.tags || [], note: "", remind: "", createdAt: Date.now()
  });
  closeModal();
  markInboxDone(id, "待办");
}

function inboxToGoal(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  openModal("转成目标", `
    <div class="field"><label>目标名称</label><input class="input" id="ig-title" value="${esc(it.text)}" /></div>
    <div class="field"><label>分类</label>
      <select class="select" id="ig-cat"><option>学习</option><option>科研</option><option>生活</option></select>
    </div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doInboxToGoal(${id})">确认</button>`);
}

function doInboxToGoal(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  personal.goals.push({
    id: nextTodoId(), title: $("#ig-title").value.trim() || it.text,
    category: $("#ig-cat").value, progress: 0, milestone: "", targetDate: "",
    status: "active", linkedTodoIds: [], milestones: [], note: "", createdAt: Date.now()
  });
  closeModal();
  markInboxDone(id, "目标");
}

function inboxToReview(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  const today = dayKey();
  let rv = personal.reviews.find(x => x.day === today);
  if (!rv) {
    rv = { day: today, done: "", stuck: "", plan: "", mood: "", stats: {}, updatedAt: 0 };
    personal.reviews.unshift(rv);
  }
  rv.done = rv.done ? rv.done + "\n" + it.text : it.text;
  markInboxDone(id, "复盘");
}

function archiveInboxItem(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "archived";
  persistLocal();
  renderInbox();
  toast("已归档");
}

function reopenInboxItem(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "open";
  persistLocal();
  renderInbox();
}

function delInboxItem(id) {
  personal.inbox = personal.inbox.filter(x => x.id !== id);
  persistLocal();
  renderInbox();
  toast("已删除");
}

/* ---------------- 日历视图 ---------------- */
let calCursor = { y: new Date().getFullYear(), m: new Date().getMonth() };
let calPickDay = dayKey();

function calShift(delta) {
  const d = new Date(calCursor.y, calCursor.m + delta, 1);
  calCursor = { y: d.getFullYear(), m: d.getMonth() };
  renderCalendar();
}

function calToday() {
  const now = new Date();
  calCursor = { y: now.getFullYear(), m: now.getMonth() };
  calPickDay = dayKey();
  renderCalendar();
}

function calPick(dateStr) {
  calPickDay = dateStr;
  renderCalendar();
}

function calDayInfo(dateStr) {
  const todos = personal.todos.filter(t => t.due === dateStr);
  const goals = personal.goals.filter(g => g.targetDate === dateStr);
  const rv = personal.reviews.find(r => r.day === dateStr);
  const studyMin = Math.floor((study.perDay[dateStr] || 0) / 60);
  return { todos, goals, rv, studyMin };
}

function renderCalendar() {
  const sub = $("#calendar-sub");
  if (sub) sub.textContent = "待办截止 · 目标日期 · 复盘与学习记录，点日期看详情";
  const head = $("#cal-head");
  if (head) head.innerHTML = `
    <button class="btn btn-sm" onclick="calShift(-1)">‹ 上月</button>
    <b>${calCursor.y} 年 ${calCursor.m + 1} 月</b>
    <button class="btn btn-sm" onclick="calShift(1)">下月 ›</button>
    <button class="btn btn-sm" onclick="calToday()">今天</button>`;
  const today = dayKey();
  const first = new Date(calCursor.y, calCursor.m, 1);
  const startCol = (first.getDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(calCursor.y, calCursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startCol; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calCursor.y}-${String(calCursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const info = calDayInfo(ds);
    const badges = [];
    if (info.todos.length) badges.push(`<span class="cal-badge todo" title="${info.todos.length} 条待办">${info.todos.length}</span>`);
    if (info.goals.length) badges.push(`<span class="cal-badge goal">${info.goals.length}</span>`);
    if (info.rv) badges.push(`<span class="cal-badge rv">✓</span>`);
    const sel = ds === calPickDay ? " sel" : "";
    const isToday = ds === today ? " today" : "";
    cells.push(`<div class="cal-cell${sel}${isToday}" onclick="calPick('${ds}')">
      <div class="cal-num">${d}</div>
      ${badges.length ? `<div class="cal-badges">${badges.join("")}</div>` : ""}
      ${info.studyMin ? `<div class="cal-study">${info.studyMin}m</div>` : ""}
    </div>`);
  }
  const grid = $("#cal-grid");
  if (grid) grid.innerHTML = cells.join("");

  const info = calDayInfo(calPickDay);
  const detail = $("#cal-detail");
  if (detail) detail.innerHTML = `
    <div class="card-head"><div class="card-title">📅 ${calPickDay}</div><span class="tag">${calPickDay === today ? "今天" : ""}</span></div>
    <div class="small muted mt-8">学习 ${info.studyMin} 分钟</div>
    ${info.todos.length ? `<div class="small mt-8"><b>待办（${info.todos.length}）</b></div>` + info.todos.map(t => `
      <div class="todo-row"><span class="todo-check" onclick="toggleTodo(${t.id})">${t.done ? "✓" : "○"}</span>
      <span class="todo-title">${esc(t.title)}</span>${prioBadge(t.priority)}</div>`).join("") : `<div class="small muted mt-8">当天没有到期待办</div>`}
    ${info.goals.length ? `<div class="small mt-8"><b>目标节点（${info.goals.length}）</b></div>` + info.goals.map(g => `<div class="small mt-4">🎯 ${esc(g.title)}</div>`).join("") : ""}
    ${info.rv ? `<div class="review-item mt-8"><div class="flex-between"><b class="small">当日复盘</b><span class="small">${info.rv.mood || ""}</span></div>${info.rv.done ? `<div class="small mt-4"><span class="muted">完成：</span>${esc(info.rv.done)}</div>` : ""}</div>` : `<div class="small muted mt-8">当天没有复盘</div>`}`;
}

/* ---------------- 相对时间 ---------------- */
function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return min + " 分钟前";
  const h = Math.floor(min / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 7) return d + " 天前";
  return fmtDate(ts);
}

/* ---------------- 热点资讯（AI HOT） ---------------- */
let hotTab = "today";

function setHotTab(v) {
  hotTab = v;
  $$("#hot-tabs .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  loadHot();
}

function renderHot() {
  const sub = $("#hot-sub");
  if (sub) sub.textContent = "AI 圈动态 · 数据来源：AI HOT";
  loadHot();
}

function zhTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* AI HOT 返回结构做健壮归一化（兼容多种字段名） */
function hotList(data) {
  const d = data && data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.list)) return d.list;
  if (Array.isArray(d.records)) return d.records;
  if (Array.isArray(d.topics)) return d.topics;
  if (Array.isArray(d)) return d;
  return [];
}
function hotItemTitle(it) { return it.title || it.name || it.headline || ""; }
function hotItemSummary(it) { return it.summary || it.description || it.digest || ""; }
function hotItemSource(it) {
  const s = it.source;
  return (typeof s === "string" ? s : s && (s.name || s.title)) || it.source_name || it.sourceName || "";
}
function hotItemLink(it) {
  const l = it.links;
  return (l && (l.aihot || l.original || l.url || l.story)) || it.url || it.link || "";
}
function hotItemTime(it) {
  return zhTime(it.publishedAt || it.published_at || it.discoveredAt || it.discovered_at || it.createdAt || it.latestAt || it.date);
}

const HOT_CATS = {
  industry: "行业", paper: "论文", "ai-products": "AI 产品", "ai-companies": "公司",
  model: "模型", research: "研究", tips: "技巧", tools: "工具", "ai-hot": "精选"
};
function hotCatName(c) {
  return HOT_CATS[c] || c || "";
}

function hotLinkHtml(url, text, cls) {
  const body = esc(text || url || "");
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${body}</a>` : `<span class="${cls}">${body}</span>`;
}

async function loadHot() {
  const box = $("#hot-list");
  if (!box) return;
  box.innerHTML = `<div class="card"><div class="small muted">加载中…</div></div>`;
  try {
    if (hotTab === "topics") {
      renderHotTopics(await API.hotTopics());
    } else if (hotTab === "daily") {
      renderHotDaily(await API.hotDaily());
    } else {
      renderHotItems(await API.hotItems({ window: hotTab === "week" ? "7d" : "24h", limit: 30 }));
    }
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="small muted">⚠️ ${esc(e.message)}</div></div>`;
  }
}

function renderHotItems(data) {
  const list = hotList(data);
  const box = $("#hot-list");
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无内容，稍后再来看看。</div></div>`;
    return;
  }
  box.innerHTML = list.map((it, i) => {
    const title = hotItemTitle(it);
    const sum = hotItemSummary(it);
    const src = hotItemSource(it);
    const time = hotItemTime(it);
    const tag = it.category ? `<span class="chip mini">${esc(hotCatName(it.category))}</span>` : "";
    return `<div class="hot-item">
      <div class="flex-between" style="gap:10px;align-items:flex-start;">
        <div class="flex" style="gap:8px;align-items:flex-start;min-width:0;">
          <span class="hot-rank">${i + 1}</span>
          ${hotLinkHtml(hotItemLink(it), title, "hot-title")}
        </div>
        ${tag}
      </div>
      ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
      <div class="small muted mt-4">${src ? esc(src) + " · " : ""}${time}</div>
    </div>`;
  }).join("");
}

function renderHotTopics(data) {
  const list = hotList(data);
  const box = $("#hot-list");
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无最热话题，稍后再来看看。</div></div>`;
    return;
  }
  box.innerHTML = list.map((it, i) => {
    const title = hotItemTitle(it);
    const sum = hotItemSummary(it);
    const src = hotItemSource(it);
    const time = hotItemTime(it);
    return `<div class="hot-item">
      <div class="flex" style="gap:8px;align-items:flex-start;">
        <span class="hot-rank hot">${i + 1}</span>
        ${hotLinkHtml(hotItemLink(it), title, "hot-title")}
      </div>
      ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
      ${src || time ? `<div class="small muted mt-4">${src ? esc(src) + " · " : ""}${time}</div>` : ""}
    </div>`;
  }).join("");
}

function renderHotDaily(data) {
  const d = (data && data.report) || (data && data.data && data.data.report) || data || {};
  const box = $("#hot-list");
  const date = d.date || d.day || "";
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const flashes = Array.isArray(d.flashes) ? d.flashes : [];
  if (!sections.length && !flashes.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无日报内容。</div></div>`;
    return;
  }
  const renderBlock = (list) => list.map((s, i) => {
    const label = s.label || s.title || s.headline || s.name || "条目 " + (i + 1);
    let body = "";
    if (typeof s.items === "string") {
      body = esc(s.items || "");
    } else if (Array.isArray(s.items)) {
      body = s.items.map(it => {
        const t = hotItemTitle(it);
        const link = hotItemLink(it);
        const sum = hotItemSummary(it);
        const src = hotItemSource(it);
        return `<div class="hot-item">
          <div class="flex" style="gap:8px;align-items:flex-start;">
            ${hotLinkHtml(link, t, "hot-title")}
          </div>
          ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
          ${src ? `<div class="small muted mt-4">${esc(src)}</div>` : ""}
        </div>`;
      }).join("");
    } else if (typeof s.items === "object" && s.items) {
      body = esc(JSON.stringify(s.items));
    }
    return `<div class="card mb-16">
      <div class="card-head"><div class="card-title">${esc(label)}</div></div>
      ${body ? `<div class="small hot-sum" style="white-space:pre-line;">${body}</div>` : `<div class="small muted">暂无内容</div>`}
    </div>`;
  }).join("");
  box.innerHTML = `
    <div class="card mb-16">
      <div class="card-head"><div class="card-title">📰 AI 日报${date ? " · " + esc(String(date).slice(0, 10)) : ""}</div></div>
      <div class="small muted">${esc(d.summary || d.digest || "AI HOT 每日精选")}</div>
    </div>
    ${renderBlock(sections)}
    ${flashes.length ? `<div class="card-head mt-16"><div class="card-title">⚡ 快讯</div></div>` + renderBlock(flashes) : ""}`;
}

/* ---------------- 收藏夹 ---------------- */
let bmFilter = "all";

function setBmFilter(v) {
  bmFilter = v;
  $$("#bm-filter .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  renderBookmarks();
}

function renderBookmarks() {
  const sub = $("#bm-sub");
  if (sub) sub.textContent = `${personal.bookmarks.length} 条收藏 · 链接 / PDF / 笔记`;
  const box = $("#bm-list");
  const list = personal.bookmarks.filter(b => bmFilter === "all" || b.kind === bmFilter);
  if (!personal.bookmarks.length) {
    box.innerHTML = `<div class="card"><div class="small muted">还没有收藏。粘贴一个链接，或上传 PDF 资料，随手存起来。</div></div>`;
    return;
  }
  box.innerHTML = list.map(b => `
    <div class="bm-item">
      <div class="flex" style="gap:12px;align-items:flex-start;">
        <span class="bm-icon">${b.kind === "pdf" ? "📄" : b.kind === "note" ? "📝" : "🔗"}</span>
        <div style="flex:1;min-width:0;">
          <div class="flex" style="gap:8px;align-items:center;flex-wrap:wrap;">
            ${hotLinkHtml(b.url, b.title, "bm-title")}
            <span class="tag">${b.kind === "pdf" ? "PDF / 文件" : b.kind === "note" ? "笔记" : "链接"}</span>
          </div>
          ${b.note ? `<div class="small mt-4 hot-sum">${esc(b.note)}</div>` : ""}
          <div class="flex mt-4" style="gap:4px;flex-wrap:wrap;">
            ${(b.tags || []).map(x => `<span class="chip mini">#${esc(x)}</span>`).join("")}
            <span class="small muted">${fmtDate(b.createdAt)}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="delBookmark(${b.id})">删除</button>
      </div>
    </div>`).join("") || `<div class="card"><div class="small muted">该分类暂无收藏。</div></div>`;
}

function addBookmark() {
  const title = $("#bm-title").value.trim();
  const url = $("#bm-url").value.trim();
  const kind = $("#bm-kind").value;
  const note = $("#bm-note").value.trim();
  if (!title) { toast("请填写标题", "error"); return; }
  if ((kind === "link" || kind === "pdf") && !url) { toast("请填写链接或先上传文件", "error"); return; }
  const tags = String($("#bm-tags").value || "").split(/[,，\s#]+/).map(x => x.trim()).filter(Boolean);
  personal.bookmarks.unshift({ id: nextTodoId(), title, kind, url, note, tags, createdAt: Date.now() });
  $("#bm-title").value = ""; $("#bm-url").value = ""; $("#bm-note").value = ""; $("#bm-tags").value = "";
  persistLocal();
  renderBookmarks();
  toast("已收藏", "success");
}

function delBookmark(id) {
  const b = personal.bookmarks.find(x => x.id === id);
  if (!b) return;
  openModal("删除收藏", `<div class="small muted">确定删除「${esc(b.title)}」？</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelBookmark(${id})">删除</button>`);
}

function doDelBookmark(id) {
  personal.bookmarks = personal.bookmarks.filter(x => x.id !== id);
  persistLocal();
  renderBookmarks();
  toast("已删除收藏");
}

function handleBmFile(files) {
  const f = files && files[0];
  if (!f) return;
  if (f.size > 15 * 1024 * 1024) { toast("文件太大（限 15MB）", "error"); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await API.uploadBookmarkFile(f.name, reader.result);
      $("#bm-url").value = r.url;
      $("#bm-title").value = $("#bm-title").value.trim() || f.name;
      toast("文件已上传，点「收藏」保存", "success");
    } catch (e) {
      toast(e.message || "上传失败", "error");
    }
  };
  reader.readAsDataURL(f);
}

/* ---------------- 试卷 PDF 导出 ---------------- */
let exportingPaper = false;

function openPaperExport() {
  openModal("📄 导出试卷（PDF）", `
    <div class="field"><label>试卷标题</label><input class="input" id="pp-title" value="错题巩固卷" /></div>
    <div class="grid grid-3">
      <div class="field"><label>科目</label><select class="select" id="pp-subject"><option value="all">全部科目</option>${TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>子科目</label><select class="select" id="pp-subsub"></select></div>
      <div class="field"><label>章节</label><select class="select" id="pp-chapter"></select></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>出题数量</label><input class="input" id="pp-num" type="number" min="1" max="50" value="12" /></div>
      <div class="field"><label>掌握度</label>
        <select class="select" id="pp-lv"><option value="all">全部未掌握</option><option value="err">仅错误轨道 🟠🔴⛔</option><option value="worst">顽固 + 重点 🔴⛔</option></select>
      </div>
    </div>
    <div class="field"><label>副标题（可选）</label><input class="input" id="pp-sub" placeholder="如：高数错题随机卷" /></div>
    <label class="flex" style="gap:8px;cursor:pointer;"><input type="checkbox" id="pp-answers" checked /> 附带「参考答案与解析」页</label>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doExportPaper()">生成并下载 PDF</button>`);
  $("#pp-subject").onchange = fillPaperSub;
  $("#pp-subsub").onchange = fillPaperChapter;
  fillPaperSub();
}

function fillPaperSub() {
  const subj = TREE.find(s => s.id === $("#pp-subject").value);
  $("#pp-subsub").innerHTML = `<option value="all">全部子科目</option>` +
    (subj ? subj.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  fillPaperChapter();
}

function fillPaperChapter() {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#pp-subsub").value);
  $("#pp-chapter").innerHTML = `<option value="">全部章节</option>` +
    (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function doExportPaper() {
  if (exportingPaper) return;
  const num = Math.max(1, Math.min(50, Number($("#pp-num").value) || 12));
  const subject = $("#pp-subject").value;
  const sub = $("#pp-subsub").value;
  const chapter = $("#pp-chapter").value;
  const lv = $("#pp-lv").value;
  const pool = questions.filter(q => {
    if (q.subject !== "subj-math" && q.subject !== "subj-eng" && q.subject !== "subj-408") return false;
    if (subject !== "all" && q.subject !== subject) return false;
    if (sub !== "all" && q.subSubject !== sub) return false;
    if (chapter && q.chapter !== chapter) return false;
    const m = displayMastery(q.id).lv.key;
    if (lv === "err" && !ERR_TRACK.includes(m)) return false;
    if (lv === "worst" && m !== "darkred" && m !== "red") return false;
    if (m === "blue") return false;
    return true;
  });
  if (!pool.length) { toast("没有符合条件的题目", "error"); return; }
  const picked = shuffleArr(pool).slice(0, Math.min(num, pool.length));
  exportingPaper = true;
  try {
    const buf = await API.exportPaper({
      title: $("#pp-title").value.trim() || "错题巩固卷",
      subtitle: $("#pp-sub").value.trim() || "",
      answers: $("#pp-answers").checked,
      questions: picked.map(q => ({ type: q.type, titleTex: q.titleTex, solutionTex: q.solutionTex }))
    });
    const blob = new Blob([buf], { type: "application/pdf" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = `试卷-${fmtDate(Date.now())}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 8000);
    closeModal();
    toast(`已生成 ${picked.length} 题试卷 PDF`, "success");
  } catch (e) {
    toast(e.message || "PDF 导出失败", "error");
  } finally {
    exportingPaper = false;
  }
}

/* ---------------- 学习时长 ---------------- */
const study = { seconds: 0, timer: null, lastBlur: 0, blurPrompt: false, perDay: {} };
function studyTick() {
  // 只在录入 / 仪表盘（含复习）页面计时，避免挂机虚增
  if (currentView !== "dashboard" && currentView !== "input") return;
  study.seconds++;
  const today = fmtDate(Date.now());
  study.perDay[today] = (study.perDay[today] || 0) + 1;
  const m = Math.floor(study.seconds / 60);
  const d = $("#stats-time"); if (d) d.textContent = m;
  if (study.seconds % 60 === 0) persistLocal(); // 每分钟落盘一次
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { study.lastBlur = Date.now(); }
  else if (study.lastBlur) {
    const away = Math.round((Date.now() - study.lastBlur) / 1000);
    study.lastBlur = 0;
    if (away > 30) {
      study.blurPrompt = true;
      openModal("学习时长", `<div class="small">你离开了 <b>${Math.round(away / 60)}</b> 分钟，是否计入学习时长？</div>`,
        `<button class="btn btn-primary" onclick="closeModal()">计入</button>
         <button class="btn" onclick="closeModal();study.seconds=Math.max(0,study.seconds-${away});">不计入</button>`);
    }
  }
});

/* ---------------- 本地持久化（Phase A：本机 localStorage） ---------------- */
function persistLocal() {
  if (!window.API) return;
  const data = {
    questions,
    reviewLogs,
    tree: TREE,
    qidSeq,
    reviewSeq,
    study: { seconds: study.seconds, blurPrompt: study.blurPrompt, perDay: study.perDay },
    remindOn,
    reviewCfg: { ...reviewCfg },
    personal: {
      todos: personal.todos,
      goals: personal.goals,
      reviews: personal.reviews,
      inbox: personal.inbox,
      bookmarks: personal.bookmarks
    }
  };
  API.saveAll(data).catch(e => {
    serverDown = true;
    console.warn("保存到本地服务失败：", e.message);
  });
}

async function loadLocal() {
  let d = null;
  try { d = await API.loadAll(); }
  catch (e) {
    serverDown = true;
    console.warn("本地服务未连接：", e.message);
    return false;
  }
  if (!d || !Array.isArray(d.questions)) return false;
  serverDown = false;
  questions = d.questions;
  reviewLogs = d.reviewLogs || [];
  if (Array.isArray(d.tree) && d.tree.length) {
    TREE.length = 0;
    d.tree.forEach(x => TREE.push(x));
  }
  qidSeq = Math.max(100, ...questions.map(q => q.id || 0));
  reviewSeq = reviewLogs.length || 0;
  if (d.study) {
    study.seconds = d.study.seconds || 0;
    study.blurPrompt = !!d.study.blurPrompt;
    study.perDay = d.study.perDay || {};
  }
  if (typeof d.remindOn === "boolean") remindOn = d.remindOn;
  if (d.reviewCfg) reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", num: 3, ...d.reviewCfg };
  if (d.personal) {
    personal.todos = Array.isArray(d.personal.todos) ? d.personal.todos : [];
    personal.goals = Array.isArray(d.personal.goals) ? d.personal.goals : [];
    personal.reviews = Array.isArray(d.personal.reviews) ? d.personal.reviews : [];
    personal.inbox = Array.isArray(d.personal.inbox) ? d.personal.inbox : [];
    personal.bookmarks = Array.isArray(d.personal.bookmarks) ? d.personal.bookmarks : [];
    personalIdSeq = Math.max(1,
      ...personal.todos.map(t => t.id || 0),
      ...personal.goals.map(g => g.id || 0),
      ...personal.inbox.map(i => i.id || 0),
      ...personal.bookmarks.map(b => b.id || 0)) + 1;
  }
  return true;
}

function resetDemoData() {
  openModal("重置演示数据", `
    <div class="small muted">将清空本地数据库中的全部数据，并恢复演示题库。此操作不可撤销，建议先「导出 JSON 备份」。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doResetDemo()">确认重置</button>`
  );
}
function doResetDemo() {
  reviewLogs = [];
  study.seconds = 0;
  study.perDay = {};
  personal.todos = [];
  personal.goals = [];
  personal.reviews = [];
  personal.inbox = [];
  personal.bookmarks = [];
  reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", num: 3 };
  seed();
  persistLocal();
  toast("已重置为演示数据", "success");
  go("dashboard");
}

/* ---------------- 初始化 ---------------- */
(async () => {
  applyTexView();
  // 登录态检查（cookie 会话）→ 登录成功后才加载数据（服务端 API 已强制鉴权）
  const user = await API.authMe().catch(() => null);
  if (user) {
    window.__currentUser = user;
    const ok = await loadLocal();
    if (!ok) { seed(); persistLocal(); }
    enterApp();
  } else {
    $("#view-app").style.display = "none";
    $("#view-login").style.display = "grid";
  }
  setInterval(studyTick, 1000);
  $$(".nav-item, .mobile-tabbar a").forEach(a => a.addEventListener("click", () => {
    if (a.dataset.view) { go(a.dataset.view); hideMobileMenu(); }
  }));
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-goto]");
    if (t) go(t.dataset.goto);
  });
  window.go = go;
  window.goDashSection = goDashSection;
  window.toggleMobileMenu = toggleMobileMenu;
  window.hideMobileMenu = hideMobileMenu;
  window.toggleLoginMode = toggleLoginMode;
window.doLogin = doLogin;
window.doLogout = doLogout;
window.goSearch = goSearch;
window.toggleFilter = toggleFilter;
window.treePick = treePick;
window.toggleTree = toggleTree;
window.toggleSel = toggleSel;
window.toggleSelectAll = toggleSelectAll;
window.toggleMark = toggleMark;
window.batchClassify = batchClassify;
window.doBatchClassify = doBatchClassify;
window.openDetail = openDetail;
window.askDelete = askDelete;
window.doDelete = doDelete;
window.saveNote = saveNote;
window.quickRate = quickRate;
window.toggleInputKp = toggleInputKp;
window.addInputFiles = addInputFiles;
window.addInputPhotos = addInputPhotos;
window.pasteInput = pasteInput;
window.handleFiles = handleFiles;
window.toggleNoSolution = toggleNoSolution;
window.removeInputImg = removeInputImg;
window.selectInputImg = selectInputImg;
window.autoPairInput = autoPairInput;
window.unpair = unpair;
window.startInputOCR = startInputOCR;
window.renderInput = renderInput;
window.inputPrev = inputPrev;
window.inputNext = inputNext;
window.toggleTexView = toggleTexView;
window.resetInput = resetInput;
window.saveCurrentQuestion = saveCurrentQuestion;
window.saveAllQuestions = saveAllQuestions;
window.commitQuestion = commitQuestion;
window.renderQuestions = renderQuestions;
window.startReview = startReview;
window.startReviewFromRec = startReviewFromRec;
window.revealAnswer = revealAnswer;
window.selfRate = selfRate;
window.jumpTo = jumpTo;
window.skipCurrent = skipCurrent;
window.reviewExit = reviewExit;
window.selectDefaultNum = selectDefaultNum;
window.toggleRemind = toggleRemind;
window.demoNotify = demoNotify;
window.addTodo = addTodo;
window.toggleTodo = toggleTodo;
window.delTodo = delTodo;
window.editTodo = editTodo;
window.saveTodoEdit = saveTodoEdit;
window.addTodoSub = addTodoSub;
window.toggleTodoSub = toggleTodoSub;
window.delTodoSub = delTodoSub;
window.setTodoView = setTodoView;
window.addGoal = addGoal;
window.goalProgress = goalProgress;
window.editGoal = editGoal;
window.saveGoalEdit = saveGoalEdit;
window.delGoal = delGoal;
window.doDelGoal = doDelGoal;
window.setGoalFilter = setGoalFilter;
window.markGoalDone = markGoalDone;
window.toggleGoalMilestone = toggleGoalMilestone;
window.addGoalMilestone = addGoalMilestone;
window.delGoalMilestone = delGoalMilestone;
window.toggleGoalTodoLink = toggleGoalTodoLink;
window.toggleGoalMsModal = toggleGoalMsModal;
window.setSummaryRange = setSummaryRange;
window.pickMood = pickMood;
window.saveDailyReview = saveDailyReview;
window.addInboxItem = addInboxItem;
window.setInboxFilter = setInboxFilter;
window.renderInbox = renderInbox;
window.inboxToTodo = inboxToTodo;
window.doInboxToTodo = doInboxToTodo;
window.inboxToGoal = inboxToGoal;
window.doInboxToGoal = doInboxToGoal;
window.inboxToReview = inboxToReview;
window.archiveInboxItem = archiveInboxItem;
window.reopenInboxItem = reopenInboxItem;
window.delInboxItem = delInboxItem;
window.renderCalendar = renderCalendar;
window.calShift = calShift;
window.calToday = calToday;
window.calPick = calPick;
window.loadHot = loadHot;
window.setHotTab = setHotTab;
window.renderBookmarks = renderBookmarks;
window.addBookmark = addBookmark;
window.delBookmark = delBookmark;
window.doDelBookmark = doDelBookmark;
window.handleBmFile = handleBmFile;
window.setBmFilter = setBmFilter;
window.openPaperExport = openPaperExport;
window.doExportPaper = doExportPaper;
window.fillPaperSub = fillPaperSub;
window.fillPaperChapter = fillPaperChapter;
window.addNode = addNode;
window.doAddNode = doAddNode;
window.delNode = delNode;
window.delChapter = delChapter;
window.doDelChapter = doDelChapter;
window.exportJSON = exportJSON;
window.handleImportFile = handleImportFile;
window.doMergeImport = doMergeImport;
window.showOverwriteConfirm = showOverwriteConfirm;
window.doOverwrite = doOverwrite;
window.resetDemoData = resetDemoData;
window.doResetDemo = doResetDemo;
window.continueResume = continueResume;
window.renderResumeButton = renderResumeButton;
window.openEditModal = openEditModal;
window.editFillSub = editFillSub;
window.editFillChapter = editFillChapter;
window.editFillKps = editFillKps;
window.toggleEditKp = toggleEditKp;
window.toggleEditTag = toggleEditTag;
window.saveEditQuestion = saveEditQuestion;
window.addSubject = addSubject;
window.doAddSubject = doAddSubject;
window.addKp = addKp;
window.doAddKp = doAddKp;
window.askDelKp = askDelKp;
window.doDelKp = doDelKp;
window.renameNode = renameNode;
window.doRenameNode = doRenameNode;
window.doDelSubject = doDelSubject;
window.doDelSubSubject = doDelSubSubject;
window.doDelChapterById = doDelChapterById;
window.switchManualInput = switchManualInput;
window.loadOcrConfig = loadOcrConfig;
window.saveOcrConfig = saveOcrConfig;
window.testOcrConnection = testOcrConnection;
window.closeModal = closeModal;
window.showReviewDone = showReviewDone;

/* 截图辅助：?auto=1 直接进入指定视图（需已登录） */
if (location.search.includes("auto=1")) {
  const v = new URLSearchParams(location.search).get("view");
  if (v && $("#view-" + v)) go(v);
}
})();
