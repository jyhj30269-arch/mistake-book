/* ============================================================
   个人工作台 v1.18.2 · 02-state.js（由 app.js 拆分）
   全局状态、知识点树、去重、增量写与整库持久化（apiCall / persistLocal / loadLocal）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

const TREE = [
  {
    id: "subj-math", name: "数学", children: [
      {
        id: "ss-gaoshu", name: "高等数学", children: [
          { id: "ch-c1", name: "第 1 章 函数、极限与连续", children: ["极限计算", "连续性讨论"] },
          { id: "ch-c2", name: "第 2 章 一元函数微分学", children: ["导数与微分", "微分中值定理", "导数应用"] },
          { id: "ch-c3", name: "第 3 章 一元函数积分学", children: ["定积分计算", "分部积分"] },
          { id: "ch-c4", name: "第 4 章 无穷级数（数一/数三）", children: ["常数项级数", "幂级数", "傅里叶级数"] },
          { id: "ch-c5", name: "第 5 章 多元函数微积分学（积分部分仅数一）", children: ["多元函数微分学", "二重积分", "三重积分与曲线曲面积分"] },
          { id: "ch-c6", name: "第 6 章 常微分方程", children: ["一阶微分方程", "二阶常系数线性方程"] }
        ]
      },
      {
        id: "ss-xdai", name: "线性代数", children: [
          { id: "ch-l1", name: "第 1 章 行列式", children: ["行列式的计算", "克拉默法则"] },
          { id: "ch-l2", name: "第 2 章 矩阵", children: ["矩阵的秩", "逆矩阵"] },
          { id: "ch-l3", name: "第 3 章 向量", children: ["向量组的线性相关性", "向量组的秩"] },
          { id: "ch-l4", name: "第 4 章 线性方程组", children: ["齐次方程组解的结构", "非齐次方程组解的判定"] },
          { id: "ch-l5", name: "第 5 章 特征值与特征向量", children: ["相似对角化"] },
          { id: "ch-l6", name: "第 6 章 二次型", children: ["二次型标准化", "正定二次型"] }
        ]
      },
      {
        id: "ss-gailv", name: "概率论与数理统计", children: [
          { id: "ch-p1", name: "第 1 章 随机事件与概率", children: ["全概率与贝叶斯公式"] },
          { id: "ch-p2", name: "第 2 章 一维随机变量及其分布", children: ["常见分布", "分布函数"] },
          { id: "ch-p3", name: "第 3 章 多维随机变量及其分布", children: ["联合分布与边缘分布", "随机变量的独立性"] },
          { id: "ch-p4", name: "第 4 章 随机变量的数字特征", children: ["期望与方差", "协方差与相关系数"] },
          { id: "ch-p5", name: "第 5 章 大数定律与中心极限定理", children: ["切比雪夫不等式", "中心极限定理"] },
          { id: "ch-p6", name: "第 6 章 数理统计", children: ["抽样分布", "参数估计"] }
        ]
      }
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
      {
        id: "ss-ds", name: "数据结构", children: [
          { id: "ch-d1", name: "第 1 章 线性表", children: ["顺序表与链表"] },
          { id: "ch-d2", name: "第 2 章 栈、队列和数组", children: ["栈与队列", "特殊矩阵的压缩存储"] },
          { id: "ch-d3", name: "第 3 章 串", children: ["模式匹配 KMP"] },
          { id: "ch-d4", name: "第 4 章 树与二叉树", children: ["二叉树遍历", "二叉排序树", "哈夫曼树"] },
          { id: "ch-d5", name: "第 5 章 图", children: ["图的遍历", "最小生成树", "最短路径", "拓扑排序"] },
          { id: "ch-d6", name: "第 6 章 查找", children: ["B 树与 B+ 树", "散列表"] },
          { id: "ch-d7", name: "第 7 章 排序", children: ["插入排序", "交换排序", "选择排序", "归并与基数排序"] }
        ]
      },
      {
        id: "ss-co", name: "计算机组成原理", children: [
          { id: "ch-co1", name: "第 1 章 计算机系统概述", children: ["冯·诺依曼结构", "性能指标"] },
          { id: "ch-co2", name: "第 2 章 数据的表示和运算", children: ["原码反码补码", "浮点数表示"] },
          { id: "ch-co3", name: "第 3 章 存储系统", children: ["Cache 与主存", "虚拟存储器"] },
          { id: "ch-co4", name: "第 4 章 指令系统", children: ["寻址方式", "指令格式"] },
          { id: "ch-co5", name: "第 5 章 中央处理器", children: ["数据通路", "指令流水线"] },
          { id: "ch-co6", name: "第 6 章 总线", children: ["总线仲裁", "总线定时"] },
          { id: "ch-co7", name: "第 7 章 输入/输出系统", children: ["中断系统", "DMA 方式"] }
        ]
      },
      {
        id: "ss-os", name: "操作系统", children: [
          { id: "ch-os1", name: "第 1 章 操作系统概述", children: ["操作系统特征与功能"] },
          { id: "ch-os2", name: "第 2 章 进程与线程", children: ["进程同步与互斥", "死锁", "处理机调度"] },
          { id: "ch-os3", name: "第 3 章 内存管理", children: ["分页与分段", "虚拟内存"] },
          { id: "ch-os4", name: "第 4 章 文件管理", children: ["文件目录", "磁盘调度"] },
          { id: "ch-os5", name: "第 5 章 输入/输出管理", children: ["IO 控制方式", "设备分配"] }
        ]
      },
      {
        id: "ss-net", name: "计算机网络", children: [
          { id: "ch-n1", name: "第 1 章 计算机网络体系结构", children: ["OSI 与 TCP/IP 模型"] },
          { id: "ch-n2", name: "第 2 章 物理层", children: ["编码与调制", "传输介质"] },
          { id: "ch-n3", name: "第 3 章 数据链路层", children: ["MAC 与以太网", "流量控制"] },
          { id: "ch-n4", name: "第 4 章 网络层", children: ["IP 地址与子网划分", "路由协议"] },
          { id: "ch-n5", name: "第 5 章 传输层", children: ["TCP 可靠传输", "UDP 与端口"] },
          { id: "ch-n6", name: "第 6 章 应用层", children: ["HTTP 协议", "DNS 系统"] }
        ]
      }
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
let reviewSets = []; // 自建复习集 { id, name, qids: [], createdAt }
let habits = [];     // 每日习惯 { id, name, doneDays: [], createdAt }
let examDate = "";   // 考试日期 YYYY-MM-DD（v1.18 考研倒计时）
let moduleOn = {};   // 外围模块开关 { hot?: bool, bookmarks?: bool }
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

/* 演示数据（questions / reviewLogs / tree）统一由服务端 seed-data.js 播种，
   前端不再内置副本；「重置演示数据」走服务端 /api/reset 重播。 */

/* ---------------- 学习时长 ---------------- */
/* 离开策略（v1.18.2，不再弹窗询问）：
   awayPolicy: "auto"（离开 ≤ awayThresholdMin 分钟自动计入，超过不计）
              | "always"（离开时间全部计入）| "never"（只计页面可见时间） */
const study = { seconds: 0, timer: null, lastBlur: 0, blurPrompt: false, perDay: {},
  awayPolicy: "auto", awayThresholdMin: 5 };
function studyTick() {
  // 只在录入 / 仪表盘（含复习）页面计时，避免挂机虚增；页面隐藏时不累计（离开时间由 awayPolicy 统一处理）
  if (currentView !== "dashboard" && currentView !== "input") return;
  if (document.hidden) return;
  study.seconds++;
  const today = fmtDate(Date.now());
  study.perDay[today] = (study.perDay[today] || 0) + 1;
  const m = Math.floor(study.seconds / 60);
  const d = $("#stats-time"); if (d) d.textContent = m;
  if (study.seconds % 60 === 0) apiCall(API.saveStudy(study.seconds, study.perDay, study.blurPrompt)); // 每分钟增量落盘一次
}

/* 按离开策略判定是否计入：返回补记的秒数（0 = 不计入） */
function applyAwayTime(awayMs) {
  const awaySec = Math.round(awayMs / 1000);
  if (awaySec <= 0) return 0;
  const policy = study.awayPolicy || "auto";
  if (policy === "never") return 0;
  if (policy === "auto" && awayMs > (study.awayThresholdMin || 5) * 60000) return 0;
  return awaySec;
}

/* 离开/回来：按策略静默处理，不再弹窗询问 */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    study.lastBlur = Date.now();
    return;
  }
  if (!study.lastBlur) return;
  const awayMs = Date.now() - study.lastBlur;
  study.lastBlur = 0;
  const add = applyAwayTime(awayMs);
  if (add > 0) {
    study.seconds += add;
    const today = fmtDate(Date.now());
    study.perDay[today] = (study.perDay[today] || 0) + add;
    apiCall(API.saveStudy(study.seconds, study.perDay, study.blurPrompt));
  }
});

/* ---------------- 增量写辅助（P1：单对象变更落库，fire-and-forget） ---------------- */
function apiCall(p) {
  if (!p || !p.catch) return;
  p.catch(e => { serverDown = true; console.warn("保存到本地服务失败：", e.message); });
  if (window.__mbBc) window.__mbBc.postMessage(window.__mbTabId); // 通知其他标签页同步
}

/* ---------------- 本地持久化（批量场景：导入 / 覆盖 / 重置后的整库快照） ---------------- */
function persistLocal() {
  if (!window.API) return;
  const data = {
    questions,
    reviewLogs,
    tree: TREE,
    qidSeq,
    reviewSeq,
    study: { seconds: study.seconds, blurPrompt: study.blurPrompt, perDay: study.perDay, awayPolicy: study.awayPolicy, awayThresholdMin: study.awayThresholdMin },
    remindOn,
    theme,
    remindDate,
    reviewResume,
    examDate,
    moduleOn,
    habits,
    reviewCfg: { ...reviewCfg },
    personal: {
      todos: personal.todos,
      goals: personal.goals,
      reviews: personal.reviews,
      inbox: personal.inbox,
      bookmarks: personal.bookmarks
    },
    reviewSets
  };
  API.saveAll(data).catch(e => {
    serverDown = true;
    console.warn("保存到本地服务失败：", e.message);
  });
  if (window.__mbBc) window.__mbBc.postMessage(window.__mbTabId);
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
    if (["auto", "always", "never"].includes(d.study.awayPolicy)) study.awayPolicy = d.study.awayPolicy;
    if (Number(d.study.awayThresholdMin) > 0) study.awayThresholdMin = Number(d.study.awayThresholdMin);
  }
  if (typeof d.remindOn === "boolean") remindOn = d.remindOn;
  if (typeof d.remindDate === "string") remindDate = d.remindDate;
  if (d.reviewResume && typeof d.reviewResume === "object") reviewResume = d.reviewResume;
  if (d.theme === "dark" || d.theme === "light") theme = d.theme;
  applyTheme();
  if (d.reviewCfg) reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", tag: "all", num: 3, ...d.reviewCfg };
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
    reviewSets = Array.isArray(d.reviewSets) ? d.reviewSets : [];
    habits = Array.isArray(d.habits) ? d.habits : [];
  }
  if (typeof d.examDate === "string") examDate = d.examDate;
  if (d.moduleOn && typeof d.moduleOn === "object") moduleOn = d.moduleOn;
  return true;
}

