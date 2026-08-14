/* ============================================================
   个人工作台 v1.19.0 · 07-questions.js（由 app.js 拆分）
   题库列表/筛选/分页/批量归类/详情/编辑/删除
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 题库 ---------------- */
const filters = { lv: new Set(), tag: new Set(), uncat: false, dup: false, mark: null };
let treeMode = true;
let qSel = new Set();
let qPage = 1;              // 题库分页（每页 Q_PAGE_SIZE，加载更多）
const Q_PAGE_SIZE = 100;

function toggleFilter(el) {
  const f = el.dataset.f, v = el.dataset.v;
  if (f === "lv" || f === "tag") {
    const set = filters[f];
    set.has(v) ? set.delete(v) : set.add(v);
  } else if (f === "uncat") filters.uncat = !filters.uncat;
  else if (f === "dup") filters.dup = !filters.dup;
  else if (f === "mark") filters.mark = filters.mark === v ? null : v;
  el.classList.toggle("on");
  qPage = 1;
  renderQuestions();
}

function loadMoreQuestions() {
  qPage++;
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
      const hay = (q.titleTex + " " + q.solutionTex + " " + q.wrongAnswer + " " + q.note + " " + q.kps.join(" ") + " " + TAGS.filter(t => q.tags.includes(t.key)).map(t => t.name).join(" ")).toLowerCase();
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
  qPage = 1;
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
  const shown = list.slice(0, qPage * Q_PAGE_SIZE);
  $("#q-sub").textContent = `共 ${questions.length} 题 · 当前筛选 ${list.length} 题`;
  $("#q-count").textContent = `显示 ${shown.length} / ${list.length} 条`;
  $("#q-batch-btn").style.display = qSel.size ? "" : "none";
  $("#q-set-btn").style.display = qSel.size ? "" : "none";
  $("#q-del-btn").style.display = qSel.size ? "" : "none";
  $("#q-export-btn").style.display = qSel.size ? "" : "none";
  $("#q-sel-all").checked = list.length > 0 && list.every(q => qSel.has(q.id));
  const moreWrap = $("#q-more-wrap");
  if (moreWrap) moreWrap.style.display = list.length > shown.length ? "flex" : "none";

  if (!list.length) {
    $("#q-body").innerHTML = `<div class="empty-state">📭 没有符合条件的题目。<br/><span class="small muted">去「识别录入」添加第一道错题，或调整筛选条件。</span></div>`;
    return;
  }
  const isMobile = window.innerWidth <= 768;
  const recentPool = recentDupPool(); // ⑬ 去重只用 7 天窗口内题目
  const rows = shown.map(q => {
    const m = displayMastery(q.id);
    const dup = findDupCandidates(q.titleTex, q.subject, q.type, q.id, recentPool).length;
    const tagTxt = TAGS.filter(t => q.tags.includes(t.key)).map(t => `${t.icon} ${t.name.split("/")[0]}`).join(" ");
    const kpTxt = q.kps.length ? q.kps.join(" / ") : '<span class="tag">未分类</span>';
    const aged = m.decay;
    const meta = `${esc(TREE.flatMap(s => s.children).find(c => c.id === q.subSubject)?.name || "")} · ${fmtDate(q.createdAt)} 录入${(q.imgs || []).length ? ` · <span title="含 OCR 原图">📷 ${q.imgs.length}</span>` : ""}${dup ? ` · <span class="text-danger">⚠ 疑似重复 ${dup}</span>` : ""}${aged ? " · 超过 7 天未复习" : ""}`;
    if (isMobile) {
      return `<div class="q-card-item card">
        <div class="flex-between">
          <label class="small muted flex" style="gap:6px;cursor:pointer;"><input type="checkbox" ${qSel.has(q.id) ? "checked" : ""} onclick="toggleSel(${q.id},this)" /> 选择</label>
          ${lvTag(m.lv, m.decay)}
          <div class="flex">
            <button class="btn btn-sm" onclick="openDetail(${q.id})">详情</button>
            <button class="btn btn-sm ${q.marks.star ? "btn-primary" : ""}" onclick="toggleMark(${q.id},'star',this)">★</button>
          </div>
        </div>
        <div class="katex-render mt-8" data-tex="${esc(q.titleTex)}"></div>
        <div class="small muted mt-8">${meta}</div>
        <div class="flex mt-8" style="flex-wrap:wrap;gap:6px;align-items:center;">
          <span class="tag">复习 ${logsOf(q.id).length} 次</span>
          ${tagTxt ? `<span class="small">${tagTxt}</span>` : ""}
        </div>
      </div>`;
    }
    return `<tr>
      <td><input type="checkbox" ${qSel.has(q.id) ? "checked" : ""} onclick="toggleSel(${q.id},this)" /></td>
      <td>${lvTag(m.lv, m.decay)}</td>
      <td>
        <div class="katex-render" data-tex="${esc(q.titleTex)}"></div>
        <div class="small muted mt-8">${meta}</div>
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
  $("#q-body").innerHTML = isMobile
    ? `<div class="q-card-list">${rows}</div>`
    : `<table class="table"><thead><tr>
        <th style="width:30px;"></th><th style="width:120px;">掌握度</th><th>题面</th>
        <th>知识点</th><th>错因</th><th>复习</th><th>操作</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
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
  apiCall(API.updateQuestion(q));
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
  selected.forEach(q => apiCall(API.updateQuestion(q)));
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
        <div class="stat-delta">最近 ${logs.length ? fmtDate(logs[logs.length - 1].at) : "—"} · 下次复习：${nextDueText(q.id)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">错因（主因 + 次因）</div>
        <div class="stat-value" style="font-size:15px;font-weight:600;">${tagNames.length ? tagNames.map(t => `${t.icon} ${t.name}`).join(" · ") : "未设置"}</div>
        <div class="stat-delta">${q.urgent ? "⏫ 做错加急标记（下次抽题 ×2）" : "四档自评会标记 计算薄弱 / 需巩固"}</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div class="card-title">题目</div><div class="flex"><span class="tag">content_type: ${q.type}${q.marks.rescratch ? " · 待二刷" : ""}</span>${q.type === "vocabulary" ? `<button class="btn btn-sm" onclick="speakQuestion(${q.id})">🔊 发音</button>` : ""}</div></div>
      <div class="katex-render" data-tex="${esc(q.titleTex)}" data-display="1"></div>
      <div class="divider"></div>
      <div class="card-title small mb-16">解题过程</div>
      <div class="katex-render" data-tex="${esc(q.solutionTex || "（未填写）")}" data-display="1"></div>
      ${q.note ? `<div class="mt-16"><span class="tag tag-primary">📝 我的笔记</span><div class="small mt-8" style="background:var(--primary-soft);border-radius:10px;padding:10px;">${esc(q.note)}</div></div>` : ""}
    </div>

    ${(q.imgs || []).length ? `
    <div class="card mt-16">
      <div class="card-head"><div class="card-title">📷 原图（OCR 来源）</div><span class="tag">${q.imgs.length} 张</span></div>
      <div class="flex" style="flex-wrap:wrap;gap:10px;">
        ${q.imgs.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" style="max-width:240px;max-height:180px;border-radius:8px;border:1px solid var(--border);" alt="原图" /></a>`).join("")}
      </div>
    </div>` : ""}

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

    ${logs.length >= 2 ? `
    <div class="card mt-16">
      <div class="card-head"><div class="card-title">📈 掌握度曲线（累计掌握分）</div><span class="tag">上升=进步 · 下降=退步</span></div>
      <div id="detail-curve" style="height:200px;"></div>
    </div>` : ""}

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
  // ⑤ 遗忘曲线：累计掌握分时间线
  const curveEl = $("#detail-curve");
  if (curveEl && logs.length >= 2) {
    let acc = 0;
    const pts = logs.map(l => {
      acc += l.result === "ok" ? 1 : l.result === "half" ? 0.5 : l.result === "stuck" ? -0.5 : -1;
      return [fmtDate(l.at), acc];
    });
    const chart = initChart(curveEl);
    if (chart) chart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 16, top: 16, bottom: 26 },
      xAxis: { type: "category", data: pts.map(p => p[0]), axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", name: "掌握分", fontSize: 11 },
      series: [{ type: "line", smooth: true, data: pts.map(p => p[1]), areaStyle: { opacity: .12 }, itemStyle: { color: "#2383E2" }, lineStyle: { width: 2 } }]
    });
  }
  renderMath($("#detail-body"));
}

/* ④ 词汇 TTS 发音（浏览器原生 SpeechSynthesis，零依赖） */
function speakQuestion(id) {
  const q = questions.find(x => x.id === id);
  if (!q) return;
  if (!("speechSynthesis" in window)) { toast("当前浏览器不支持语音", "error"); return; }
  const u = new SpeechSynthesisUtterance(String(q.titleTex).replace(/[\\$_{}]+/g, " ").replace(/\s+/g, " ").trim());
  u.lang = q.subject === "subj-eng" ? "en-US" : "zh-CN";
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ⑥ 批量删除 / 批量导出（v1.18） */
function batchDeleteQuestions() {
  const sel = questions.filter(q => qSel.has(q.id));
  if (!sel.length) { toast("请先勾选题目", "error"); return; }
  openModal(`批量删除（${sel.length} 题）`, `
    <div class="small">将删除选中的 <b>${sel.length}</b> 道题（复习记录一并清理，不可恢复）。请输入 <b>删除</b> 确认：</div>
    <div class="field mt-16"><input class="input" id="batch-del-confirm" placeholder="输入「删除」" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="doBatchDeleteQuestions()">确认删除</button>`);
}
function doBatchDeleteQuestions() {
  const confirmEl = $("#batch-del-confirm");
  if (!confirmEl || confirmEl.value.trim() !== "删除") { toast("需输入「删除」二字", "error"); return; }
  const ids = Array.from(qSel);
  questions = questions.filter(q => !qSel.has(q.id));
  reviewLogs = reviewLogs.filter(l => !qSel.has(l.qid));
  ids.forEach(id => apiCall(API.deleteQuestion(id)));
  qSel.clear();
  closeModal();
  qPage = 1;
  renderQuestions();
  toast(`已删除 ${ids.length} 道题`, "success");
}
function batchExportQuestions() {
  const sel = questions.filter(q => qSel.has(q.id));
  if (!sel.length) { toast("请先勾选题目", "error"); return; }
  const data = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    questions: sel,
    reviewLogs: reviewLogs.filter(l => sel.some(q => q.id === l.qid)),
    tree: TREE
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `错题导出-${fmtDate(Date.now())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast(`已导出 ${sel.length} 题（含复习记录，可再导入）`, "success");
}

function saveNote(id) {
  const q = questions.find(x => x.id === id);
  q.note = $("#detail-note").value;
  apiCall(API.updateQuestion(q));
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
  apiCall(API.updateQuestion(q));
  closeModal();
  toast("题目已更新", "success");
  openDetail(q.id);
}

function quickRate(id, result) {
  const log = { id: ++reviewSeq, qid: id, at: Date.now(), result };
  reviewLogs.push(log);
  const q = questions.find(x => x.id === id);
  if (result === "fail") q.urgent = true;
  if (result === "half") q.calcWeak = true;
  if (result === "stuck") q.needConsolidate = true;
  apiCall(API.saveReviewLog(log));
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
  apiCall(API.deleteQuestion(id));
  closeModal();
  toast("已删除");
  go("questions");
}

/* ---------------- 复习 ---------------- */
