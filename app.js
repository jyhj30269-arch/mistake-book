/* ============================================================
   考研错题本 · 业务逻辑 v1.6.0
   版本：v1.6.0（数据层切换：本地 SQLite 服务，页面不再内置测试数据）
   实现范围：单题与批量合一识别录入 / 仪表盘一体化（顶部指标+推荐+随机复习+数据统计）/
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
      katex.render(tex, node, { throwOnError: false, displayMode: node.dataset.display === "1" });
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
const APP_VERSION = "1.6.0";

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

function doLogin() {
  $("#view-login").style.display = "none";
  $("#view-app").style.display = "block";
  go("dashboard");
  setTimeout(remindCheckToday, 1200);
}
function doLogout() {
  $("#view-app").style.display = "none";
  $("#mobile-tabbar").style.display = "none";
  $("#view-login").style.display = "grid";
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
    const box = $("#input-preview");
    box.innerHTML = "";
    const tex = $("#input-title").value.trim();
    if (tex) {
      const span = document.createElement("span");
      span.className = "katex-render";
      span.setAttribute("data-tex", tex);
      span.setAttribute("data-display", "1");
      box.appendChild(span);
      renderMath(box);
    } else {
      box.textContent = "输入 LaTeX 后实时预览（无需 $ 包裹）";
    }
  };
  $("#input-title").addEventListener("input", render);
  $("#input-solution").addEventListener("input", render);
}

/* ============================================================
   统一识别录入：1 张 = 单题流程，多张 = 批量流程
   OCR 统一走 window.API（本地模拟；后端接入后契约不变）
   ============================================================ */
let inputSeq = 0;
let inputImgs = [];        // { id, kind: "q"|"s", name, dataUrl }
let inputPairs = [];       // [{ q, s }]
let inputSelQ = null;      // 点选配对：当前选中的题目图 id
let inputSkip = false;     // 跳过配对 · 逐张录入
let inputQueue = [];       // [{ qImgId, sImgId, titleTex, solutionTex, status }]
let inputCursor = 0;
let texView = "render";

/* ---------- 图片添加：拍照 / 相册 / 粘贴 ---------- */
function addInputFiles() {
  const el = $("#input-file");
  el.value = "";
  el.onchange = () => handleFiles(el.files);
  el.click();
}
function addInputPhotos() {
  const el = $("#input-cam");
  el.value = "";
  el.onchange = () => handleFiles(el.files);
  el.click();
}
async function pasteInput() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) {
        const t = it.types.find(x => x.startsWith("image/"));
        if (t) files.push(await it.getType(t));
      }
      if (files.length) { handleFiles(files); toast(`已粘贴 ${files.length} 张截图`, "success"); return; }
    }
  } catch (e) { /* 无剪贴板权限时引导用户直接 Ctrl+V */ }
  toast("请直接按 Ctrl+V 粘贴截图");
}
document.addEventListener("paste", e => {
  if (!$("#view-input") || $("#view-input").style.display === "none") return;
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) { handleFiles(files); toast(`已粘贴 ${files.length} 张截图`, "success"); }
});

function handleFiles(files) {
  const arr = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  if (!arr.length) { toast("未识别到图片文件", "error"); return; }
  let pending = arr.length;
  arr.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => {
      inputImgs.push({ id: ++inputSeq, kind: "q", name: f.name || `图片 ${inputSeq}`, dataUrl: reader.result });
      if (--pending === 0) {
        renderInput();
        toast(`已添加 ${arr.length} 张图片：${arr.length > 1 ? "自动进入批量模式，可点图片切换题目/解题并配对" : "单题模式，点击「开始识别」"}`, "success");
      }
    };
    reader.readAsDataURL(f);
  });
}

/* ---------- 图片队列：切换题目/解题、点选配对、自动配对 ---------- */
function renderInput() {
  const grid = $("#input-imgs");
  if (!grid) return;
  $("#input-mode-tag").textContent = !inputImgs.length ? "待添加图片" : inputImgs.length === 1 ? "单题模式" : "批量模式";
  $("#input-pair-actions").style.display = inputImgs.filter(x => x.kind === "q").length > 1 ? "" : "none";
  grid.innerHTML = inputImgs.length
    ? inputImgs.map(img => `
      <div class="bimg-card ${inputSelQ === img.id ? "sel" : ""}" onclick="selectInputImg(${img.id})">
        <img src="${img.dataUrl}" alt="" />
        <span class="bimg-kind ${img.kind === "s" ? "is-s" : ""}" onclick="event.stopPropagation();toggleImgKind(${img.id})">${img.kind === "q" ? "题目" : "解题"}</span>
        <span class="bimg-del" onclick="event.stopPropagation();removeInputImg(${img.id})">✕</span>
      </div>`).join("")
    : `<div class="small muted" style="padding:8px 0;">还没有图片，点上方按钮添加（可多张）</div>`;
  renderPairs();
  renderQueue();
}

function toggleImgKind(id) {
  const img = inputImgs.find(x => x.id === id);
  if (!img) return;
  img.kind = img.kind === "q" ? "s" : "q";
  inputPairs = inputPairs.filter(p => p.q !== id && p.s !== id);
  if (inputSelQ === id) inputSelQ = null;
  renderInput();
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
  const qs = inputImgs.filter(x => x.kind === "q");
  const ss = inputImgs.filter(x => x.kind === "s");
  if (!qs.length) { toast("请先添加题目图", "error"); return; }
  inputPairs = [];
  const n = Math.min(qs.length, ss.length);
  for (let i = 0; i < n; i++) inputPairs.push({ q: qs[i].id, s: ss[i].id });
  const msg = ss.length > qs.length
    ? `已按上传顺序配对 ${n} 题，多余 ${ss.length - n} 张解题图将忽略`
    : qs.length > ss.length
      ? `已按上传顺序配对 ${n} 题，${qs.length - n} 张题目图无解题过程`
      : `已按上传顺序配对 ${n} 题`;
  inputSelQ = null;
  renderInput();
  toast(msg, "success");
}
function toggleSkipPair() {
  inputSkip = !inputSkip;
  $("#input-skip-btn").classList.toggle("btn-primary", inputSkip);
  $("#batch-hint").textContent = inputSkip ? "已切换到「跳过配对 · 逐张录入」：每张题目图单独录入，解题图暂不识别" : "";
  toast(inputSkip ? "跳过配对，逐张录入" : "已恢复配对模式");
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
  if (inputSkip) {
    return qImgs.map(x => ({ qImgId: x.id, sImgId: null, titleTex: "", solutionTex: "", status: "pending" }));
  }
  const items = [];
  if (inputPairs.length) {
    const paired = new Set(inputPairs.map(p => p.q));
    inputPairs.forEach(p => items.push({ qImgId: p.q, sImgId: p.s, titleTex: "", solutionTex: "", status: "pending" }));
    qImgs.filter(x => !paired.has(x.id)).forEach(x => items.push({ qImgId: x.id, sImgId: null, titleTex: "", solutionTex: "", status: "pending" }));
  } else {
    qImgs.forEach(x => items.push({ qImgId: x.id, sImgId: null, titleTex: "", solutionTex: "", status: "pending" }));
  }
  return items;
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
}

function renderInputReview() {
  if (!inputQueue.length) {
    $("#input-img-box").innerHTML = "暂无图片<br />添加图片后此处显示原图";
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
    $("#input-img-box").innerHTML =
      `<img src="${qImg.dataUrl}" style="max-width:100%;border-radius:8px;" alt="题目原图" />` +
      (sImg ? `<div class="small muted mt-8">解题图（识别后填入解题过程）</div><img src="${sImg.dataUrl}" style="max-width:100%;border-radius:8px;margin-top:6px;" alt="解题原图" />` : "");
  }
  $("#input-title").value = cur.titleTex || "";
  $("#input-solution").value = cur.solutionTex || "";
  $("#input-title").dispatchEvent(new Event("input"));
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
      <span class="txt">题图 ${it.qImgId}${it.sImgId ? " ↔ 解图 " + it.sImgId : "（无解题图）"}</span>
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
  const pv = $("#input-preview");
  if (!pv) return;
  pv.style.display = texView === "render" ? "" : "none";
  toast(texView === "render" ? "渲染视图（KaTeX）" : "源码视图");
}

/* OCR 失败 / 不想识别时：直接手动录入 */
function switchManualInput() {
  $("#input-ocr-state").textContent = "手动输入模式";
  $("#input-ocr-status").textContent = "已切换为手动输入：直接填写题面与解题过程，无需识别。";
  $("#input-ocr-btn").disabled = false;
  $("#input-ocr-progress-wrap").style.display = "none";
  if (!inputQueue.length && inputImgs.length) {
    inputQueue = inputImgs.filter(x => x.kind === "q").map(x => ({
      qImgId: x.id, sImgId: null, titleTex: "", solutionTex: "", status: "done"
    }));
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
  $("#input-preview").textContent = "输入 LaTeX 后实时预览（无需 $ 包裹）";
  inputTags.clear();
  $$("#input-tags .chip").forEach(c => c.classList.remove("on"));
  inputImgs = [];
  inputPairs = [];
  inputQueue = [];
  inputCursor = 0;
  inputSelQ = null;
  inputSkip = false;
  $("#batch-hint").textContent = "";
  $("#input-skip-btn").classList.remove("btn-primary");
  $("#input-ocr-state").textContent = "待识别";
  $("#input-ocr-progress-wrap").style.display = "none";
  $("#input-img-box").innerHTML = "暂无图片<br />添加图片后此处显示原图";
  renderInput();
  toast("已清空，重新录入");
}

/* ---------- 保存（单题去重弹窗 / 批量不弹窗） ---------- */
function collectForm(titleTex, solutionTex) {
  const kps = $$("#input-kps .chip.on").map(c => c.dataset.k).filter(Boolean);
  return mkQ({
    type: inputType,
    subject: $("#input-subject").value,
    subSubject: $("#input-subsub").value,
    chapter: $("#input-chapter").value,
    kps,
    tags: Array.from(inputTags),
    titleTex,
    solutionTex: solutionTex !== undefined ? solutionTex : $("#input-solution").value.trim(),
    wrongAnswer: $("#input-wrong").value.trim()
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
    questions.push(collectForm(it.titleTex, it.solutionTex));
    it.status = "saved";
    n++;
  });
  if (!n) { toast("没有待保存的题目（需识别完成且已填题面）", "error"); return; }
  persistLocal();
  toast(`已批量录入 ${n} 道题；疑似重复不弹窗，题库列表角标提示`, "success");
  inputQueue = [];
  inputImgs = [];
  inputPairs = [];
  renderInput();
  go("questions");
}

function commitQuestion(id, q) {
  const item = id ? questions.find(x => x.id === id) : q;
  if (!id) {
    if (window.__pending && !questions.includes(window.__pending)) { questions.push(window.__pending); }
    else questions.push(item);
  }
  window.__pending = null;
  persistLocal();
  toast("已保存，临时图片已清理");
  if (inputQueue.length > 1) {
    const cur = inputQueue[inputCursor];
    if (cur) cur.status = "saved";
    inputCursor++;
    if (inputCursor < inputQueue.length) {
      renderInputReview();
      toast(`继续校对第 ${inputCursor + 1} / ${inputQueue.length} 题`);
    } else {
      toast("本批已全部保存", "success");
      inputQueue = [];
      inputImgs = [];
      inputPairs = [];
      renderInput();
      go("questions");
    }
    return;
  }
  resetInput();
  go("questions");
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
    if (kw) {
      const hay = (q.titleTex + " " + q.solutionTex + " " + q.kps.join(" ") + " " + TAGS.filter(t => q.tags.includes(t.key)).map(t => t.name).join(" ")).toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderTree() {
  const box = $("#q-tree");
  if (!treeMode) { box.closest("#q-tree-card").style.display = "none"; $("#q-layout").style.gridTemplateColumns = "1fr"; return; }
  box.closest("#q-tree-card").style.display = "";
  $("#q-layout").style.gridTemplateColumns = "250px 1fr";
  const countOf = sub => questions.filter(q => q.subject === sub.id || TREE.find(s => s.id === q.subject) === sub).length;
  box.innerHTML = `
    <div class="tree-node" data-sub="all" onclick="treePick(this)"><span>🗂</span>全部 <span class="count">${questions.length}</span></div>
    <div class="tree-node" data-sub="uncat" onclick="treePick(this)"><span>∅</span>未分类 <span class="count">${questions.filter(q => !q.kps.length).length}</span></div>
    ${TREE.map(s => `
      <div class="tree-node" data-sub="${s.id}" onclick="treePick(this)"><span>${s.name === "数学" ? "📐" : s.name === "英语" ? "🇬🇧" : "💻"}</span>${esc(s.name)} <span class="count">${countOf(s)}</span></div>
      <div class="tree-children">
        ${s.children.map(c => `
          <div class="tree-node" data-subsub="${c.id}" onclick="treePick(this)"><span>∟</span>${esc(c.name)} <span class="count">${questions.filter(q => q.subSubject === c.id).length}</span></div>
          <div class="tree-children" style="display:none;" data-extra="1">
            ${c.children.map(ch => `
              <div class="tree-node" data-chapter="${ch.id}" onclick="treePick(this)"><span>∟</span>${esc(ch.name)} <span class="count">${questions.filter(q => q.chapter === ch.id).length}</span></div>
            `).join("")}
          </div>`).join("")}
      </div>`).join("")}`;
  // 点击子科目展开章节（默认两级，点击展开第三级）
  $$("#q-tree [data-subsub]").forEach(n => n.addEventListener("click", e => {
    e.stopPropagation();
    const extra = n.nextElementSibling;
    if (extra && extra.dataset.extra) extra.style.display = extra.style.display === "none" ? "" : "none";
  }));
}

function treePick(el) {
  $$("#q-tree .tree-node").forEach(x => x.classList.remove("active"));
  el.classList.add("active");
  const sub = el.dataset.sub, subsub = el.dataset.subsub, chapter = el.dataset.chapter;
  window.__treeFilter = { sub, subsub, chapter };
  renderQuestions();
}

function toggleTree() {
  treeMode = !treeMode;
  $("#q-tree-btn").textContent = treeMode ? "🌲 树形视图" : "☰ 列表视图";
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
  const kpOptions = TREE.flatMap(s => s.children).flatMap(c => c.children).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  openModal(`批量归类（已选 ${sel.length} 题）`, `
    <div class="field">
      <label>一次性指定知识点</label>
      <select class="select" id="bc-kp"><option value="">未分类</option>${kpOptions}</select>
    </div>
    <div class="small muted">弥补"录入时不强制分类"：未分类列表多选 → 一键归类</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doBatchClassify()">应用</button>`
  );
}
function doBatchClassify() {
  const kp = $("#bc-kp").value;
  questions.filter(q => qSel.has(q.id)).forEach(q => { q.kps = kp ? [kp] : []; });
  qSel.clear();
  persistLocal();
  closeModal();
  toast(`已归类 ${questions.filter(q => q.kps.includes(kp)).length} 题到「${kp || "未分类"}」`, "success");
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
let reviewCfg = { sub: "all", chapter: "", lv: "all", num: 3 };
let reviewQueue = [];
let reviewIdx = 0;
let reviewDone = new Set();    // 已自评的题号（队列下标）
let reviewSkipped = new Set(); // 跳过的题号
let reviewStartedAt = 0;
let reviewResults = [];

function renderReviewConfig() {
  $("#review-sub").textContent = "分层优先 + 加权随机 · 做错加急 · 覆盖保证";
  const subOptions = TREE.flatMap(s => s.children.map(c => ({ s, c })));
  $("#rev-subject").innerHTML = `<option value="all">全部子科目</option>` +
    subOptions.map(({ s, c }) => `<option value="${c.id}">${esc(s.name)} → ${esc(c.name)}</option>`).join("");
  $("#rev-subject").value = reviewCfg.sub;
  $("#rev-subject").onchange = e => { reviewCfg.sub = e.target.value; fillRevChapter(); persistLocal(); };
  fillRevChapter();
  $("#rev-chapter").value = reviewCfg.chapter;
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
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#rev-subject").value);
  $("#rev-chapter").innerHTML = `<option value="">全部章节</option>` +
    (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
  reviewCfg.chapter = "";
}

function startReview() {
  startReviewWith(reviewCfg.num, null);
}

function startReviewWith(n, presetList) {
  // 候选筛选
  let pool = questions.filter(q => {
    if (q.subject !== "subj-math" && q.subject !== "subj-eng" && q.subject !== "subj-408") return false;
    if (reviewCfg.sub !== "all" && q.subSubject !== reviewCfg.sub) return false;
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
  toast(remindOn ? "后台推送提醒已开启（Notification API + SW）" : "提醒已关闭");
}
function demoNotify() {
  if ("Notification" in window) {
    if (Notification.permission !== "granted") Notification.requestPermission();
    if (Notification.permission === "granted") new Notification("考研错题本", { body: "今天该复习错题了，当前共有 X 道未掌握题目" });
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
  const tok = $("#ocr-token"); if (tok) tok.value = cfg.token || "";
  const base = $("#ocr-base"); if (base) base.value = cfg.base || "https://api.mineru.net";
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" && cfg.token ? "引擎：MinerU（真实）" : "引擎：模拟";
}
function saveOcrConfig() {
  const cfg = {
    engine: $("#ocr-engine").value,
    token: $("#ocr-token").value.trim(),
    base: $("#ocr-base").value.trim() || "https://api.mineru.net"
  };
  localStorage.setItem("mb-mineru-config", JSON.stringify(cfg));
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" && cfg.token ? "引擎：MinerU（真实）" : "引擎：模拟";
  toast("OCR 配置已保存");
  testOcrConnection();
}
async function testOcrConnection() {
  const cfg = API.mineruConfig();
  if (cfg.engine !== "mineru" || !cfg.token) { toast("当前为模拟模式，未测试真实识别", "error"); return; }
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
        识别来源：${r.source}<br />
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
    questions, reviewLogs, tree: TREE
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mistake-book-backup-${fmtDate(Date.now())}.json`;
  a.click();
  toast("JSON 已导出（含全部业务数据与复习记录）", "success");
}

/* ---------------- 导入导出（真实实现） ---------------- */
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

function doMergeImport() {
  const data = window.__importData;
  if (!data) return;
  mergeTree(data.tree);
  const idMap = {};
  data.questions.forEach(q => {
    const hit = questions.find(x => x.subject === q.subject && x.type === q.type && norm(x.titleTex) === norm(q.titleTex));
    if (hit) {
      Object.assign(hit, q, { id: hit.id, createdAt: hit.createdAt });
      idMap[q.id] = hit.id;
    } else {
      const newId = nextQid();
      idMap[q.id] = newId;
      questions.push({ ...q, id: newId });
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
  data.questions.forEach(q => questions.push({ ...q }));
  (data.reviewLogs || []).forEach(l => reviewLogs.push({ id: ++reviewSeq, qid: l.qid, at: l.at, result: l.result }));
  qidSeq = Math.max(100, ...questions.map(q => q.id || 0));
  window.__importData = null;
  persistLocal();
  closeModal();
  toast("已覆盖导入", "success");
  go("dashboard");
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
    reviewCfg: { ...reviewCfg }
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
  if (d.reviewCfg) reviewCfg = { sub: "all", chapter: "", lv: "all", num: 3, ...d.reviewCfg };
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
  seed();
  persistLocal();
  toast("已重置为演示数据", "success");
  go("dashboard");
}

/* ---------------- 初始化 ---------------- */
(async () => {
  const ok = await loadLocal();
  if (!ok) { seed(); persistLocal(); }
  setInterval(studyTick, 1000);
  $$(".nav-item, .mobile-tabbar a").forEach(a => a.addEventListener("click", () => { if (a.dataset.view) go(a.dataset.view); }));
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-goto]");
    if (t) go(t.dataset.goto);
  });
  window.go = go;
  window.goDashSection = goDashSection;
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
window.toggleImgKind = toggleImgKind;
window.removeInputImg = removeInputImg;
window.selectInputImg = selectInputImg;
window.autoPairInput = autoPairInput;
window.toggleSkipPair = toggleSkipPair;
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

/* 截图辅助：?auto=1 自动登录（原型演示用） */
if (location.search.includes("auto=1")) {
  if ($("#view-app").style.display === "none") doLogin();
  const v = new URLSearchParams(location.search).get("view");
  if (v && $("#view-" + v)) go(v);
}
})();
