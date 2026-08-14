/* ============================================================
   个人工作台 v1.19.0 · 09-personal.js（由 app.js 拆分）
   个人管理（待办/目标/复盘/收件箱/日历/周月总结/学情周报）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

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
  const t = {
    id: nextTodoId(), title, done: false,
    due, priority: parsed.priority || prioSel,
    subtasks: [], tags: parsed.tags, note: "", remind: "",
    createdAt: Date.now()
  };
  personal.todos.unshift(t);
  input.value = "";
  apiCall(API.saveTodo(t));
  renderTodos();
  toast("已添加待办", "success");
}

function toggleTodo(id) {
  const t = personal.todos.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  apiCall(API.updateTodo(t));
  if (currentView === "todos") renderTodos();
  if (currentView === "dashboard") renderOverview();
  if (currentView === "goals") renderGoals();
}

function delTodo(id) {
  personal.todos = personal.todos.filter(x => x.id !== id);
  const linked = personal.goals.filter(g => g.linkedTodoIds && g.linkedTodoIds.includes(id));
  linked.forEach(g => { g.linkedTodoIds = g.linkedTodoIds.filter(x => x !== id); apiCall(API.updateGoal(g)); });
  apiCall(API.deleteTodo(id));
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
  apiCall(API.updateTodo(t));
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
  const g = {
    id: nextTodoId(), title, category: $("#goal-cat").value, progress: 0,
    milestone: "", targetDate: $("#goal-date").value || "", status: "active",
    linkedTodoIds: [], milestones: [], note: "", createdAt: Date.now()
  };
  personal.goals.push(g);
  $("#goal-input").value = "";
  $("#goal-date").value = "";
  apiCall(API.saveGoal(g));
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
  apiCall(API.updateGoal(g));
  renderGoals();
}

function markGoalDone(id) {
  const g = personal.goals.find(x => x.id === id);
  if (!g) return;
  g.status = g.status === "done" ? "active" : "done";
  apiCall(API.updateGoal(g));
  renderGoals();
  toast(g.status === "done" ? "目标已完成 🎉" : "已恢复进行中");
}

function toggleGoalMilestone(goalId, msId) {
  const g = personal.goals.find(x => x.id === goalId);
  if (!g) return;
  const m = (g.milestones || []).find(x => x.id === msId);
  if (!m) return;
  m.done = !m.done;
  apiCall(API.updateGoal(g));
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
  apiCall(API.updateGoal(g));
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
  apiCall(API.deleteGoal(id));
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
  return { start, startKey, added, reviewed, studySec, todoTotal: todos.length, todoDone: doneTodos, rvCount, inboxCount };
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
  // ⑤ 学情周报：薄弱知识点 TOP5 + 错因分布（基于周期内复习记录）
  const learn = $("#summary-learn");
  if (learn) {
    const inRange = reviewLogs.filter(l => l.at >= d.start);
    const wkMap = {};
    questions.forEach(q => {
      const keys = q.kps.length ? q.kps : ["未分类"];
      keys.forEach(k => {
        const fails = inRange.filter(l => l.qid === q.id && l.result === "fail").length;
        if (fails > 0) wkMap[k] = (wkMap[k] || 0) + fails;
      });
    });
    const topWk = Object.entries(wkMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const tagCnt = {};
    inRange.forEach(l => {
      const q = questions.find(x => x.id === l.qid);
      if (!q) return;
      (q.tags.length ? q.tags : ["other"]).forEach(t => { tagCnt[t] = (tagCnt[t] || 0) + 1; });
    });
    const tagList = Object.entries(tagCnt).sort((a, b) => b[1] - a[1]).slice(0, 5);
    learn.innerHTML = `
      <div>
        <div class="card-title small mb-8">💪 薄弱知识点 TOP5（期间做错次数）</div>
        ${topWk.length ? topWk.map(([k, n]) => `<div class="flex-between small" style="padding:4px 0;"><span>${esc(k)}</span><span class="tag tag-danger">错 ${n} 次</span></div>`).join("")
          : `<div class="small muted">${d.reviewed ? "期间没有做错记录，状态不错 🎉" : "期间没有复习记录"}</div>`}
      </div>
      <div>
        <div class="card-title small mb-8">🎯 错因分布（期间复习自评）</div>
        ${tagList.length ? tagList.map(([t, n]) => {
          const meta = TAGS.find(x => x.key === t) || { icon: "❓", name: t };
          const pct = inRange.length ? Math.round(n / inRange.length * 100) : 0;
          return `<div class="flex-between small" style="padding:4px 0;"><span>${meta.icon} ${meta.name}</span><span class="small muted">${n} 次 · ${pct}%</span></div>`;
        }).join("") : `<div class="small muted">${d.reviewed ? "暂无标签数据" : "期间没有复习记录"}</div>`}
      </div>`;
  }
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
  apiCall(API.saveDailyReview(rv));
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
  const it = personal.inbox[0];
  input.value = "";
  apiCall(API.saveInboxItem(it));
  renderInbox();
  toast("已收入收件箱", "success");
}

function markInboxDone(id, label) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "done";
  apiCall(API.updateInboxItem(it));
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
  const t = {
    id: nextTodoId(), title: $("#it-title").value.trim() || it.text, done: false,
    due: due === "today" ? dayKey() : due === "tomorrow" ? dayKey(1) : "",
    priority: Number($("#it-priority").value) || 0,
    subtasks: [], tags: it.tags || [], note: "", remind: "", createdAt: Date.now()
  };
  personal.todos.unshift(t);
  apiCall(API.saveTodo(t));
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
  const g = {
    id: nextTodoId(), title: $("#ig-title").value.trim() || it.text,
    category: $("#ig-cat").value, progress: 0, milestone: "", targetDate: "",
    status: "active", linkedTodoIds: [], milestones: [], note: "", createdAt: Date.now()
  };
  personal.goals.push(g);
  apiCall(API.saveGoal(g));
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
  rv.updatedAt = Date.now();
  apiCall(API.saveDailyReview(rv));
  markInboxDone(id, "复盘");
}

function archiveInboxItem(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "archived";
  apiCall(API.updateInboxItem(it));
  renderInbox();
  toast("已归档");
}

function reopenInboxItem(id) {
  const it = personal.inbox.find(x => x.id === id);
  if (!it) return;
  it.status = "open";
  apiCall(API.updateInboxItem(it));
  renderInbox();
}

function delInboxItem(id) {
  personal.inbox = personal.inbox.filter(x => x.id !== id);
  apiCall(API.deleteInboxItem(id));
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
  // ② 到期分布：scheduleOf 的 dueAt 落在该天的题目数（未复习题算"今天到期"）
  const dueCount = questions.filter(q => {
    if (displayMastery(q.id).lv.key === "blue") return false;
    const s = scheduleOf(q.id);
    return s.lastAt ? fmtDate(s.dueAt) === dateStr : dateStr === fmtDate(Date.now());
  }).length;
  return { todos, goals, rv, studyMin, dueCount };
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
    if (info.dueCount) badges.push(`<span class="cal-badge due" title="${info.dueCount} 题到期复习">🔥${info.dueCount}</span>`);
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
    <div class="small muted mt-8">学习 ${info.studyMin} 分钟${info.dueCount ? ` · <span class="text-danger">🔥 ${info.dueCount} 题到期复习</span>` : ""}</div>
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

/* ---------------- 每日习惯打卡（v1.18） ---------------- */
function renderHabitsPanel() {
  const box = $("#habits-panel");
  if (!box) return;
  if (!habits.length) {
    box.innerHTML = `<div class="small muted">还没有习惯。点「＋ 添加习惯」创建，如：背 50 个单词 / 跑步 30 分钟。</div>`;
    return;
  }
  const today = fmtDate(Date.now());
  box.innerHTML = habits.map(h => {
    const done = (h.doneDays || []).includes(today);
    const total = (h.doneDays || []).length;
    return `<div class="flex-between set-row">
      <label class="flex" style="gap:8px;cursor:pointer;min-width:0;">
        <input type="checkbox" ${done ? "checked" : ""} onchange="toggleHabit(${h.id},this.checked)" />
        <span style="${done ? "text-decoration:line-through;color:var(--text-3);" : ""}">${esc(h.name)}</span>
        <span class="tag ${done ? "tag-success" : ""}">🔥 ${total} 天</span>
      </label>
      <button class="btn btn-sm btn-danger" onclick="delHabit(${h.id})">删</button>
    </div>`;
  }).join("");
}

function addHabit() {
  openModal("添加每日习惯", `
    <div class="field"><label>习惯名称</label><input class="input" id="habit-name" placeholder="如：背 50 个单词 / 跑步 30 分钟" /></div>
    <div class="small muted">每天勾选打卡，累计天数会显示 🔥 徽章</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddHabit()">添加</button>`);
}
function doAddHabit() {
  const name = $("#habit-name").value.trim();
  if (!name) { toast("请输入习惯名称", "error"); return; }
  const h = { id: personalIdSeq++, name, doneDays: [], createdAt: Date.now() };
  habits.push(h);
  apiCall(API.saveHabit(h));
  closeModal();
  renderHabitsPanel();
  toast("习惯已添加，记得每天打卡", "success");
}
function toggleHabit(id, checked) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  const today = fmtDate(Date.now());
  h.doneDays = h.doneDays || [];
  if (checked) { if (!h.doneDays.includes(today)) h.doneDays.push(today); }
  else h.doneDays = h.doneDays.filter(d => d !== today);
  apiCall(API.updateHabit(h));
  renderHabitsPanel();
  toast(checked ? "打卡成功 🔥" : "已取消今日打卡", checked ? "success" : "");
}
function delHabit(id) {
  habits = habits.filter(x => x.id !== id);
  apiCall(API.deleteHabit(id));
  renderHabitsPanel();
  toast("习惯已删除", "success");
}

/* ---------------- 学情周报导出 Markdown（v1.18） ---------------- */
function exportLearnReport() {
  const d = summaryData(summaryRange);
  const inRange = reviewLogs.filter(l => l.at >= d.start);
  const wkMap = {};
  questions.forEach(q => {
    const keys = q.kps.length ? q.kps : ["未分类"];
    keys.forEach(k => {
      const fails = inRange.filter(l => l.qid === q.id && l.result === "fail").length;
      if (fails > 0) wkMap[k] = (wkMap[k] || 0) + fails;
    });
  });
  const topWk = Object.entries(wkMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tagCnt = {};
  inRange.forEach(l => {
    const q = questions.find(x => x.id === l.qid);
    if (!q) return;
    (q.tags.length ? q.tags : ["other"]).forEach(t => { tagCnt[t] = (tagCnt[t] || 0) + 1; });
  });
  const tagList = Object.entries(tagCnt).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const md = [
    `# 学情周报（${summaryRange === "week" ? "本周" : "本月"} · 自 ${d.startKey} 起）`,
    "",
    `- 录入题数：${d.added} · 复习次数：${d.reviewed} · 学习时长：${Math.floor(d.studySec / 60)} 分钟`,
    `- 待办完成：${d.todoDone}/${d.todoTotal} · 复盘：${d.rvCount} 天`,
    "",
    "## 薄弱知识点 TOP5",
    ...(topWk.length ? topWk.map(([k, n]) => `- ${k}（做错 ${n} 次）`) : ["- 期间没有做错记录 🎉"]),
    "",
    "## 错因分布",
    ...(tagList.length ? tagList.map(([t, n]) => { const meta = TAGS.find(x => x.key === t) || { name: t }; return `- ${meta.name}：${n} 次`; }) : ["- 期间没有复习记录"]),
    "",
    `生成时间：${new Date().toLocaleString("zh-CN")} · 个人工作台 v${APP_VERSION}`
  ].join("\n");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `学情周报-${d.startKey}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast("学情周报已导出 Markdown", "success");
}

