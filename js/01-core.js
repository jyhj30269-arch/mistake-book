/* ============================================================
   个人工作台 v1.23.0 · 01-core.js（由 app.js 拆分）
   工具函数与全局常量（$ / esc / toast / 弹窗 / KaTeX 渲染 / TAGS / LV）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ============================================================
   个人工作台 · 业务逻辑 v1.16.0
   版本：v1.16.0（知识点树补全：数学 18 章 / 408 四科 25 章，
   共 46 章 90 知识点，按考研考纲与 408 大纲；仪表盘「复习」融合：
   今日任务 + 推荐预览 + 折叠抽题配置合为一张主卡，删除独立随机复习区）
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

/* 图表实例复用（避免重复 init 告警与内存泄漏） */
function initChart(el) {
  if (!el || typeof echarts === "undefined") return null;
  return echarts.getInstanceByDom(el) || echarts.init(el);
}

/* 考试倒计时：返回距 examDate 的天数（未设置返回 null；已过返回负数） */
function examDaysLeft() {
  if (!examDate) return null;
  const t = new Date(examDate + "T00:00:00").getTime();
  return Math.ceil((t - Date.now()) / 86400000);
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
const APP_VERSION = "1.23.0";

