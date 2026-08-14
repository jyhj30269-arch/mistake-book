/* ============================================================
   个人工作台 v1.19.0 · 05-dashboard.js（由 app.js 拆分）
   仪表盘渲染、推荐算法、今日任务
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

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
    .map(q => ({ q, s: recScore(q), due: isDue(q.id) ? 0 : 1 })) // P3：到期题优先
    .sort((a, b) => a.due - b.due || b.s - a.s)
    .slice(0, n)
    .map(x => x.q);
}

function renderDashboard() {
  const dateEl = $("#dash-date");
  const now = new Date();
  dateEl.textContent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} · 个人工作台`;

  const rec = recommendQuestions(10);
  $("#rec-count").textContent = rec.length;
  const dueToday = questions.filter(q => isDue(q.id) && displayMastery(q.id).lv.key !== "blue").length;
  const doneToday = reviewLogs.filter(l => fmtDate(l.at) === fmtDate(Date.now())).length;
  $("#rec-desc").textContent = `已按"到期优先 + 掌握度差 + 错因权重"排序，前 ${rec.length} 道；可手动调数量`;
  const taskLine = $("#due-task-line");
  if (taskLine) taskLine.innerHTML = `<span>🔥 今日到期 <b>${dueToday}</b> 题 · 今日已复习 <b>${doneToday}</b> 题 · 连续打卡 <b>${currentStreak()}</b> 天</span><span class="small muted">${dueToday ? "建议先复习到期题" : "今天没有到期任务 🎉"}</span>`;
  window.__rec = rec;
  renderRecPanel();

  // 仪表盘内联：随机复习 + 数据统计
  renderReviewConfig();
  renderReviewSets();
  renderStats();
  renderOverview();
  renderTodayOverview();
  renderExamCountdown();
  renderHabitsPanel();
  renderTodayPlan();
  renderWordPanel();
}

/* 📅 考研倒计时横幅（剩余 ≤60 天进入冲刺提示） */
function renderExamCountdown() {
  const cd = $("#exam-countdown");
  if (!cd) return;
  const left = examDaysLeft();
  if (left == null) { cd.style.display = "none"; return; }
  cd.style.display = "";
  const sprint = left <= 60;
  cd.className = sprint ? "alert alert-danger mt-16" : "alert mt-16";
  cd.innerHTML = left >= 0
    ? `📅 距考试日 <b>${esc(examDate)}</b> 还有 <b style="font-size:16px;">${left}</b> 天${left === 0 ? "（今天考试，加油！）" : sprint ? " · 冲刺模式 🔥 建议每天：复习到期题 → 攻克薄弱知识点 → 录新题" : ""}`
    : `✅ 考试日（${esc(examDate)}）已过去 ${-left} 天`;
}

/* 📋 今日学习计划：到期复习 → 薄弱知识点攻克 → 录入新题 */
function genTodayPlan() {
  renderTodayPlan(true);
}
function renderTodayPlan(force) {
  const box = $("#today-plan");
  if (!box) return;
  const dueToday = questions.filter(q => isDue(q.id) && displayMastery(q.id).lv.key !== "blue");
  const topWk = weakKps().filter(w => w.err > 0).slice(0, 3);
  const addedToday = questions.filter(q => fmtDate(q.createdAt) === fmtDate(Date.now())).length;
  const streak = currentStreak();
  box.innerHTML = `
    <div class="small muted mb-8">自动生成 · 按优先级排列 ${force ? "（已重新生成）" : ""}</div>
    <div class="plan-item">
      <div class="flex-between">
        <div><b>① 复习到期题</b><div class="small muted">间隔重复队列 · 今日 ${dueToday.length} 题</div></div>
        <button class="btn btn-sm ${dueToday.length ? "btn-primary" : ""}" onclick="reviewDueNow()" ${dueToday.length ? "" : "disabled"}>开始</button>
      </div>
    </div>
    <div class="plan-item">
      <div class="flex-between">
        <div><b>② 攻克薄弱知识点</b><div class="small muted">${topWk.length ? topWk.map(w => esc(w.name) + " ×" + w.err).join(" · ") : "暂无薄弱知识点，继续保持"}</div></div>
        <button class="btn btn-sm" onclick="reviewWeakNow()" ${topWk.length ? "" : "disabled"}>抽题</button>
      </div>
    </div>
    <div class="plan-item">
      <div class="flex-between">
        <div><b>③ 录入新题</b><div class="small muted">今天已录入 ${addedToday} 题 ${streak ? `· 连续打卡 ${streak} 天 🔥` : ""}</div></div>
        <button class="btn btn-sm" onclick="go('input')">去录入</button>
      </div>
    </div>`;
}

/* ② 按薄弱知识点抽题复习 */
function reviewWeakNow() {
  const topWk = weakKps().filter(w => w.err > 0).slice(0, 3);
  if (!topWk.length) { toast("暂无薄弱知识点", "success"); return; }
  const names = new Set(topWk.map(w => w.name));
  const pool = questions.filter(q => q.kps.some(k => names.has(k)) && displayMastery(q.id).lv.key !== "blue");
  if (!pool.length) { toast("薄弱知识点下没有题目，先去录入", "error"); return; }
  startReviewWith(Math.min(5, pool.length), pool);
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

/* 🔥 复习全部到期题（间隔重复队列） */
function reviewDueNow() {
  const due = questions.filter(q => isDue(q.id) && displayMastery(q.id).lv.key !== "blue");
  if (!due.length) { toast("今天没有到期的题目 🎉", "success"); return; }
  startReviewWith(due.length, due);
}

/* ⚙️ 抽题配置折叠开关 */
function toggleReviewCfg() {
  const d = $("#review-cfg-details");
  if (!d) return;
  d.open = !d.open;
}

/* ---------------- 单题录入 ---------------- */
