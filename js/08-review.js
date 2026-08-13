/* ============================================================
   个人工作台 v1.17.0 · 08-review.js（由 app.js 拆分）
   复习（配置/抽题/做题/自评/断点/默写/回忆错因/复习集）+ 数据统计图表（含热力图）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 复习 ---------------- */
let reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", tag: "all", num: 3 };
let reviewQueue = [];
let reviewIdx = 0;
let reviewDone = new Set();    // 已自评的题号（队列下标）
let reviewSkipped = new Set(); // 跳过的题号
let reviewStartedAt = 0;
let reviewResults = [];

function renderReviewConfig() {
  const sub = $("#review-sub");
  if (sub) sub.textContent = "到期优先 · 加权随机 · 做错加急 · 覆盖保证";
  $("#rev-subject").innerHTML = `<option value="all">全部科目</option>` +
    TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#rev-subject").value = reviewCfg.subject || "all";
  $("#rev-subject").onchange = e => {
    reviewCfg.subject = e.target.value;
    reviewCfg.sub = "all";
    fillRevSub();
    apiCall(API.saveSettings({ reviewCfg }));
  };
  fillRevSub();
  $$("#rev-lv-filter .chip").forEach(c => c.onclick = () => {
    reviewCfg.lv = c.dataset.v;
    $$("#rev-lv-filter .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    $("#rev-deadlock-hint").style.display = reviewCfg.lv === "err" ? "" : "none";
    apiCall(API.saveSettings({ reviewCfg }));
  });
  $$("#rev-lv-filter .chip").forEach(x => x.classList.toggle("on", x.dataset.v === reviewCfg.lv));
  $("#rev-deadlock-hint").style.display = reviewCfg.lv === "err" ? "" : "none";
  $$("#rev-tag-filter .chip").forEach(c => c.onclick = () => {
    reviewCfg.tag = c.dataset.v;
    $$("#rev-tag-filter .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    apiCall(API.saveSettings({ reviewCfg }));
  });
  $$("#rev-tag-filter .chip").forEach(x => x.classList.toggle("on", x.dataset.v === (reviewCfg.tag || "all")));
  $$("#rev-num .chip").forEach(c => c.onclick = () => {
    reviewCfg.num = Number(c.dataset.v);
    $$("#rev-num .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    apiCall(API.saveSettings({ reviewCfg }));
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
  $("#rev-subsub").onchange = e => { reviewCfg.sub = e.target.value; fillRevChapter(); apiCall(API.saveSettings({ reviewCfg })); };
  fillRevChapter();
}

/* 复习断点续传 */
function renderResumeButton() {
  const btn = $("#review-resume-btn");
  if (!btn) return;
  const r = reviewResume;
  if (r && Array.isArray(r.queue) && r.idx < r.queue.length) {
    btn.style.display = "";
    btn.textContent = `↻ 继续上次复习（已做 ${r.idx} / ${r.queue.length}）`;
  } else {
    btn.style.display = "none";
  }
}

function continueResume() {
  const r = reviewResume;
  if (!r || !Array.isArray(r.queue)) { toast("没有可继续的复习进度", "error"); return; }
  const pool = r.queue.map(id => questions.find(q => q.id === id)).filter(Boolean);
  if (!pool.length) {
    toast("上次的题目已被删除，无法继续", "error");
    reviewResume = null;
    apiCall(API.saveSettings({ reviewResume: null }));
    renderResumeButton();
    return;
  }
  reviewQueue = pool;
  reviewIdx = Math.min(r.idx, pool.length);
  reviewResults = [];
  reviewDone = new Set(r.done || []);
  reviewSkipped = new Set(r.skipped || []);
  reviewStartedAt = Date.now();
  reviewResume = null;
  apiCall(API.saveSettings({ reviewResume: null }));
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
    if (reviewCfg.tag && reviewCfg.tag !== "all" && !q.tags.includes(reviewCfg.tag)) return false; // P3：错因专项
    const lv = displayMastery(q.id).lv.key;
    if (reviewCfg.lv === "err" && !ERR_TRACK.includes(lv)) return false;
    if (reviewCfg.lv === "worst" && lv !== "darkred" && lv !== "red") return false;
    if (lv === "blue") return false; // 默认排除完全掌握
    return true;
  });
  if (!pool.length) { toast("没有符合条件的题目", "error"); return; }

  // P3 到期优先：先抽间隔重复已到期的题，不足再用其余候选补足
  const need = Math.min(n, pool.length);
  const picked = [];
  const pickLayered = (src) => {
    if (!src.length) return;
    const pickCount = q => logsOf(q.id).length;
    const layers = [[], [], []];
    src.forEach(q => layers[Math.min(pickCount(q), 2)].push(q));
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
  };
  pickLayered(pool.filter(q => isDue(q.id)));
  pickLayered(pool.filter(q => !isDue(q.id)));
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

/* ---------------- 自建复习集（卡片组） ---------------- */
function renderReviewSets() {
  const card = $("#review-sets-card"), list = $("#review-sets-list");
  if (!card || !list) return;
  card.style.display = "";
  list.innerHTML = reviewSets.length ? reviewSets.map(rs => {
    const qs = (rs.qids || []).map(qid => questions.find(q => q.id === qid)).filter(Boolean);
    return `<div class="flex-between set-row">
      <div style="min-width:0;">
        <b>${esc(rs.name)}</b>
        <span class="small muted"> · ${qs.length} 题</span>
      </div>
      <div class="flex" style="gap:6px;">
        <button class="btn btn-sm btn-primary" onclick="startSetReview(${rs.id})">▶ 复习</button>
        <button class="btn btn-sm" onclick="renameReviewSet(${rs.id})">改名</button>
        <button class="btn btn-sm btn-danger" onclick="delReviewSet(${rs.id})">删</button>
      </div>
    </div>`;
  }).join("") : `<div class="small muted">📭 还没有复习集。点右上角「＋ 新建复习集」，或在题库勾选题目后「📁 加入复习集」。</div>`;
}

function startSetReview(id) {
  const rs = reviewSets.find(x => x.id === id);
  if (!rs) return;
  const qs = (rs.qids || []).map(qid => questions.find(q => q.id === qid)).filter(Boolean);
  if (!qs.length) { toast("该复习集还没有题目（去题库勾选后加入）", "error"); return; }
  startReviewWith(qs.length, qs);
}

function addReviewSet() {
  openModal("新建复习集", `
    <div class="field"><label>名称</label><input class="input" id="rs-name" placeholder="如：考前冲刺 · 高数极限" /></div>
    <div class="small muted">在题库勾选题目后点「📁 加入复习集」即可往复习集里添加题目。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddReviewSet()">创建</button>`);
}
function doAddReviewSet() {
  const name = $("#rs-name").value.trim();
  if (!name) { toast("请输入名称", "error"); return; }
  const rs = { id: personalIdSeq++, name, qids: [], createdAt: Date.now() };
  reviewSets.push(rs);
  apiCall(API.saveReviewSet(rs));
  closeModal();
  renderReviewSets();
  toast("复习集已创建", "success");
}

function pickReviewSet() {
  const sel = questions.filter(q => qSel.has(q.id));
  if (!sel.length) { toast("请先在题库勾选题目", "error"); return; }
  openModal(`加入复习集（已选 ${sel.length} 题）`, `
    <div class="small muted mb-8">选择要加入的复习集：</div>
    <div id="rs-pick-list">${reviewSets.length ? reviewSets.map(rs =>
      `<label class="flex set-link-opt" style="gap:8px;cursor:pointer;padding:6px 0;">
        <input type="radio" name="rs-pick" value="${rs.id}" />
        <span>${esc(rs.name)}（${rs.qids.length} 题）</span>
      </label>`).join("") : '<div class="small muted">还没有复习集，先创建一个。</div>'}</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     ${reviewSets.length ? `<button class="btn btn-primary" onclick="doAddToSet()">加入</button>` : `<button class="btn btn-primary" onclick="closeModal();addReviewSet()">＋ 新建复习集</button>`}`
  );
}
function doAddToSet() {
  const radio = document.querySelector('input[name="rs-pick"]:checked');
  if (!radio) { toast("请选择一个复习集", "error"); return; }
  const rs = reviewSets.find(x => x.id === Number(radio.value));
  if (!rs) return;
  const before = (rs.qids || []).length;
  const ids = new Set(rs.qids);
  qSel.forEach(id => ids.add(id));
  rs.qids = Array.from(ids);
  apiCall(API.updateReviewSet(rs));
  const added = rs.qids.length - before;
  qSel.clear();
  closeModal();
  renderQuestions();
  toast(`已加入 ${added} 题到「${rs.name}」`, "success");
}

function renameReviewSet(id) {
  const rs = reviewSets.find(x => x.id === id);
  if (!rs) return;
  window.__rsRename = rs;
  openModal("重命名复习集", `<div class="field"><label>名称</label><input class="input" id="rs-rename" value="${esc(rs.name)}" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doRenameReviewSet()">保存</button>`);
}
function doRenameReviewSet() {
  const rs = window.__rsRename;
  const name = $("#rs-rename").value.trim();
  if (!rs || !name) return;
  rs.name = name;
  apiCall(API.updateReviewSet(rs));
  closeModal();
  renderReviewSets();
  toast("已重命名", "success");
}
function delReviewSet(id) {
  const rs = reviewSets.find(x => x.id === id);
  if (!rs) return;
  openModal("删除复习集", `<div class="small muted">确定删除「${esc(rs.name)}」？其中的题目不会被删除。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelReviewSet(${id})">删除</button>`);
}
function doDelReviewSet(id) {
  reviewSets = reviewSets.filter(x => x.id !== id);
  apiCall(API.deleteReviewSet(id));
  renderReviewSets();
  toast("已删除复习集", "success");
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
  // ③ 默写模式：vocabulary / essay 类题目先默写再对照答案
  const writeWrap = $("#rev-write-wrap"), writeBox = $("#rev-write-box");
  if (writeWrap && writeBox) {
    const writeType = q.type === "vocabulary" || q.type === "essay";
    writeWrap.style.display = writeType ? "" : "none";
    writeBox.style.display = "none";
    const wi = $("#rev-write-input");
    if (wi) wi.value = "";
  }
  // P3：回忆错因（录入时填写的 wrongAnswer，先回忆再看答案）
  const wrongWrap = $("#rev-wrong-wrap"), wrongBox = $("#rev-wrong");
  if (wrongWrap && wrongBox) {
    wrongBox.textContent = q.wrongAnswer || "";
    wrongWrap.style.display = q.wrongAnswer ? "" : "none";
    wrongBox.style.display = "none";
  }
  // P2：原图查看（OCR 来源图，点击可放大/新窗口）
  const imgs = q.imgs || [];
  const wrap = $("#rev-imgs-wrap"), box = $("#rev-imgs");
  if (wrap && box) {
    box.innerHTML = imgs.map(u => `<img src="${esc(u)}" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;" onclick="window.open('${esc(u)}','_blank')" alt="原图" />`).join("");
    wrap.style.display = imgs.length ? "" : "none";
    box.style.display = "none";
  }
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

function toggleRevImgs() {
  const box = $("#rev-imgs");
  if (!box) return;
  box.style.display = box.style.display === "none" ? "" : "none";
}

function toggleRevWrong() {
  const box = $("#rev-wrong");
  if (!box) return;
  box.style.display = box.style.display === "none" ? "" : "none";
}

/* ③ 默写模式交互 */
function toggleRevWrite() {
  const box = $("#rev-write-box");
  if (!box) return;
  box.style.display = box.style.display === "none" ? "" : "none";
  const wi = $("#rev-write-input");
  if (wi && box.style.display !== "none") wi.focus();
}

function revWriteCompare() {
  const mine = $("#rev-write-input").value.trim();
  const q = window.__curQ;
  if (!mine) { toast("先写下你的答案再对照", "error"); return; }
  revealAnswer();
  const mineBox = document.createElement("div");
  mineBox.className = "alert alert-warn small";
  mineBox.textContent = `✍️ 你的作答：${mine.slice(0, 300)}`;
  const ans = $("#rev-answer");
  ans.insertBefore(mineBox, ans.firstChild);
  toast("对照答案，然后自评", "success");
}

function selfRate(result) {
  const q = window.__curQ;
  const log = { id: ++reviewSeq, qid: q.id, at: Date.now(), result };
  reviewLogs.push(log);
  if (result === "fail") q.urgent = true;
  if (result === "half") { q.calcWeak = true; q.urgent = false; }
  if (result === "stuck") q.needConsolidate = true;
  if (result === "ok") q.urgent = false;
  apiCall(API.saveReviewLog(log));
  apiCall(API.updateQuestion(q));
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
    <div class="small muted">已做 ${reviewResults.length} / ${reviewQueue.length} 题，进度已保存（断点续传，随账号数据落库）。</div>`,
    `<button class="btn" onclick="closeModal();go('dashboard')">知道了</button>`
  );
  reviewResume = {
    queue: reviewQueue.map(q => q.id),
    idx: reviewIdx,
    done: Array.from(reviewDone),
    skipped: Array.from(reviewSkipped),
    results: reviewResults
  };
  apiCall(API.saveSettings({ reviewResume }));
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
  const heat = $("#stats-heatmap");
  if (!window.echarts) { [pie, tagPie, weak, studyChart, heat].forEach(el => el.innerHTML = `<div class="muted" style="padding:40px;">ECharts 未加载</div>`); return; }
  // 复用已初始化的实例（避免重复 init 告警与内存泄漏）
  const chart = (el) => (el && window.echarts.getInstanceByDom(el)) || window.echarts.init(el);
  const lvData = Object.values(LV).map(lv => ({
    name: lv.icon + " " + lv.name,
    value: questions.filter(q => displayMastery(q.id).lv.key === lv.key).length
  })).filter(x => x.value > 0);
  chart(pie).setOption({
    color: ["#862E2E", "#E03131", "#F76707", "#ADB5BD", "#F59F00", "#2F9E44", "#1971C2"],
    tooltip: { trigger: "item" },
    series: [{ type: "pie", radius: ["42%", "68%"], label: { formatter: "{b}: {c}" }, data: lvData }]
  });
  const tagData = TAGS.map(t => ({
    name: t.icon + " " + t.name,
    value: questions.filter(q => q.tags.includes(t.key)).length
  })).filter(x => x.value > 0);
  chart(tagPie).setOption({
    color: ["#4C6EF5", "#F59F00", "#F76707", "#2F9E44", "#E03131", "#ADB5BD"],
    tooltip: { trigger: "item" },
    series: [{ type: "pie", radius: ["42%", "68%"], label: { formatter: "{b}: {c}" }, data: tagData }]
  });
  const wk = weakKps().slice(0, 10);
  chart(weak).setOption({
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
  chart(studyChart).setOption({
    tooltip: {},
    grid: { left: 40, right: 10, top: 12, bottom: 24 },
    xAxis: { type: "category", data: days, axisLabel: { interval: 4 } },
    yAxis: { type: "value", name: "分钟" },
    series: [{ type: "line", smooth: true, data: vals, areaStyle: { opacity: .15 }, itemStyle: { color: "#4C6EF5" } }]
  });

  // 🔥 复习热力图（近 12 个月） + 连续打卡
  if (heat) {
    const streakEl = $("#heatmap-streak");
    if (streakEl) streakEl.textContent = `连续打卡 ${currentStreak()} 天`;
    const rangeStart = new Date(Date.now() - 364 * 86400000);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const heatData = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(rangeStart.getTime() + i * 86400000);
      const key = fmt(d);
      heatData.push([key, Math.round((study.perDay[key] || 0) / 60)]);
    }
    const today = fmt(new Date());
    chart(heat).setOption({
      tooltip: { formatter: p => `${p.data[0]}：${p.data[1]} 分钟` },
      visualMap: { min: 0, max: 120, calculable: false, orient: "horizontal", left: "center", bottom: 0,
        inRange: { color: ["#EBEDF0", "#9BE9A8", "#40C463", "#30A14E", "#216E39"] } },
      calendar: { range: [fmt(rangeStart), today], cellSize: ["auto", 14], left: 50, right: 10, top: 20, bottom: 40,
        yearLabel: { show: false }, dayLabel: { firstDay: 1 }, monthLabel: { nameMap: "cn" } },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: heatData }]
    });
  }
}

