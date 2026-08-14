/* ============================================================
   个人工作台 v1.19.0 · 13-wordbook.js（v1.19 新增模块）
   背单词模式：词书导入 / 每日队列（到期复习优先 + 新词补足）/
   单词卡三档自评 / 不认识回炉 / 本轮小结
   依赖：本文件之前的 js/0X-*.js；wordPlan 状态在 02-state.js 声明。
   ============================================================ */

const WORD_BOOK_ID = "ch-w2";          // 内置词书章节 id（英语 → 单词 下）
const WORD_BOOK_NAME = "六级核心词 3000";

/* ---------- 词书数据 ---------- */
function wordQuestions() {
  return questions.filter(q => q.type === "vocabulary" && q.subject === "subj-eng" &&
    q.subSubject === "ss-word" && q.chapter === WORD_BOOK_ID);
}
function wordProgress() {
  const list = wordQuestions();
  return {
    total: list.length,
    learned: list.filter(q => logsOf(q.id).length > 0).length,
    due: list.filter(q => isDue(q.id)).length
  };
}
/* 词书章节存在性保证（不存在则自动创建） */
function ensureWordBookNode() {
  const eng = TREE.find(s => s.id === "subj-eng");
  const wordSub = eng && eng.children.find(c => c.id === "ss-word");
  if (wordSub && !wordSub.children.some(ch => ch.id === WORD_BOOK_ID)) {
    wordSub.children.push({ id: WORD_BOOK_ID, name: WORD_BOOK_NAME, children: [] });
    apiCall(API.saveTree(TREE));
  }
}

/* ---------- 一键导入内置词书（3000 词） ---------- */
function importBuiltinWordbook() {
  const existing = wordQuestions().length;
  if (existing > 0) {
    openModal("词书已导入", `
      <div class="small">当前已导入 <b>${existing}</b> 个单词。重复导入会重复建题；如需重新导入，请先在题库删除旧词后再试。</div>`,
      `<button class="btn btn-primary" onclick="closeModal()">知道了</button>`);
    return;
  }
  openModal("导入六级核心词 3000", `
    <div class="small">将从内置词书导入 <b>3000</b> 个六级高频词（含释义 / 例句 / 音标）到「英语 → 单词 → ${WORD_BOOK_NAME}」。首次导入约需 10~30 秒。</div>
    <div class="alert alert-warn mt-8">导入后单词进入「🎴 背单词」队列，按每日新词上限（默认 50）逐日学习。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="closeModal();doImportBuiltinWordbook()">开始导入</button>`);
}

async function doImportBuiltinWordbook() {
  toast("正在下载词书…", "success");
  try {
    const res = await fetch("wordlists/cet6-3000.json");
    if (!res.ok) throw new Error("词书文件加载失败（" + res.status + "）");
    const words = await res.json();
    if (!Array.isArray(words) || !words.length) throw new Error("词书内容为空");
    ensureWordBookNode();
    const now = Date.now();
    const qs = words.map((w, i) => ({
      id: 200000 + i + 1,
      type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: WORD_BOOK_ID,
      kps: [WORD_BOOK_NAME], tags: ["other"],
      titleTex: w.w,
      solutionTex: w.t + (w.ph ? "  ［" + w.ph + "］" : ""),
      note: [w.e, w.ec].filter(Boolean).join("\n"),
      wrongAnswer: "", marks: {}, createdAt: now + i,
      urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    }));
    await API.saveQuestionsBatch(qs);
    qs.forEach(q => questions.push(q));
    qidSeq = Math.max(qidSeq, ...qs.map(q => q.id));
    toast(`🎉 导入完成：${words.length} 个单词已进入词书，点「🎴 背单词」开始`, "success");
    renderWordPanel();
    renderSettings();
  } catch (e) {
    toast("导入失败：" + e.message, "error");
  }
}

/* ---------- 批量粘贴导入自定义词表 ---------- */
function openPasteWords() {
  const eng = TREE.find(s => s.id === "subj-eng");
  const wordSub = eng && eng.children.find(c => c.id === "ss-word");
  const books = wordSub && wordSub.children.length
    ? wordSub.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("")
    : "";
  openModal("批量粘贴导入单词", `
    <div class="field"><label>目标词书（章节）</label>
      <select class="select" id="pw-book">${books || `<option value="">（先创建词书：在知识点管理里给「单词」＋加章节）</option>`}</select>
    </div>
    <div class="field"><label>词表（每行：单词 + 空格/Tab + 中文释义，可选 | 英文例句）</label>
      <textarea class="textarea" id="pw-text" rows="10" placeholder="abandon 放弃；抛弃 | He abandoned his plan.&#10;abide 遵守；忍受 | abide by the rules"></textarea>
    </div>
    <div class="small muted">示例行：<span class="mono">abandon 放弃；抛弃 | He abandoned his plan.</span></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doPasteWords()">导入</button>`);
}

function doPasteWords() {
  const bookId = $("#pw-book").value;
  const raw = $("#pw-text").value.trim();
  if (!bookId) { toast("请先选择目标词书", "error"); return; }
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast("词表为空", "error"); return; }
  const bookName = (TREE.flatMap(s => s.children).flatMap(c => c.children).find(ch => ch.id === bookId) || {}).name || bookId;
  const now = Date.now();
  const qs = [];
  let base = Math.max(100000, qidSeq + 1);
  lines.forEach((line, i) => {
    const [exPart, ...rest] = line.split("|");
    const parts = exPart.trim().split(/\s+/);
    const w = parts.shift();
    if (!w) return;
    const meaning = parts.join(" ") || "（未填释义）";
    qs.push({
      id: base + i,
      type: "vocabulary", subject: "subj-eng", subSubject: "ss-word", chapter: bookId,
      kps: [bookName], tags: ["other"],
      titleTex: w,
      solutionTex: meaning,
      note: rest.join("|").trim(),
      wrongAnswer: "", marks: {}, createdAt: now + i,
      urgent: false, calcWeak: false, needConsolidate: false, imgs: []
    });
  });
  if (!qs.length) { toast("没有解析出有效单词", "error"); return; }
  API.saveQuestionsBatch(qs)
    .then(() => {
      qs.forEach(q => questions.push(q));
      qidSeq = Math.max(qidSeq, ...qs.map(q => q.id));
      closeModal();
      toast(`已导入 ${qs.length} 个单词到「${bookName}」`, "success");
      renderWordPanel();
    })
    .catch(e => toast("导入失败：" + e.message, "error"));
}

/* ---------- 单词卡复习 ---------- */
let wordQueue = [];   // [{ q, misses }]
let wordIdx = 0;
let wordStats = { know: 0, fuzzy: 0, miss: 0 };
let wordSession = false;

/* 队列 = 到期复习词（SM-2，按到期时间；仅已有复习记录的词）→ 新词补足每日上限（按词书顺序） */
function startWordReview() {
  const list = wordQuestions();
  if (!list.length) { toast("词书还是空的：先在设置页导入六级核心词 3000", "error"); return; }
  const due = list.filter(q => logsOf(q.id).length > 0 && isDue(q.id)).sort((a, b) => scheduleOf(a.id).dueAt - scheduleOf(b.id).dueAt);
  const fresh = list.filter(q => logsOf(q.id).length === 0).sort((a, b) => a.createdAt - b.createdAt);
  const newLimit = Math.max(1, (wordPlan && wordPlan.newPerDay) || 50);
  const freshTake = fresh.slice(0, newLimit);
  if (!due.length && !freshTake.length) { toast("今日单词已全部完成 🎉 明天再来", "success"); return; }
  wordQueue = [...due, ...freshTake].map(q => ({ q, misses: 0 }));
  wordIdx = 0;
  wordStats = { know: 0, fuzzy: 0, miss: 0 };
  wordSession = true;
  $("#word-config").style.display = "none";
  $("#word-play").style.display = "";
  $("#word-done").style.display = "none";
  renderWordCard();
}

function renderWordCard() {
  if (wordIdx >= wordQueue.length) { finishWordSession(); return; }
  const q = wordQueue[wordIdx].q;
  $("#word-pos").textContent = `第 ${wordIdx + 1} / ${wordQueue.length} 词${wordQueue[wordIdx].misses ? `（回炉 ×${wordQueue[wordIdx].misses}）` : ""}`;
  $("#word-front").style.display = "";
  $("#word-back").style.display = "none";
  $("#word-show-ans").style.display = "";
  $("#word-rate").style.display = "none";
  $("#word-word").textContent = q.titleTex;
  $("#word-meaning").innerHTML = `<div class="katex-render" data-tex="${esc(q.solutionTex || "")}"></div>`;
  renderMath($("#word-meaning"));
  $("#word-example").innerHTML = q.note ? `<div class="small muted mt-8">${esc(q.note)}</div>` : "";
  window.__curWord = q;
}

function flipWord() {
  $("#word-front").style.display = "none";
  $("#word-back").style.display = "";
  $("#word-show-ans").style.display = "none";
  $("#word-rate").style.display = "flex";
}

function wordRate(grade) {
  const item = wordQueue[wordIdx];
  if (!item) return;
  const q = item.q;
  // 自评落库（认识=ok / 模糊=half / 不认识=fail → 驱动 SM-2）
  const result = grade === "know" ? "ok" : grade === "fuzzy" ? "half" : "fail";
  const log = { id: ++reviewSeq, qid: q.id, at: Date.now(), result };
  reviewLogs.push(log);
  apiCall(API.saveReviewLog(log));
  if (result === "fail") { q.urgent = true; apiCall(API.updateQuestion(q)); }
  wordStats[grade]++;
  // 回炉：模糊/不认识重新排到队尾，本轮内再过一遍
  if (grade !== "know") {
    item.misses++;
    wordQueue.splice(wordIdx, 1);
    wordQueue.push(item);
  } else {
    wordQueue.splice(wordIdx, 1);
  }
  renderWordCard();
}

function finishWordSession() {
  wordSession = false;
  $("#word-play").style.display = "none";
  $("#word-done").style.display = "";
  const total = wordStats.know + wordStats.fuzzy + wordStats.miss;
  $("#word-done-stats").innerHTML = `
    <div class="grid grid-3">
      <div class="stat-card"><div class="stat-label">✅ 认识</div><div class="stat-value" style="color:var(--success);">${wordStats.know}</div></div>
      <div class="stat-card"><div class="stat-label">🟡 模糊（已回炉）</div><div class="stat-value" style="color:#B97700;">${wordStats.fuzzy}</div></div>
      <div class="stat-card"><div class="stat-label">❌ 不认识（已回炉）</div><div class="stat-value" style="color:var(--danger);">${wordStats.miss}</div></div>
    </div>
    <div class="small muted mt-8">本轮 ${total} 词 · 模糊/不认识的词本轮已重新过一遍 · 结果已计入间隔重复调度（明天优先复习）</div>`;
  renderWordPanel();
}

function wordExit() {
  wordSession = false;
  $("#word-play").style.display = "none";
  $("#word-config").style.display = "";
  renderWordPanel();
  go("dashboard");
}

/* 发音（当前单词卡） */
function speakWord() {
  const q = window.__curWord;
  if (!q) return;
  if (!("speechSynthesis" in window)) { toast("当前浏览器不支持语音", "error"); return; }
  const u = new SpeechSynthesisUtterance(q.titleTex);
  u.lang = "en-US";
  u.rate = 0.85;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ---------- 面板渲染（设置页词书状态 / 入口卡） ---------- */
function renderWordPanel() {
  const p = wordProgress();
  const el = $("#word-progress-info");
  if (el) el.textContent = `已学 ${p.learned} / ${p.total} 词 · 今日到期 ${p.due} 词`;
  const btn = $("#word-start-btn");
  if (btn) btn.textContent = p.total ? "🎴 背单词" : "🎴 背单词（先导入词书）";
  const cfg = $("#word-config");
  if (cfg) {
    const fresh = wordQuestions().filter(q => logsOf(q.id).length === 0).length;
    const limit = (wordPlan && wordPlan.newPerDay) || 50;
    cfg.innerHTML = `<div class="flex-between">
      <div class="small muted" id="word-progress-info"></div>
      <div class="flex" style="gap:8px;">
        <button class="btn btn-primary btn-lg" id="word-start-btn" onclick="startWordReview()">🎴 背单词</button>
        <button class="btn btn-lg" onclick="wordExit()">退出</button>
      </div>
    </div>
    <div class="small muted mt-8">队列：今日到期复习词（SM-2 优先）+ 新词补足（每日上限 ${limit}，今日新词还剩 ${Math.max(0, limit - Math.min(fresh, limit)) > 0 ? "可学" : "已学满"}）。空格翻卡 · 1/2/3 自评 · 不认识自动回炉。</div>`;
    const infoEl = $("#word-progress-info");
    if (infoEl) infoEl.textContent = `已学 ${p.learned} / ${p.total} 词 · 今日到期 ${p.due} 词`;
  }
}

/* 设置页背单词卡：每日新词上限保存 */
function saveWordPlan() {
  const v = Number($("#wp-new-per-day")?.value);
  if (!(v >= 1 && v <= 500)) { toast("每日新词数需在 1~500 之间", "error"); return; }
  wordPlan = { ...(wordPlan || {}), newPerDay: v };
  apiCall(API.saveSettings({ wordPlan }));
  toast(`每日新词上限已设为 ${v} 词`, "success");
  renderWordPanel();
}

/* window 暴露 */
window.startWordReview = startWordReview;
window.flipWord = flipWord;
window.wordRate = wordRate;
window.speakWord = speakWord;
window.wordExit = wordExit;
window.importBuiltinWordbook = importBuiltinWordbook;
window.doImportBuiltinWordbook = doImportBuiltinWordbook;
window.openPasteWords = openPasteWords;
window.doPasteWords = doPasteWords;
window.renderWordPanel = renderWordPanel;
window.saveWordPlan = saveWordPlan;
