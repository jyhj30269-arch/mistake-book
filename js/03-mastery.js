/* ============================================================
   个人工作台 v1.18.0 · 03-mastery.js（由 app.js 拆分）
   六级掌握度、SM-2 间隔重复调度、连续打卡、薄弱知识点
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

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

/* ---------------- 间隔重复调度（SM-2 轻量版，由复习记录推导，无额外状态） ---------------- */
const SM2 = { INITIAL_EASE: 2.5, MIN_EASE: 1.3 };

/* 按时间序模拟 SM-2：返回 { dueAt, ease, intervalDays, lapses } */
function scheduleOf(qid) {
  const logs = logsOf(qid);
  if (!logs.length) return { dueAt: Date.now(), ease: SM2.INITIAL_EASE, intervalDays: 0, lapses: 0, lastAt: null };
  let ease = SM2.INITIAL_EASE, interval = 0, lapses = 0, lastAt = logs[0].at;
  for (const l of logs) {
    lastAt = l.at;
    if (l.result === "ok") {
      interval = interval === 0 ? 1 : Math.round(interval * ease);
      if (interval < 1) interval = 1;
    } else if (l.result === "half") {
      interval = Math.max(1, Math.round(interval * 0.5));
      ease = Math.max(SM2.MIN_EASE, ease - 0.1);
    } else { // fail / stuck：重置间隔并降难度系数
      ease = Math.max(SM2.MIN_EASE, ease - 0.2);
      interval = 1;
      lapses++;
    }
  }
  return { dueAt: lastAt + interval * 86400000, ease, intervalDays: interval, lapses, lastAt };
}

/* 是否到期（含从未复习 = 立即到期） */
function isDue(qid) { return scheduleOf(qid).dueAt <= Date.now(); }

/* 下次复习的友好文案 */
function nextDueText(qid) {
  const s = scheduleOf(qid);
  if (!s.lastAt) return "未复习 · 可随时首刷";
  const days = Math.ceil((s.dueAt - Date.now()) / 86400000);
  if (days <= 0) return `今天到期（间隔 ${s.intervalDays} 天）`;
  if (days === 1) return "明天到期";
  return `${days} 天后到期（间隔 ${s.intervalDays} 天）`;
}

/* 连续打卡天数：从今天往前数连续有学习记录（按天时长 > 0 或当天有复习）的天数 */
function currentStreak() {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const key = fmtDate(Date.now() - i * 86400000);
    const studied = (study.perDay[key] || 0) > 0;
    const reviewed = reviewLogs.some(l => fmtDate(l.at) === key);
    if (studied || reviewed) n++;
    else break;
  }
  return n;
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

function findDupCandidates(titleTex, subject, type, excludeId, pool) {
  const n = norm(titleTex);
  const windowMs = 7 * 86400000;
  const src = pool || questions; // ⑬ 传入 7 天窗口预过滤池可避免全库扫描
  return src.filter(q =>
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

/* ⑬ 7 天窗口候选池（题库列表渲染时只对窗口内题目做去重比对） */
function recentDupPool() {
  const windowMs = 7 * 86400000;
  return questions.filter(q => Date.now() - q.createdAt <= windowMs);
}

