/* ============================================================
   个人工作台 v1.23.0 · 13-wordbook.js（v1.23 下拉子菜单分功能页 + 学习卡放大 + 下一个单词）
   侧边栏「背单词」展开下拉子菜单：开始学习 / 学习记录 / 困难单词本 / 查单词
   学习：单一卡片流（看词 → 翻卡 → 认识/模糊/不会 或「下一个」连续过词）
   困难单词本：一键收藏/移除，收藏词仍参与正常复习，可单独复习
   数据：今日新词/复习量、近 14 天每日记录、单词状态筛选
   附加：全局搜索、发音开关、进度云端保存（SQLite）
   依赖：本文件之前的 js/0X-*.js；wordPlan 状态在 02-state.js 声明。
   ============================================================ */

const WORD_BOOK_ID = "ch-w2";          // 内置词书章节 id（英语 → 单词 下）
const WORD_BOOK_NAME = "六级核心词 3000";

/* 功能页签（与侧边栏下拉子菜单一一对应） */
const WORD_TABS = [
  { key: "learn", name: "📖 开始学习" },
  { key: "data", name: "📊 学习记录" },
  { key: "fav", name: "⭐ 困难单词本" },
  { key: "search", name: "🔍 查单词" }
];
let wordTab = "learn"; // 当前功能页（持久化在 wordPlan.tab）

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
      marks: { te: w.te || "", uk: w.uk || "", ph: w.ph || "", syn: w.syn || [], rel: w.rel || [] },
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

/* ---------- 困难单词本（收藏） ---------- */
function isFav(q) { return !!(q.marks && q.marks.fav); }
function wordFavList() { return wordQuestions().filter(isFav); }
function favBtnHtml(q) { return isFav(q) ? "⭐ 取消收藏" : "☆ 收藏困难词"; }

/* 收藏/取消收藏（marks.fav 落库；收藏词仍参与正常复习队列） */
function toggleWordFav(q) {
  if (!q) return false;
  q.marks = q.marks || {};
  q.marks.fav = !q.marks.fav;
  apiCall(API.updateQuestion(q));
  toast(q.marks.fav ? "⭐ 已加入困难单词本（仍参与正常复习）" : "已移出困难单词本", q.marks.fav ? "success" : "");
  const fb = $("#word-fav-btn");
  if (fb && window.__curWord && window.__curWord.id === q.id) fb.innerHTML = favBtnHtml(q);
  if (wordTab === "fav") renderWordFav();
  else if (wordTab === "data") renderWordData();
  else if (wordTab === "learn") renderWordPanel();
  return q.marks.fav;
}
/* 卡片释义面的收藏按钮（当前词） */
function wordFavFromCur() {
  toggleWordFav(window.__curWord);
}
/* 列表/搜索/详情里的收藏按钮（按 id） */
function wordFavFromId(qid) {
  toggleWordFav(questions.find(x => x.id === qid));
}

/* 单独复习困难单词本：全部收藏词（不分到期与否） */
function reviewFavs() {
  const list = wordFavList();
  if (!list.length) { toast("困难单词本还是空的：学习时翻卡后点「☆ 收藏困难词」即可加入", "error"); return; }
  if (currentView !== "wordbook") go("wordbook");
  wordQueue = list.map(q => ({ q, misses: 0 }));
  wordIdx = 0;
  wordStats = { know: 0, fuzzy: 0, miss: 0 };
  wordSession = true;
  showWordPlay();
  renderWordCard();
}

/* ---------- 单词卡（单一卡片流：看词 → 翻卡 → 三档自评 / 下一个） ---------- */
let wordQueue = [];   // [{ q, misses }]
let wordIdx = 0;
let wordStats = { know: 0, fuzzy: 0, miss: 0 };
let wordSession = false;

/* ---------- 独立页面入口（侧边栏「🎴 背单词」下拉子菜单） ---------- */
function openWordbook(tab) {
  if (tab && WORD_TABS.some(t => t.key === tab)) wordTab = tab;
  else wordTab = (wordPlan && wordPlan.tab) || "learn";
  wordPlan = { ...(wordPlan || { newPerDay: 50 }), tab: wordTab };
  apiCall(API.saveSettings({ wordPlan }));
  go("wordbook");
}

/* 侧边栏下拉：展开/收起「背单词」子菜单 */
function toggleWordSub(e) {
  if (e) e.preventDefault();
  const wrap = e && e.currentTarget ? e.currentTarget.closest(".nav-sub-wrap") : null;
  if (wrap) wrap.classList.toggle("open");
}

/* 页面内切换功能页（与侧边栏子菜单同步） */
function showWordTab(tab) {
  if (!WORD_TABS.some(t => t.key === tab)) tab = "learn";
  wordTab = tab;
  wordPlan = { ...(wordPlan || { newPerDay: 50 }), tab };
  apiCall(API.saveSettings({ wordPlan }));
  ["word-config", "word-data", "word-fav", "word-search-pane"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const play = $("#word-play"), done = $("#word-done");
  if (play) play.style.display = "none";
  if (done) done.style.display = "none";
  if (tab === "learn") { renderWordPanel(); const el = $("#word-config"); if (el) el.style.display = ""; }
  else if (tab === "data") { renderWordData(); const el = $("#word-data"); if (el) el.style.display = ""; }
  else if (tab === "fav") { renderWordFav(); const el = $("#word-fav"); if (el) el.style.display = ""; }
  else { if (!$("#word-search-input")) renderWordSearchPane(); const el = $("#word-search-pane"); if (el) el.style.display = ""; }
  $$("#word-tabs button").forEach(b => b.classList.toggle("on", b.dataset.wt === tab));
  updateWordSub(tab);
}

/* 侧边栏子菜单高亮同步 */
function updateWordSub(tab) {
  $$("#word-sub .nav-sub-item, #word-sub-m .nav-sub-item").forEach(a => a.classList.toggle("active", a.dataset.wordTab === tab));
}

function showWordPlay() {
  ["word-config", "word-data", "word-fav", "word-search-pane"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const play = $("#word-play"), done = $("#word-done");
  if (play) play.style.display = "";
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
  wordQueue = [...due, ...freshTake].map(q => ({ q, misses: 0 }));
  wordIdx = 0;
  wordStats = { know: 0, fuzzy: 0, miss: 0 };
  wordSession = true;
  showWordPlay();
  renderWordCard();
}

function renderWordCard() {
  if (wordIdx >= wordQueue.length) { finishWordSession(); return; }
  const item = wordQueue[wordIdx];
  const q = item.q;
  const m = q.marks || {};
  window.__curWord = q;
  // 统一隐藏各区（翻卡按钮在单词面内部，随 word-front 一起显隐）
  ["word-front", "word-back", "word-rate"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  $("#word-pos").textContent = `第 ${wordIdx + 1} / ${wordQueue.length} 词${item.misses ? `（回炉 ×${item.misses}）` : ""}`;
  // 单词面：单词 + 音标
  $("#word-front").style.display = "";
  $("#word-word").textContent = q.titleTex;
  $("#word-word-ph").textContent = (m.ph || m.uk) ? "［" + (m.ph || m.uk) + "］" : "";
  // 清空上一词的释义面残留
  $("#word-word-big").textContent = "";
  $("#word-mean").innerHTML = "";
  $("#word-example").innerHTML = "";
  $("#word-detail").innerHTML = "";
  $("#word-detail").style.display = "none";
  $("#word-rate").style.display = "none";
  // 新词首刷自动读一遍发音（可关）
  if (logsOf(q.id).length === 0) speakWord(true);
}

function flipWord() {
  const q = window.__curWord;
  const m = q.marks || {};
  ["word-front"].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
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
  // 收藏按钮 + 自评区
  $("#word-fav-btn").innerHTML = favBtnHtml(q);
  $("#word-rate").style.display = "flex";
}

/* ---------- 三档自评（认识 / 模糊 / 不会） ---------- */
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

/* 下一个单词（= 记认识并前进，正面/背面均可一键连续过词） */
function nextWord() {
  wordRate("know");
}

/* 自评落库（ok/half/fail → SM-2） */
function commitWordGrade(q, result) {
  const log = { id: ++reviewSeq, qid: q.id, at: Date.now(), result };
  reviewLogs.push(log);
  apiCall(API.saveReviewLog(log));
  if (result === "fail") { q.urgent = true; apiCall(API.updateQuestion(q)); }
}

function finishWordSession() {
  wordSession = false;
  $("#word-play").style.display = "none";
  $("#word-done").style.display = "";
  ["word-config", "word-data", "word-fav", "word-search-pane"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const total = wordStats.know + wordStats.fuzzy + wordStats.miss;
  $("#word-done-stats").innerHTML = `
    <div class="grid grid-3">
      <div class="stat-card"><div class="stat-label">✅ 认识</div><div class="stat-value" style="color:var(--success);">${wordStats.know}</div></div>
      <div class="stat-card"><div class="stat-label">🟡 模糊（已回炉）</div><div class="stat-value" style="color:#B97700;">${wordStats.fuzzy}</div></div>
      <div class="stat-card"><div class="stat-label">❌ 不会（已回炉）</div><div class="stat-value" style="color:var(--danger);">${wordStats.miss}</div></div>
    </div>
    <div class="small muted mt-8">本轮 ${total} 词 · 模糊/不会的词本轮已重新过一遍 · 结果已计入间隔重复调度（明天优先复习）</div>`;
  renderWordPanel();
}

function wordExit() {
  wordSession = false;
  showWordTab(wordTab);
}

/* ---------- 发音（开关控制） ---------- */
function wordSoundOn() { return !wordPlan || wordPlan.sound !== false; }
function toggleWordSound() {
  const on = !wordSoundOn();
  wordPlan = { ...(wordPlan || { newPerDay: 50 }), sound: on };
  apiCall(API.saveSettings({ wordPlan }));
  toast(on ? "🔊 单词发音已开启" : "🔇 单词发音已关闭", on ? "success" : "");
  const sw = $("#wp-sound-switch");
  if (sw) sw.textContent = on ? "🔊 已开启" : "🔇 已关闭";
  if (wordTab === "learn") renderWordPanel();
}
/* silent=true 时静默失败（新词自动朗读），false 时提示用户 */
function speakWord(silent) {
  const q = window.__curWord;
  if (!q) return;
  if (!wordSoundOn()) { if (!silent) toast("🔇 发音已关闭：开始学习页「发音」按钮或 设置 → 📚 背单词 可开启"); return; }
  if (!("speechSynthesis" in window)) { toast("当前浏览器不支持语音", "error"); return; }
  const u = new SpeechSynthesisUtterance(q.titleTex);
  u.lang = "en-US";
  u.rate = 0.85;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
/* 列表/搜索/详情里对指定单词发音 */
function speakWordId(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  const prev = window.__curWord;
  window.__curWord = q;
  speakWord(false);
  window.__curWord = prev;
}
/* 只学一个词（详情弹窗「去学习」） */
function learnWordNow(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  if (currentView !== "wordbook") go("wordbook");
  wordQueue = [{ q, misses: 0 }];
  wordIdx = 0;
  wordStats = { know: 0, fuzzy: 0, miss: 0 };
  wordSession = true;
  showWordPlay();
  renderWordCard();
}

/* ---------- 学习记录面板（今日 / 历史 / 状态） ---------- */
function wordToday() {
  const list = wordQuestions();
  const today = fmtDate(Date.now());
  const ids = new Set(list.map(q => q.id));
  const todayLogs = reviewLogs.filter(l => ids.has(l.qid) && fmtDate(l.at) === today);
  let newToday = 0;
  list.forEach(q => { const f = logsOf(q.id)[0]; if (f && fmtDate(f.at) === today) newToday++; });
  return {
    newToday,
    reviewToday: todayLogs.length,
    dueNow: list.filter(q => logsOf(q.id).length > 0 && isDue(q.id)).length,
    favCount: wordFavList().length,
    streak: currentStreak()
  };
}

/* 近 N 天每日记录：新词量（首刷那天）+ 复习量 */
function wordDailyHistory(days = 14) {
  const ids = new Set(wordQuestions().map(q => q.id));
  const logs = reviewLogs.filter(l => ids.has(l.qid));
  const firstAt = {};
  logs.forEach(l => { if (!(l.qid in firstAt)) firstAt[l.qid] = l.at; });
  const byDay = {};
  logs.forEach(l => {
    const d = fmtDate(l.at);
    byDay[d] = byDay[d] || { date: d, review: 0, newW: 0 };
    byDay[d].review++;
  });
  Object.keys(firstAt).forEach(qid => {
    const d = fmtDate(firstAt[qid]);
    byDay[d] = byDay[d] || { date: d, review: 0, newW: 0 };
    byDay[d].newW++;
  });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = fmtDate(Date.now() - i * 86400000);
    out.push(byDay[d] || { date: d, review: 0, newW: 0 });
  }
  return out;
}

/* 状态：fresh 未学 / review 待复习 / mastered 已掌握（完全掌握且未到期）/ learning 学习中 */
let wordStatusTab = "all"; // all | review | fresh | mastered | fav
function wordStatusRows(filter) {
  const rows = wordQuestions().map(q => {
    const m = computeMastery(q.id);
    const s = scheduleOf(q.id);
    const state = !s.lastAt ? "fresh" : isDue(q.id) ? "review" : (m.lv.key === "blue" ? "mastered" : "learning");
    return { q, state, lv: m.lv, fav: isFav(q), lastAt: s.lastAt };
  });
  const order = { review: 0, fresh: 1, learning: 2, mastered: 3 };
  const filters = {
    all: () => true,
    review: r => r.state === "review",
    fresh: r => r.state === "fresh",
    mastered: r => r.state === "mastered",
    fav: r => r.fav
  };
  return rows.filter(filters[filter] || filters.all)
    .sort((a, b) => order[a.state] - order[b.state] || (a.lastAt || 0) - (b.lastAt || 0));
}
function setWordStatusTab(k) {
  wordStatusTab = k;
  renderWordData();
}

const WORD_STATUS_TABS = [
  { key: "all", name: "全部" },
  { key: "review", name: "⏰ 待复习" },
  { key: "fresh", name: "🆕 未学" },
  { key: "mastered", name: "✅ 已掌握" },
  { key: "fav", name: "⭐ 困难" }
];

function statusRowHtml(r) {
  const { q, lv, fav } = r;
  const m = q.marks || {};
  const dueText = !r.lastAt ? "未学" : (isDue(q.id) ? "今天到期" : nextDueText(q.id));
  return `
    <div class="flex-between word-row" style="padding:7px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;cursor:pointer;" onclick="openWordDetail(${q.id})" title="点开看详情">
        <b>${esc(q.titleTex)}</b> ${lvTag(lv, false)} <span class="small muted">${esc(m.ph || m.uk || "")}</span>
        <div class="small muted">${esc((q.solutionTex || "").replace(/\s*［.*］$/, ""))} · ${dueText}</div>
      </div>
      <div class="flex" style="gap:6px;">
        <button class="btn btn-sm" onclick="speakWordId(${q.id})" title="发音">🔊</button>
        <button class="btn btn-sm" onclick="wordFavFromId(${q.id})" title="${fav ? "移出困难单词本" : "加入困难单词本"}">${fav ? "⭐" : "☆"}</button>
      </div>
    </div>`;
}

function renderWordData() {
  const el = $("#word-data");
  if (!el) return;
  const t = wordToday();
  const hist = wordDailyHistory(14);
  const rows = wordStatusRows(wordStatusTab);
  const MAX_SHOW = 120;
  el.innerHTML = `
    <div class="card-head"><div class="card-title">📊 学习记录</div><span class="tag">自动记录 · 无需打卡</span></div>
    <div class="grid grid-4" style="margin-top:8px;">
      <div class="stat-card"><div class="stat-label">🆕 今日新词</div><div class="stat-value">${t.newToday}</div></div>
      <div class="stat-card"><div class="stat-label">🔁 今日复习</div><div class="stat-value">${t.reviewToday}</div></div>
      <div class="stat-card"><div class="stat-label">⏰ 今日到期</div><div class="stat-value">${t.dueNow}</div></div>
      <div class="stat-card"><div class="stat-label">🔥 连续打卡</div><div class="stat-value">${t.streak} 天</div></div>
    </div>
    <div class="divider mt-8"></div>
    <div class="small muted mb-8">📅 近 14 天每日记录（新词 / 复习）</div>
    <div style="max-height:200px;overflow:auto;">
      <table class="word-hist-table">
        <thead><tr><th>日期</th><th>🆕 新词</th><th>🔁 复习</th><th>合计</th></tr></thead>
        <tbody>
          ${hist.map(h => `<tr><td>${h.date}</td><td>${h.newW}</td><td>${h.review}</td><td>${h.newW + h.review}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="divider mt-8"></div>
    <div class="flex-between mt-8" style="flex-wrap:wrap;gap:8px;">
      <div class="small muted">🗂 单词状态（共 ${rows.length} 词）：</div>
      <div class="flex" style="gap:6px;flex-wrap:wrap;">
        ${WORD_STATUS_TABS.map(x => `<span class="chip ${wordStatusTab === x.key ? "on" : ""}" onclick="setWordStatusTab('${x.key}')">${x.name}</span>`).join("")}
      </div>
    </div>
    <div class="mt-8">
      ${rows.length ? rows.slice(0, MAX_SHOW).map(statusRowHtml).join("") +
        (rows.length > MAX_SHOW ? `<div class="small muted mt-8">…共 ${rows.length} 个，仅显示前 ${MAX_SHOW} 个</div>` : "")
        : `<div class="small muted">词书还没有单词：去「📖 开始学习」页一键导入或批量粘贴。</div>`}
    </div>`;
}

/* ---------- 困难单词本面板 ---------- */
function renderWordFav() {
  const el = $("#word-fav");
  if (!el) return;
  const list = wordFavList();
  el.innerHTML = `
    <div class="card-head"><div class="card-title">⭐ 困难单词本</div><span class="tag">${list.length} 词</span></div>
    <div class="flex-between mt-8" style="flex-wrap:wrap;gap:8px;">
      <div class="small muted">收藏的困难单词仍参与正常复习计划，可在这里单独浏览 / 复习全部收藏词。</div>
      <button class="btn btn-primary" onclick="reviewFavs()">▶ 复习困难单词（${list.length}）</button>
    </div>
    <div class="divider mt-8"></div>
    <div class="mt-8">
      ${list.length
        ? list.map(q => statusRowHtml({ q, lv: computeMastery(q.id).lv, fav: true, lastAt: scheduleOf(q.id).lastAt })).join("")
        : `<div class="small muted">还没有收藏的困难单词。学习时翻卡后点「☆ 收藏困难词」即可加入，也可以从「学习记录 → 单词状态」里点 ☆ 收藏。</div>`}
    </div>`;
}

/* ---------- 查单词面板（全局搜索） ---------- */
function renderWordSearchPane() {
  const el = $("#word-search-pane");
  if (!el) return;
  el.innerHTML = `
    <div class="card-head"><div class="card-title">🔍 查单词</div><span class="tag">词书全局搜索</span></div>
    <div class="mt-8">
      <input class="input" id="word-search-input" placeholder="输入 单词 / 中文释义 / 英英释义…" style="width:100%;max-width:520px;" autofocus oninput="wordSearch(this.value)" />
    </div>
    <div id="word-search-res"></div>
    <div class="small muted mt-8">支持按 单词 / 中文释义 / 英英释义 搜索；点词看详情，可发音、收藏、单独学习。</div>`;
}

function wordSearch(kw) {
  let box = $("#word-search-res");
  if (!box) { renderWordSearchPane(); box = $("#word-search-res"); }
  if (!box) return;
  kw = (kw || "").trim().toLowerCase();
  if (!kw) { box.innerHTML = ""; return; }
  const list = wordQuestions().filter(q => {
    const hay = ((q.titleTex || "") + " " + (q.solutionTex || "") + " " + ((q.marks && q.marks.te) || "")).toLowerCase();
    return hay.includes(kw);
  });
  if (!list.length) { box.innerHTML = `<div class="small muted mt-8">没有找到包含「${esc(kw)}」的单词</div>`; return; }
  box.innerHTML = `
    <div class="divider mt-8"></div>
    <div class="small muted mt-8">找到 <b>${list.length}</b> 个单词（点词看详情，可发音/收藏/单独学习）：</div>
    ${list.slice(0, 40).map(q => {
      const m = q.marks || {};
      return `
      <div class="flex-between word-row" style="padding:7px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;cursor:pointer;" onclick="openWordDetail(${q.id})">
          <b>${esc(q.titleTex)}</b> <span class="small muted">${esc(m.ph || m.uk || "")}</span>
          <div class="small muted">${esc((q.solutionTex || "").replace(/\s*［.*］$/, ""))}</div>
        </div>
        <div class="flex" style="gap:6px;">
          <button class="btn btn-sm" onclick="speakWordId(${q.id})" title="发音">🔊</button>
          <button class="btn btn-sm" onclick="wordFavFromId(${q.id})" title="${isFav(q) ? "移出困难单词本" : "加入困难单词本"}">${isFav(q) ? "⭐" : "☆"}</button>
          <button class="btn btn-sm btn-primary" onclick="learnWordNow(${q.id})">学习</button>
        </div>
      </div>`;
    }).join("")}
    ${list.length > 40 ? `<div class="small muted mt-8">…仅显示前 40 个，请用更精确的关键词</div>` : ""}`;
}

/* 单词详情弹窗 */
function openWordDetail(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  const m = q.marks || {};
  const detailParts = [];
  if (m.te) detailParts.push(`<div class="small muted">英英释义：${esc(m.te)}</div>`);
  if (m.uk || m.ph) detailParts.push(`<div class="small muted">音标：美 ${esc(m.ph || "—")} · 英 ${esc(m.uk || "—")}</div>`);
  if (m.syn && m.syn.length) detailParts.push(`<div class="small muted">近义词：${m.syn.map(esc).join(" / ")}</div>`);
  if (m.rel && m.rel.length) detailParts.push(`<div class="small muted">同根词：${m.rel.map(r => `${esc(r.w)}${r.t ? "（" + esc(r.t.split("；")[0].slice(0, 12)) + "）" : ""}`).join(" · ")}</div>`);
  const lv = computeMastery(q.id).lv;
  const dueLine = logsOf(q.id).length ? nextDueText(q.id) : "未学过 · 可随时首刷";
  openModal(`📖 ${esc(q.titleTex)}`, `
    <div class="word-word" style="font-size:26px;">${esc(q.titleTex)}</div>
    <div class="small muted mt-4">${lvTag(lv, false)} · ${dueLine}</div>
    <div class="mt-8" style="font-size:16px;line-height:1.7;">${esc((q.solutionTex || "").replace(/\s*［.*］$/, ""))}</div>
    ${q.note ? `<div class="small muted mt-8" style="white-space:pre-line;">${esc(q.note)}</div>` : ""}
    ${detailParts.length ? `<div class="divider mt-8"></div><div class="mt-8" style="display:flex;flex-direction:column;gap:6px;">${detailParts.join("")}</div>` : ""}`,
    `<button class="btn" onclick="closeModal()">关闭</button>
     <button class="btn" onclick="speakWordId(${q.id})">🔊 发音</button>
     <button class="btn ${isFav(q) ? "" : "btn-primary"}" onclick="closeModal();wordFavFromId(${q.id})">${isFav(q) ? "⭐ 取消收藏" : "☆ 收藏困难词"}</button>
     <button class="btn btn-primary" onclick="closeModal();learnWordNow(${q.id})">去学习</button>`);
}

/* ---------- 「开始学习」面板（词书状态 + 开始 + 发音开关） ---------- */
function renderWordPanel() {
  const p = wordProgress();
  const cfg = $("#word-config");
  const tag = $("#word-page-tag");
  if (tag) tag.textContent = p.total ? `已学 ${p.learned}/${p.total} · 今日到期 ${p.due}` : "词书未导入";
  if (cfg) {
    const fresh = wordQuestions().filter(q => logsOf(q.id).length === 0).length;
    const limit = (wordPlan && wordPlan.newPerDay) || 50;
    const todayNew = Math.min(limit, fresh); // 今日实际可取的新词数（未学词不足上限时如实显示）
    const t = wordToday();
    const soundOn = wordSoundOn();
    cfg.innerHTML = `
      <div class="card-head"><div class="card-title">📖 开始学习</div><span class="tag">六级核心词 3000</span></div>
      <div class="word-hero">
        <div class="word-hero-main">
          <div class="word-hero-num">已学 <b>${p.learned}</b> / ${p.total} 词</div>
          <div class="small muted mt-4">今日到期 <b>${p.due}</b> 词 · 今日新词 <b>${todayNew}</b>/${limit} · ✅${p.know} 🟡${p.fuzzy} ❌${p.miss}</div>
        </div>
        <button class="btn btn-primary btn-lg" onclick="startWordReview()">▶ 开始背单词</button>
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
      <div class="flex-between mt-8" style="flex-wrap:wrap;gap:8px;">
        <div class="flex" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" onclick="reviewFavs()" title="单独复习全部困难单词（不分到期与否）">⭐ 复习困难单词（${t.favCount}）</button>
          <button class="btn" onclick="toggleWordSound()" title="发音开关">${soundOn ? "🔊 发音：开" : "🔇 发音：关"}</button>
        </div>
      </div>
      <div class="small muted mt-8">卡片：看词 → 空格翻卡（释义/例句/拓展）→ 认识/模糊/不会 三档自评，或直接点「下一个 ›」连续过词（记认识）；模糊/不会自动回炉，结果计入间隔重复。收藏的困难词仍参与正常复习。</div>`;
  }
  renderWordData();
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
window.toggleWordSub = toggleWordSub;
window.showWordTab = showWordTab;
window.startWordReview = startWordReview;
window.reviewFavs = reviewFavs;
window.nextWord = nextWord;
window.flipWord = flipWord;
window.wordRate = wordRate;
window.speakWord = speakWord;
window.wordExit = wordExit;
window.importBuiltinWordbook = importBuiltinWordbook;
window.doImportBuiltinWordbook = doImportBuiltinWordbook;
window.doReimportWordbook = doReimportWordbook;
window.doReimportNow = doReimportNow;
window.openPasteWords = openPasteWords;
window.doPasteWords = doPasteWords;
window.renderWordPanel = renderWordPanel;
window.renderWordFav = renderWordFav;
window.renderWordSearchPane = renderWordSearchPane;
window.saveWordPlan = saveWordPlan;
window.toggleWordFav = toggleWordFav;
window.wordFavFromCur = wordFavFromCur;
window.wordFavFromId = wordFavFromId;
window.renderWordData = renderWordData;
window.setWordStatusTab = setWordStatusTab;
window.wordSearch = wordSearch;
window.openWordDetail = openWordDetail;
window.learnWordNow = learnWordNow;
window.speakWordId = speakWordId;
window.toggleWordSound = toggleWordSound;
window.wordSoundOn = wordSoundOn;
