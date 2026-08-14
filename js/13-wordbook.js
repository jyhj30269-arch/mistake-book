/* ============================================================
   个人工作台 v1.21.0 · 13-wordbook.js（v1.20 对标不背单词升级，v1.21 独立成侧边栏页面）
   背单词模式：例句语境学习 / 单词详情（英释·同根·近义·双音标）/
   四种学习模式（快捷 / 看词选义 / 看义选词 / 听写）/
   每日队列（到期复习优先 + 新词补足）/ 错误回炉 / 三档统计
   依赖：本文件之前的 js/0X-*.js；wordPlan 状态在 02-state.js 声明。
   ============================================================ */

const WORD_BOOK_ID = "ch-w2";          // 内置词书章节 id（英语 → 单词 下）
const WORD_BOOK_NAME = "六级核心词 3000";

/* ---------- 词书数据 ---------- */
function wordQuestions() {
  return questions.filter(q => q.type === "vocabulary" && q.subject === "subj-eng" &&
    q.subSubject === "ss-word" && q.chapter === WORD_BOOK_ID);
}
/* 三档统计：认识（ok）/ 模糊（half）/ 不认识（fail），按每词最后一条自评 */
function wordProgress() {
  const list = wordQuestions();
  const last = {};
  reviewLogs.forEach(l => { if (list.some(q => q.id === l.qid)) last[l.qid] = l.result; });
  // 今日到期只统计「已学过且已到期」的词（未复习的新词不算到期，避免刚导入就显示全部到期）
  const stat = { know: 0, fuzzy: 0, miss: 0, total: list.length, learned: Object.keys(last).length, due: list.filter(q => logsOf(q.id).length > 0 && isDue(q.id)).length };
  Object.values(last).forEach(r => {
    if (r === "ok") stat.know++;
    else if (r === "half") stat.fuzzy++;
    else stat.miss++;
  });
  return stat;
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

/* ---------- 一键导入内置词书（升级版：英释/双音标/近义词/同根词） ---------- */
function importBuiltinWordbook() {
  const existing = wordQuestions().length;
  if (existing > 0) {
    openModal("词书已导入", `
      <div class="small">当前已导入 <b>${existing}</b> 个单词（旧版数据）。</div>
      <div class="small muted mt-8">升级版词书新增：英英释义 / 英美双音标 / 近义词 / 同根词。可点「重新导入」升级（会删除旧单词与其复习记录）。</div>`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-primary" onclick="closeModal();doReimportWordbook()">重新导入升级版</button>`);
    return;
  }
  openModal("导入六级核心词 3000", `
    <div class="small">将从内置词书导入 <b>3000</b> 个六级高频词（含释义 / 英英释义 / 例句 / 英美音标 / 近义词 / 同根词）。首次导入约需 10~30 秒。</div>
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
      marks: { te: w.te || "", uk: w.uk || "", syn: w.syn || [], rel: w.rel || [] },
      wrongAnswer: "", createdAt: now + i,
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

/* 重新导入升级版：删除旧词（含复习记录）→ 重新导入 */
function doReimportWordbook() {
  openModal("重新导入升级版词书", `
    <div class="small">将删除现有 <b>${wordQuestions().length}</b> 个旧单词（<b>含复习记录</b>），并导入升级版（含英英释义 / 英美音标 / 近义词 / 同根词）。</div>
    <div class="alert alert-danger mt-8">旧单词的自评进度会清空，从第 1 个词重新开始。确认继续？</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doReimportNow()">确认重新导入</button>`);
}
async function doReimportNow() {
  try {
    const old = wordQuestions();
    if (old.length) {
      const ids = old.map(q => q.id);
      await API.deleteQuestionsBatch(ids);
      questions = questions.filter(q => !ids.includes(q.id));
      reviewLogs = reviewLogs.filter(l => !ids.includes(l.qid));
    }
    await doImportBuiltinWordbook();
  } catch (e) {
    toast("重新导入失败：" + e.message, "error");
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
      marks: {},
      wrongAnswer: "", createdAt: now + i,
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

/* ---------- 单词卡复习（四模式） ---------- */
let wordQueue = [];   // [{ q, misses }]
let wordIdx = 0;
let wordStats = { know: 0, fuzzy: 0, miss: 0 };
let wordSession = false;
let wordMode = "quick"; // quick | meaning（看词选义）| word（看义选词）| dictation（听写）

const WORD_MODES = [
  { key: "quick", name: "⚡ 快捷", desc: "看词翻卡 · 三档自评" },
  { key: "meaning", name: "🔤 看词选义", desc: "看单词 · 4 选 1 释义" },
  { key: "word", name: "🔁 看义选词", desc: "看释义 · 4 选 1 单词" },
  { key: "dictation", name: "✍️ 听写", desc: "听发音 · 拼写单词" }
];

/* ---------- 独立页面入口（v1.21：侧边栏「🎴 背单词」） ---------- */
function openWordbook() {
  go("wordbook"); // go() 内会 renderWordPanel + showWordConfig
}
function showWordConfig() {
  const cfg = $("#word-config"), play = $("#word-play"), done = $("#word-done");
  if (cfg) cfg.style.display = "";
  if (play) play.style.display = "none";
  if (done) done.style.display = "none";
}

/* 队列 = 到期复习词（SM-2，仅已有记录的词）→ 新词补足每日上限 */
function startWordReview() {
  const list = wordQuestions();
  if (!list.length) { toast("词书还是空的：去 设置 → 📚 背单词 导入六级核心词 3000，或批量粘贴自定义词表", "error"); return; }
  const due = list.filter(q => logsOf(q.id).length > 0 && isDue(q.id)).sort((a, b) => scheduleOf(a.id).dueAt - scheduleOf(b.id).dueAt);
  const fresh = list.filter(q => logsOf(q.id).length === 0).sort((a, b) => a.createdAt - b.createdAt);
  const newLimit = Math.max(1, (wordPlan && wordPlan.newPerDay) || 50);
  const freshTake = fresh.slice(0, newLimit);
  if (!due.length && !freshTake.length) { toast("今日单词已全部完成 🎉 明天再来", "success"); return; }
  if (currentView !== "wordbook") go("wordbook");
  wordMode = (wordPlan && wordPlan.mode) || "quick";
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
  const item = wordQueue[wordIdx];
  const q = item.q;
  const m = q.marks || {};
  const ctx = (q.note || "").split("\n")[0] || "";
  const isNew = logsOf(q.id).length === 0;
  window.__curWord = q;
  // 统一隐藏各区
  ["word-context", "word-front", "word-back", "word-detail", "word-choices", "word-dictation", "word-rate", "word-show-ans"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  $("#word-pos").textContent = `第 ${wordIdx + 1} / ${wordQueue.length} 词${item.misses ? `（回炉 ×${item.misses}）` : ""} · ${WORD_MODES.find(x => x.key === wordMode)?.name || "快捷"}`;

  // 听写模式：自动播放发音 + 拼写输入
  if (wordMode === "dictation") {
    $("#word-dictation").style.display = "";
    $("#word-dict-input").value = "";
    setTimeout(() => { const i = $("#word-dict-input"); if (i && wordSession) i.focus(); }, 50);
    speakWord();
    return;
  }
  // 选义模式：显示单词 + 4 个释义选项
  if (wordMode === "meaning") {
    $("#word-front").style.display = "";
    $("#word-word").textContent = q.titleTex;
    $("#word-word-ph").textContent = (m.uk || m.ph) ? "［" + (m.uk || m.ph) + "］" : "";
    const correct = q.solutionTex.replace(/\s*［.*］$/, "").trim();
    const others = wordQuestions().filter(x => x.id !== q.id).map(x => x.solutionTex.replace(/\s*［.*］$/, "").trim()).filter(t => t && t !== correct);
    const pool = [correct, ...others.slice(0, 3)];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    window.__wordChoices = pool;
    $("#word-choices").style.display = "";
    $("#word-choice-list").innerHTML = pool.map((t, i) =>
      `<button class="btn choice-btn" data-i="${i}" onclick="wordChoice(${i})"><b>${i + 1}.</b> ${esc(t)}</button>`).join("");
    return;
  }
  // 选词模式：显示释义 + 4 个单词选项
  if (wordMode === "word") {
    const correct = q.titleTex;
    // 清除上一词翻卡残留（大字/例句/详情）
    $("#word-word-big").textContent = "";
    $("#word-example").innerHTML = "";
    $("#word-detail").innerHTML = "";
    $("#word-detail").style.display = "none";
    $("#word-back").style.display = "";
    $("#word-mean-text").innerHTML = `<div class="katex-render" data-tex="${esc(q.solutionTex.replace(/\s*［.*］$/, "").trim())}"></div>`;
    renderMath($("#word-mean-text"));
    const others = wordQuestions().filter(x => x.id !== q.id).map(x => x.titleTex).filter(t => t && t !== correct);
    const pool = [correct, ...others.slice(0, 3)];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    window.__wordChoices = pool;
    $("#word-choices").style.display = "";
    $("#word-choice-list").innerHTML = pool.map((t, i) =>
      `<button class="btn choice-btn" data-i="${i}" onclick="wordChoice(${i})"><b>${i + 1}.</b> ${esc(t)}</button>`).join("");
    return;
  }
  // 快捷模式：例句语境（新词先看例句猜义）
  $("#word-show-ans").style.display = "";
  if (isNew && ctx) {
    $("#word-context").style.display = "";
    $("#word-context-text").textContent = `“${ctx}”`;
    $("#word-context-hint").textContent = "这是这个词的英文例句——先猜猜它在句中的意思，然后翻卡";
  } else {
    $("#word-front").style.display = "";
    $("#word-word").textContent = q.titleTex;
    const m2 = q.marks || {};
    $("#word-word-ph").textContent = (m2.ph || m2.uk) ? "［" + (m2.ph || m2.uk) + "］" : "";
  }
}

function flipWord() {
  const q = window.__curWord;
  const m = q.marks || {};
  ["word-context", "word-front", "word-show-ans"].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  $("#word-back").style.display = "";
  $("#word-word-big").textContent = q.titleTex;
  $("#word-mean").innerHTML = `<div class="katex-render" data-tex="${esc(q.solutionTex || "")}"></div>`;
  renderMath($("#word-mean"));
  $("#word-example").innerHTML = q.note ? `<div class="small muted mt-8">${esc(q.note)}</div>` : "";
  // 详情区（英释/双音标/近义词/同根词）
  const detailParts = [];
  if (m.te) detailParts.push(`<div class="small muted">英英释义：${esc(m.te)}</div>`);
  if (m.uk || m.ph) detailParts.push(`<div class="small muted">音标：美 ${esc(m.ph || "—")} · 英 ${esc(m.uk || "—")}</div>`);
  if (m.syn && m.syn.length) detailParts.push(`<div class="small muted">近义词：${m.syn.map(esc).join(" / ")}</div>`);
  if (m.rel && m.rel.length) detailParts.push(`<div class="small muted">同根词：${m.rel.map(r => `${esc(r.w)}${r.t ? "（" + esc(r.t.split("；")[0].slice(0, 12)) + "）" : ""}`).join(" · ")}</div>`);
  $("#word-detail").innerHTML = detailParts.length ? `<div class="divider mt-8"></div><div class="mt-8" style="display:flex;flex-direction:column;gap:6px;">${detailParts.join("")}</div>` : "";
  $("#word-detail").style.display = detailParts.length ? "" : "none";
  $("#word-rate").style.display = "flex";
}

/* ---------- 三档自评（快捷模式） ---------- */
function wordRate(grade) {
  const item = wordQueue[wordIdx];
  if (!item) return;
  const q = item.q;
  const result = grade === "know" ? "ok" : grade === "fuzzy" ? "half" : "fail";
  commitWordGrade(q, result);
  wordStats[grade]++;
  if (grade !== "know") {
    item.misses++;
    wordQueue.splice(wordIdx, 1);
    wordQueue.push(item);
  } else {
    wordQueue.splice(wordIdx, 1);
  }
  renderWordCard();
}

/* 自评落库（ok/half/fail → SM-2） */
function commitWordGrade(q, result) {
  const log = { id: ++reviewSeq, qid: q.id, at: Date.now(), result };
  reviewLogs.push(log);
  apiCall(API.saveReviewLog(log));
  if (result === "fail") { q.urgent = true; apiCall(API.updateQuestion(q)); }
}

/* ---------- 选义 / 选词模式 ---------- */
function wordChoice(i) {
  const pool = window.__wordChoices || [];
  const picked = pool[i];
  const q = window.__curWord;
  const correct = wordMode === "meaning"
    ? q.solutionTex.replace(/\s*［.*］$/, "").trim()
    : q.titleTex;
  const item = wordQueue[wordIdx];
  if (picked === correct) {
    toast("✅ 正确", "success");
    commitWordGrade(q, "ok");
    wordStats.know++;
    wordQueue.splice(wordIdx, 1);
  } else {
    toast(`❌ 选错了：${correct}`, "error");
    commitWordGrade(q, "fail");
    wordStats.miss++;
    item.misses++;
    wordQueue.splice(wordIdx, 1);
    wordQueue.push(item);
  }
  renderWordCard();
}

/* ---------- 听写模式 ---------- */
function dictationCheck() {
  const q = window.__curWord;
  const item = wordQueue[wordIdx];
  const input = $("#word-dict-input").value.trim();
  const correct = q.titleTex.trim();
  if (input.toLowerCase() === correct.toLowerCase()) {
    toast("✅ 拼写正确", "success");
    commitWordGrade(q, "ok");
    wordStats.know++;
    wordQueue.splice(wordIdx, 1);
    renderWordCard();
  } else {
    toast(`❌ 拼写错误：${correct}`, "error");
    commitWordGrade(q, "fail");
    wordStats.miss++;
    item.misses++;
    wordQueue.splice(wordIdx, 1);
    wordQueue.push(item);
    $("#word-dict-answer").innerHTML = `<div class="alert alert-warn mt-8">正确答案：<b>${esc(correct)}</b> · ${esc(q.solutionTex.replace(/\s*［.*］$/, ""))}</div>`;
    const idx = wordIdx;
    setTimeout(() => { $("#word-dict-answer").innerHTML = ""; if (wordSession && wordIdx === idx) renderWordCard(); }, 1800);
  }
}

function finishWordSession() {
  wordSession = false;
  $("#word-play").style.display = "none";
  $("#word-done").style.display = "";
  const total = wordStats.know + wordStats.fuzzy + wordStats.miss;
  $("#word-done-stats").innerHTML = `
    <div class="grid grid-3">
      <div class="stat-card"><div class="stat-label">✅ 认识/正确</div><div class="stat-value" style="color:var(--success);">${wordStats.know}</div></div>
      <div class="stat-card"><div class="stat-label">🟡 模糊（已回炉）</div><div class="stat-value" style="color:#B97700;">${wordStats.fuzzy}</div></div>
      <div class="stat-card"><div class="stat-label">❌ 错误（已回炉）</div><div class="stat-value" style="color:var(--danger);">${wordStats.miss}</div></div>
    </div>
    <div class="small muted mt-8">本轮 ${total} 词 · 错误/模糊的词本轮已重新过一遍 · 结果已计入间隔重复调度（明天优先复习）</div>`;
  renderWordPanel();
}

function wordExit() {
  wordSession = false;
  renderWordPanel();
  showWordConfig();
}

/* 发音（当前单词卡 / 听写） */
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

/* ---------- 面板渲染（词书状态 + 模式选择） ---------- */
function renderWordPanel() {
  const p = wordProgress();
  const cfg = $("#word-config");
  const tag = $("#word-page-tag");
  if (tag) tag.textContent = p.total ? `已学 ${p.learned}/${p.total} · 今日到期 ${p.due}` : "词书未导入";
  if (cfg) {
    const fresh = wordQuestions().filter(q => logsOf(q.id).length === 0).length;
    const limit = (wordPlan && wordPlan.newPerDay) || 50;
    const curMode = (wordPlan && wordPlan.mode) || "quick";
    const todayNew = Math.min(limit, fresh); // 今日实际可取的新词数（未学词不足上限时如实显示）
    cfg.innerHTML = `
      <div class="card-head"><div class="card-title">🎴 背单词</div><span class="tag">六级核心词 3000</span></div>
      <div class="flex-between">
        <div class="small muted">已学 <b>${p.learned}</b> / ${p.total} 词 · 今日到期 <b>${p.due}</b> 词 · ✅${p.know} 🟡${p.fuzzy} ❌${p.miss} · 今日新词 <b>${todayNew}</b>/${limit}</div>
        <div class="flex" style="gap:8px;">
          <button class="btn btn-primary btn-lg" onclick="startWordReview()">开始背单词</button>
          <button class="btn btn-lg" onclick="go('dashboard')">返回仪表盘</button>
        </div>
      </div>
      ${p.total === 0 ? `
        <div class="alert alert-warn mt-8">
          词书为空。点「⬇ 一键导入词书」导入内置六级核心词 3000（含释义/例句/音标/近义词/同根词），或「📋 批量粘贴导入」自己的词表：
          <div class="flex mt-8" style="gap:8px;">
            <button class="btn btn-sm" onclick="importBuiltinWordbook()">⬇ 一键导入词书</button>
            <button class="btn btn-sm" onclick="openPasteWords()">📋 批量粘贴导入</button>
          </div>
        </div>` : ""}
      <div class="divider mt-8"></div>
      <div class="field mt-8">
        <label>学习模式</label>
        <div class="flex" id="word-mode-pick" style="flex-wrap:wrap;">
          ${WORD_MODES.map(m => `<span class="chip ${curMode === m.key ? "on" : ""}" data-v="${m.key}" title="${m.desc}" onclick="setWordMode('${m.key}')">${m.name}</span>`).join("")}
        </div>
        <div class="small muted mt-8">队列：今日到期复习词（SM-2 优先）+ 新词补足每日上限（${limit}）。空格翻卡 · 1/2/3 自评（选义/选词 1-4）· 听写回车判定 · 错误自动回炉。</div>
      </div>`;
  }
}

function setWordMode(k) {
  if (!WORD_MODES.some(m => m.key === k)) return;
  wordPlan = { ...(wordPlan || { newPerDay: 50 }), mode: k };
  apiCall(API.saveSettings({ wordPlan }));
  $$("#word-mode-pick .chip").forEach(c => c.classList.toggle("on", c.dataset.v === k));
  toast(`已切换为「${WORD_MODES.find(m => m.key === k).name}」模式`, "success");
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
window.openWordbook = openWordbook;
window.startWordReview = startWordReview;
window.flipWord = flipWord;
window.wordRate = wordRate;
window.wordChoice = wordChoice;
window.dictationCheck = dictationCheck;
window.speakWord = speakWord;
window.wordExit = wordExit;
window.importBuiltinWordbook = importBuiltinWordbook;
window.doImportBuiltinWordbook = doImportBuiltinWordbook;
window.doReimportWordbook = doReimportWordbook;
window.doReimportNow = doReimportNow;
window.openPasteWords = openPasteWords;
window.doPasteWords = doPasteWords;
window.renderWordPanel = renderWordPanel;
window.saveWordPlan = saveWordPlan;
window.setWordMode = setWordMode;
