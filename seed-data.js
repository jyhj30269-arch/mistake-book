/* 本地 SQLite 首次启动的种子数据（从 app.js 页面内迁移到服务端） */

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

function q(o) {
  return {
    id: o.id, type: o.type || "problem", subject: o.subject || "subj-math",
    subSubject: o.subSubject || "ss-gaoshu", chapter: o.chapter || "",
    kps: o.kps || [], tags: o.tags || [], note: o.note || "", marks: o.marks || {},
    wrongAnswer: o.wrongAnswer || "", titleTex: o.titleTex || "", solutionTex: o.solutionTex || "",
    createdAt: o.createdAt || Date.now(), urgent: !!o.urgent,
    calcWeak: !!o.calcWeak, needConsolidate: !!o.needConsolidate
  };
}

const QUESTIONS = [
  q({ id: 1, titleTex: "\\lim_{x \\to 0} \\frac{\\sin x - x}{x^3}", solutionTex: "由泰勒展开：\\sin x = x - \\frac{x^3}{6} + o(x^3)，原式 = \\lim \\frac{-x^3/6 + o(x^3)}{x^3} = -\\frac{1}{6}", chapter: "ch-c1", kps: ["极限计算"], tags: ["method"], createdAt: Date.now() - 8 * 86400000, note: "关键：看到 sin x − x 要想到泰勒展开，洛必达要三次很慢", marks: { rescratch: true } }),
  q({ id: 2, titleTex: "设 f(x) 在 [0,1] 上连续，证明 \\exists \\xi \\in (0,1) 使 f(\\xi) = \\xi", solutionTex: "构造 F(x) = f(x) - x，F(0) = f(0) \\ge 0，F(1) = f(1) - 1 \\le 0，由零点定理得证", chapter: "ch-c1", kps: ["极限计算"], tags: ["knowledge"], createdAt: Date.now() - 6 * 86400000 }),
  q({ id: 3, titleTex: "\\int_0^1 x e^x \\, dx", solutionTex: "分部积分：= [x e^x]_0^1 - \\int_0^1 e^x dx = e - (e - 1) = 1", chapter: "ch-c3", kps: ["定积分计算"], tags: ["calc"], createdAt: Date.now() - 3 * 86400000, note: "分部积分符号别漏" }),
  q({ id: 4, titleTex: "计算 \\iint_D (x + y) \\, dxdy，D: x^2 + y^2 \\le 1", solutionTex: "极坐标：= \\int_0^{2\\pi} \\int_0^1 r(\\cos\\theta + \\sin\\theta) r \\, dr d\\theta = 0", chapter: "ch-c5", kps: ["二重积分"], tags: ["method"], createdAt: Date.now() - 1 * 86400000 }),
  q({ id: 5, titleTex: "求 f(x) = e^x 在 x=0 处的泰勒展开到 3 阶", solutionTex: "e^x = 1 + x + \\frac{x^2}{2} + \\frac{x^3}{6} + o(x^3)", chapter: "ch-c1", kps: ["极限计算"], tags: ["calc"], createdAt: Date.now() - 12 * 86400000 }),
  q({ id: 6, titleTex: "解微分方程 y' + y = e^{-x}", solutionTex: "一阶线性：y = e^{-\\int dx}(\\int e^{-x} e^{\\int dx} dx + C) = e^{-x}(x + C)", chapter: "", kps: [], tags: ["knowledge"], createdAt: Date.now() - 10 * 86400000 }),
  q({ id: 7, titleTex: "求曲线 y = x^2 与 y = x 围成的面积", solutionTex: "S = \\int_0^1 (x - x^2) dx = \\frac{1}{6}", chapter: "ch-c3", kps: ["定积分计算"], tags: ["calc"], createdAt: Date.now() - 20 * 86400000 }),
  q({ id: 8, titleTex: "证明 r(A) = r(A^T)", solutionTex: "行秩 = 列秩，用初等变换化阶梯形", chapter: "ch-l2", kps: ["矩阵的秩"], tags: ["method"], createdAt: Date.now() - 18 * 86400000 }),
  q({ id: 9, titleTex: "A = \\begin{pmatrix} 2 & 1 \\\\ 0 & 2 \\end{pmatrix} 能否对角化？", solutionTex: "特征值 λ=2 重根，特征向量只有一个，不能对角化", chapter: "ch-l5", kps: ["相似对角化"], tags: ["knowledge"], createdAt: Date.now() - 4 * 86400000 }),
  q({ id: 10, titleTex: "两批产品合格率分别为 0.9、0.8，任取一件求合格概率", solutionTex: "全概率：P = \\frac{1}{2} \\times 0.9 + \\frac{1}{2} \\times 0.8 = 0.85", chapter: "ch-p1", kps: ["全概率与贝叶斯公式"], tags: ["calc"], createdAt: Date.now() - 2 * 86400000 }),
  q({ id: 11, type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: "ch-w1", kps: ["动词辨析"], titleTex: "determine / decide / conclude", solutionTex: "determine 确定（客观）· decide 决定（主观）· conclude 推断（结论）", tags: ["other"], createdAt: Date.now() - 1 * 86400000 }),
  q({ id: 12, type: "problem", subject: "subj-eng", subSubject: "ss-read", chapter: "ch-r1", kps: [], titleTex: "阅读理解推理题：作者态度题解题方法", solutionTex: "找转折词 but/however，态度词 positive/negative/neutral", tags: ["method"], createdAt: Date.now() - 5 * 86400000 }),
  q({ id: 13, type: "essay", subject: "subj-eng", subSubject: "ss-essay", chapter: "ch-e1", kps: [], titleTex: "图画作文开头模板句", solutionTex: "As is vividly depicted in the picture, ... The picture is thought-provoking in that ...", tags: ["other"], createdAt: Date.now() - 9 * 86400000 }),
  q({ id: 14, type: "problem", subject: "subj-408", subSubject: "ss-ds", chapter: "ch-d6", kps: ["B 树与 B+ 树"], titleTex: "B 树与 B+ 树的区别", solutionTex: "B+ 树数据都在叶子、叶子链表、更适合范围查询和数据库索引", tags: ["knowledge"], createdAt: Date.now() - 11 * 86400000 }),
  q({ id: 15, type: "problem", subject: "subj-408", subSubject: "ss-net", chapter: "ch-n5", kps: ["TCP 可靠传输"], titleTex: "TCP 三次握手各状态含义", solutionTex: "SYN_SENT / SYN_RCVD / ESTABLISHED，防历史连接", tags: ["careless"], createdAt: Date.now() - 14 * 86400000 })
];

function reviewLog(qid, at, result, id) {
  return { id, qid, at, result };
}
const now = Date.now();
const d = (n) => now - n * 86400000;
const REVIEW_LOGS = [
  reviewLog(1, d(8), "fail", 1), reviewLog(1, d(7), "fail", 2), reviewLog(1, d(5), "fail", 3),
  reviewLog(2, d(6), "fail", 4), reviewLog(2, d(4), "half", 5), reviewLog(2, d(2), "fail", 6),
  reviewLog(3, d(3), "fail", 7),
  reviewLog(5, d(12), "ok", 8), reviewLog(5, d(8), "fail", 9), reviewLog(5, d(3), "half", 10),
  reviewLog(6, d(10), "ok", 11), reviewLog(6, d(6), "ok", 12),
  reviewLog(7, d(20), "ok", 13), reviewLog(7, d(12), "ok", 14), reviewLog(7, d(4), "ok", 15),
  reviewLog(8, d(18), "ok", 16), reviewLog(8, d(9), "ok", 17), reviewLog(8, d(2), "ok", 18),
  reviewLog(9, d(4), "fail", 19), reviewLog(9, d(1), "fail", 20),
  reviewLog(12, d(5), "fail", 21),
  reviewLog(13, d(9), "ok", 22), reviewLog(13, d(2), "fail", 23),
  reviewLog(14, d(11), "ok", 24), reviewLog(14, d(5), "fail", 25), reviewLog(14, d(1), "half", 26),
  reviewLog(15, d(14), "ok", 27), reviewLog(15, d(7), "ok", 28)
];

module.exports = { TREE, QUESTIONS, REVIEW_LOGS };
