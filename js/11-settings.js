/* ============================================================
   个人工作台 v1.19.0 · 11-settings.js（由 app.js 拆分）
   设置（提醒/主题开关/OCR 配置/知识点管理/导出导入 CSV/备份恢复）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 设置 ---------------- */
let remindOn = true;
let remindDate = "";      // 上次提醒日期（存服务端 settings）
let reviewResume = null;  // 复习断点（存服务端 settings）
let theme = "light"; // 深色/浅色（存服务端 settings）
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const el = $("#theme-switch");
  if (el) el.textContent = theme === "dark" ? "切换到浅色" : "切换到深色";
}
function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme();
  apiCall(API.saveSettings({ theme }));
  toast(theme === "dark" ? "已切换到深色模式 🌙" : "已切换到浅色模式 ☀️");
}
function selectDefaultNum(v) {
  reviewCfg.num = Number(v);
  apiCall(API.saveSettings({ reviewCfg }));
  $$("#rev-num-default .chip").forEach(x => x.classList.toggle("on", x.dataset.v === String(v)));
  toast(`默认抽题数量已设为 ${v} 题`, "success");
}
function toggleRemind() {
  remindOn = !remindOn;
  const el = $("#remind-switch");
  el.textContent = remindOn ? "已开启" : "已关闭";
  el.style.background = remindOn ? "var(--success-light)" : "#F1F3F7";
  el.style.color = remindOn ? "var(--success)" : "var(--text-3)";
  apiCall(API.saveSettings({ remindOn }));
  toast(remindOn ? "打开应用时提醒已开启" : "提醒已关闭");
}
function demoNotify() {
  if ("Notification" in window) {
    if (Notification.permission !== "granted") Notification.requestPermission();
    const unmastered = questions.length - questions.filter(q => displayMastery(q.id).lv.key === "blue").length;
    if (Notification.permission === "granted") new Notification("个人工作台", { body: `今天该复习错题了，当前共有 ${unmastered} 道未掌握题目` });
  }
  toast("演示通知（浏览器可能要求授权）");
}

/* 打开 App 时提醒：今天还没复习过则弹一次（同一天不重复，日期存服务端） */
function remindCheckToday() {
  if (!remindOn) return;
  const today = fmtDate(Date.now());
  if (remindDate === today) return;
  const reviewed = reviewLogs.some(l => fmtDate(l.at) === today);
  if (!reviewed) {
    remindDate = today;
    apiCall(API.saveSettings({ remindDate: today }));
    openModal("📌 今日复习提醒", `
      <div class="small">今天还没有复习记录。打开 App 是复习的最好时机，去抽几题吧。</div>`,
      `<button class="btn" onclick="closeModal()">稍后再说</button>
       <button class="btn btn-primary" onclick="closeModal();goDashSection('review')">去复习</button>`
    );
  }
}

function renderSettings() {
  $$("#rev-num-default .chip").forEach(c => c.onclick = () => selectDefaultNum(c.dataset.v));
  $$("#rev-num-default .chip").forEach(x => x.classList.toggle("on", x.dataset.v === String(reviewCfg.num)));
  const vEl = $("#app-version");
  if (vEl) vEl.textContent = "v" + APP_VERSION;
  const apiTag = $("#api-mode-tag");
  if (apiTag) apiTag.textContent = serverDown ? "API: 本地服务未启动" : "API: 本地 SQLite";
  const examEl = $("#exam-date");
  if (examEl) examEl.value = examDate;
  const modHot = $("#mod-hot"), modBm = $("#mod-bookmarks");
  if (modHot) modHot.checked = moduleOn.hot !== false;
  if (modBm) modBm.checked = moduleOn.bookmarks !== false;
  const awayEl = $("#away-policy");
  if (awayEl) awayEl.value = study.awayPolicy || "auto";
  const wpEl = $("#wp-new-per-day");
  if (wpEl) wpEl.value = (wordPlan && wordPlan.newPerDay) || 50;
  loadOcrConfig();
  renderSettingsTree();
}

/* ---------- 知识点管理（v1.19 可折叠树：科目→子科目→章节→知识点） ---------- */
let treeOpen = null; // 展开状态缓存 { [nodeId]: true }；null = 未初始化
const TREE_DEFAULT_OPEN = 1; // 默认展开层级：科目展开到子科目一层

function treeIsOpen(id) {
  if (!treeOpen) return false;
  return !!treeOpen[id];
}

function toggleTreeNode(id) {
  treeOpen = treeOpen || {};
  treeOpen[id] = !treeOpen[id];
  renderSettingsTree();
}

function renderSettingsTree() {
  const box = $("#settings-tree");
  if (!box) return;
  // 初始化：默认展开所有科目（显示到子科目一层）
  if (!treeOpen) {
    treeOpen = {};
    TREE.forEach(s => { treeOpen[s.id] = true; });
  }
  const row = (icon, name, id, btns, depth) => `
    <div class="flex-between tree-row" style="padding:${depth * 4 + 4}px 8px;cursor:pointer;" onclick="toggleTreeNode('${id}')" title="点击展开/收起">
      <span>${icon} ${esc(name)}</span>
      <div class="flex" style="gap:4px;" onclick="event.stopPropagation()">${btns}</div>
    </div>`;
  const kpRow = (k, chId) => `<div class="flex-between tree-row" style="padding:3px 8px 3px 20px;">
    <span class="small">${esc(k)}</span>
    <button class="btn btn-sm btn-danger" data-ch="${chId}" data-k="${esc(k)}" onclick="askDelKp(this)">删</button>
  </div>`;

  box.innerHTML = `
    <div class="flex-between mb-16" style="gap:12px;">
      <span class="small muted">点击科目/子科目/章节行可展开或收起（默认展开到子科目一层）。＋加/改/删 按钮在每行右侧。</span>
      <button class="btn btn-sm btn-primary" onclick="addSubject()">＋ 新增科目</button>
    </div>` +
    TREE.map(s => `
      ${row(treeIsOpen(s.id) ? "▾" : "▸", s.name, s.id,
        `<button class="btn btn-sm" onclick="addNode('${s.id}')">＋加子科目</button>
         <button class="btn btn-sm" onclick="renameNode('${s.id}')">改</button>
         <button class="btn btn-sm btn-danger" onclick="delNode('${s.id}')">删</button>`, 0)}
      ${treeIsOpen(s.id) ? s.children.map(ss => `
        ${row(treeIsOpen(ss.id) ? "▾" : "▸", "∟ " + ss.name, ss.id,
          `<button class="btn btn-sm" onclick="addNode('${ss.id}')">＋加章节</button>
           <button class="btn btn-sm" onclick="renameNode('${ss.id}')">改</button>
           <button class="btn btn-sm btn-danger" onclick="delNode('${ss.id}')">删</button>`, 1)}
        ${treeIsOpen(ss.id) ? ss.children.map(ch => `
          ${row(treeIsOpen(ch.id) ? "▾" : "▸", "∟ " + ch.name, ch.id,
            `<button class="btn btn-sm" onclick="addKp('${ch.id}')">＋加知识点</button>
             <button class="btn btn-sm" onclick="renameNode('${ch.id}')">改</button>
             <button class="btn btn-sm btn-danger" onclick="delNode('${ch.id}')">删</button>`, 2)}
          ${treeIsOpen(ch.id) ? ch.children.map(k => kpRow(k, ch.id)).join("") : ""}
        `).join("") : ""}
      `).join("") : ""}
    `).join("");
}

/* OCR 服务配置（模拟 / MinerU 真实识别） */
function loadOcrConfig() {
  const cfg = API.mineruConfig();
  const eng = $("#ocr-engine"); if (eng) eng.value = cfg.engine || "mock";
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" ? "引擎：MinerU（真实）" : "引擎：模拟";
}
function saveOcrConfig() {
  const cfg = {
    engine: $("#ocr-engine").value
  };
  localStorage.setItem("mb-mineru-config", JSON.stringify(cfg));
  const tag = $("#ocr-mode-tag");
  if (tag) tag.textContent = cfg.engine === "mineru" ? "引擎：MinerU（真实）" : "引擎：模拟";
  toast("OCR 配置已保存");
  testOcrConnection();
}
async function testOcrConnection() {
  const cfg = API.mineruConfig();
  if (cfg.engine !== "mineru") { toast("当前为模拟模式，未测试真实识别", "error"); return; }
  toast("正在测试 MinerU 连通性…");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 640, 200);
    ctx.fillStyle = "#000"; ctx.font = "36px sans-serif";
    ctx.fillText("Test 123 + x^2", 40, 110);
    const t0 = Date.now();
    const r = await API.ocrRecognize({ dataUrl: canvas.toDataURL("image/png"), name: "test.png" }, { isSolution: false });
    const cost = r.costSec || Math.round((Date.now() - t0) / 1000);
    openModal("MinerU 连通性测试通过", `
      <div class="small" style="line-height:2;">
        耗时：<b>${cost} 秒</b><br />
        识别来源：${r.source === "mineru" ? "MinerU（pipeline）" : r.source === "mineru-flash" ? "MinerU（flash）" : r.source}<br />
        识别文本：<span class="mono">${esc((r.titleTex || "").slice(0, 80))}</span>
      </div>`,
      `<button class="btn btn-primary" onclick="closeModal()">知道了</button>`
    );
  } catch (e) {
    openModal("MinerU 测试失败", `
      <div class="alert alert-danger">${esc(e.message)}</div>
      <div class="small muted">请检查 Token / API 地址，或把上面的错误信息发给开发者调整接口。</div>`,
      `<button class="btn btn-primary" onclick="closeModal()">知道了</button>`
    );
  }
}

function addNode(parentId) {
  const isSubject = TREE.some(s => s.id === parentId);
  openModal(isSubject ? "新增子科目" : "新增章节", `
    <div class="field"><label>名称</label><input class="input" id="new-node-name" placeholder="${isSubject ? "如：数学三 / 英语二" : "如：无穷级数"}" /></div>
    <div class="small muted">科目/子科目完全自定义，不写死（支持 数学一/二/三、英语一/二等）</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddNode('${parentId}')">添加</button>`
  );
}
function doAddNode(parentId) {
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  const subj = TREE.find(s => s.id === parentId);
  if (subj) subj.children.push({ id: "ss-" + Date.now(), name, children: [] });
  else {
    const ss = TREE.flatMap(s => s.children).find(c => c.id === parentId);
    if (ss) ss.children.push({ id: "ch-" + Date.now(), name, children: [] });
  }
  apiCall(API.saveTree(TREE));
  closeModal();
  renderSettings();
  toast("节点已添加（支持完全自定义）", "success");
}

function addSubject() {
  openModal("新增科目", `
    <div class="field"><label>科目名称</label><input class="input" id="new-node-name" placeholder="如：数学 / 英语 / 408" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddSubject()">添加</button>`
  );
}
function doAddSubject() {
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  if (TREE.some(s => s.name === name)) { toast("该科目已存在", "error"); return; }
  TREE.push({ id: "subj-" + Date.now(), name, children: [] });
  apiCall(API.saveTree(TREE)); closeModal(); renderSettings();
  toast("科目已添加", "success");
}

function addKp(chapterId) {
  openModal("新增知识点", `
    <div class="field"><label>知识点名称</label><input class="input" id="new-node-name" placeholder="如：无穷级数敛散性判断" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doAddKp('${chapterId}')">添加</button>`
  );
}
function doAddKp(chapterId) {
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === chapterId);
  const name = $("#new-node-name").value.trim();
  if (!ch || !name) return;
  if (ch.children.includes(name)) { toast("该知识点已存在", "error"); return; }
  ch.children.push(name);
  apiCall(API.saveTree(TREE)); closeModal(); renderSettings();
  toast("知识点已添加", "success");
}

function askDelKp(btn) {
  const chapterId = btn.dataset.ch;
  const name = btn.dataset.k;
  const qCount = questions.filter(q => q.kps.includes(name)).length;
  openModal("删除知识点", `
    <div class="small muted">${qCount ? `有 <b>${qCount}</b> 道题关联该知识点，删除后这些题将变为「未分类」。` : "确认删除该知识点？"}</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelKp('${chapterId}','${esc(name)}')">确认删除</button>`
  );
}

function doDelKp(chapterId, name) {
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === chapterId);
  if (!ch) return;
  ch.children = ch.children.filter(k => k !== name);
  const affected = questions.filter(q => q.kps.includes(name));
  affected.forEach(q => { q.kps = []; apiCall(API.updateQuestion(q)); });
  apiCall(API.saveTree(TREE));
  renderSettings();
  toast("知识点已删除，相关题目归入未分类", "success");
}

function renameNode(id) {
  const subj = TREE.find(s => s.id === id);
  let target = subj;
  if (!target) target = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (!target) target = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (!target) return;
  window.__renameId = id;
  openModal("重命名", `
    <div class="field"><label>新名称</label><input class="input" id="new-node-name" value="${esc(target.name)}" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doRenameNode()">保存</button>`
  );
}
function doRenameNode() {
  const id = window.__renameId;
  const name = $("#new-node-name").value.trim();
  if (!name) return;
  let target = TREE.find(s => s.id === id);
  if (!target) target = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (!target) target = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (!target) return;
  target.name = name;
  apiCall(API.saveTree(TREE)); closeModal(); renderSettings();
  toast("已重命名", "success");
}

function delNode(id) {
  const subj = TREE.find(s => s.id === id);
  if (subj) {
    const qCount = questions.filter(q => q.subject === id).length;
    if (qCount) { toast(`禁止删除：该科目下有 ${qCount} 道错题（RESTRICT 保护）`, "error"); return; }
    openModal("删除科目", `确认删除科目「${esc(subj.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelSubject('${id}')">确认删除</button>`);
    return;
  }
  const ss = TREE.flatMap(s => s.children).find(c => c.id === id);
  if (ss) {
    const qCount = questions.filter(q => q.subSubject === id).length;
    if (qCount) { toast(`禁止删除：该子科目下有 ${qCount} 道错题`, "error"); return; }
    if (ss.children.length) { toast("有子节点，禁止删除", "error"); return; }
    openModal("删除子科目", `确认删除子科目「${esc(ss.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelSubSubject('${id}')">确认删除</button>`);
    return;
  }
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.id === id);
  if (ch) {
    const qCount = questions.filter(q => q.chapter === id).length;
    openModal("删除章节", `${qCount ? `该章节下有 <b>${qCount}</b> 道错题，删除后这些题目将变为未分类。` : ""}确认删除章节「${esc(ch.name)}」？`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-danger" onclick="closeModal();doDelChapterById('${id}')">确认删除</button>`);
  }
}
function doDelSubject(id) {
  const i = TREE.findIndex(s => s.id === id);
  if (i >= 0) TREE.splice(i, 1);
  apiCall(API.saveTree(TREE)); renderSettings(); toast("科目已删除", "success");
}
function doDelSubSubject(id) {
  TREE.forEach(s => { s.children = s.children.filter(c => c.id !== id); });
  apiCall(API.saveTree(TREE)); renderSettings(); toast("子科目已删除", "success");
}
function doDelChapterById(id) {
  TREE.forEach(s => s.children.forEach(c => { c.children = c.children.filter(ch => ch.id !== id); }));
  const affected = questions.filter(q => q.chapter === id);
  affected.forEach(q => { q.chapter = ""; apiCall(API.updateQuestion(q)); });
  apiCall(API.saveTree(TREE)); renderSettings(); toast("章节已删除，相关题目归入未分类", "success");
}
function delChapter(ssId, name) {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === ssId);
  const ch = ss && ss.children.find(c => c.name === name);
  const qCount = questions.filter(q => q.chapter === ch.id).length;
  if (qCount) {
    openModal("删除章节", `<div class="small muted">该章节下有 ${qCount} 道错题，删除后这些题目将变为未分类，确认？</div>`,
      `<button class="btn" onclick="closeModal()">取消</button>
       <button class="btn btn-primary" onclick="doDelChapter('${ssId}','${esc(name)}')">确认删除</button>`);
  } else {
    doDelChapter(ssId, name);
  }
}
function doDelChapter(ssId, name) {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === ssId);
  ss.children = ss.children.filter(c => c.name !== name);
  const affected = questions.filter(q => q.chapter && !TREE.flatMap(s => s.children).some(c => c.children.some(ch => ch.id === q.chapter)));
  affected.forEach(q => { q.chapter = ""; apiCall(API.updateQuestion(q)); });
  apiCall(API.saveTree(TREE));
  closeModal();
  renderSettings();
  toast("章节已删除，相关题目归入未分类", "success");
}

function exportJSON() {
  const data = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    questions,
    reviewLogs,
    tree: TREE,
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
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mistake-book-backup-${fmtDate(Date.now())}.json`;
  a.click();
  toast("JSON 已导出（含题库、个人数据与复习记录）", "success");
}

/* P2：下载整库备份（VACUUM INTO 一致性快照，含账号与全部数据） */
async function backupDb() {
  try {
    const buf = await API.backupDb();
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = `mistake-book-backup-${fmtDate(Date.now())}.db`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 8000);
    toast("数据库备份已下载（含全部数据与账号）", "success");
  } catch (e) {
    toast(e.message || "备份失败", "error");
  }
}

/* ⑭ 从备份 .db 文件恢复（服务端校验 + 恢复前自备份） */
function handleRestoreFile(files) {
  const f = files && files[0];
  if (!f) return;
  if (f.size > 100 * 1024 * 1024) { toast("文件太大（限 100MB）", "error"); return; }
  window.__restoreFile = f;
  openModal("从备份恢复（危险操作）", `
    <div class="small">将用「${esc(f.name)}」覆盖当前数据库（恢复前服务端会自动备份当前库到 backups/）。请输入 <b>恢复</b> 确认：</div>
    <div class="field mt-16"><input class="input" id="restore-confirm" placeholder="输入「恢复」" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="doRestore()">确认恢复</button>`);
  $("#restore-file").value = "";
}

async function doRestore() {
  const f = window.__restoreFile;
  window.__restoreFile = null;
  const confirmInput = $("#restore-confirm");
  if (!confirmInput || confirmInput.value.trim() !== "恢复") { toast("需输入「恢复」二字", "error"); return; }
  closeModal();
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await API.restoreDb(f.name, reader.result);
      toast("恢复成功，正在重新加载数据…", "success");
      setTimeout(async () => {
        await loadLocal();
        go("dashboard");
        toast("已恢复备份数据", "success");
      }, 800);
    } catch (e) {
      toast(e.message || "恢复失败", "error");
    }
  };
  reader.readAsDataURL(f);
}

/* ---------------- 导入导出（真实实现） ---------------- */
/* 导入的题目对象字段规范化（补默认字段，防止缺 marks 等导致渲染崩溃） */
function normalizeQ(o) {
  return {
    id: o.id, type: o.type || "problem", subject: o.subject || "subj-math",
    subSubject: o.subSubject || "ss-gaoshu", chapter: o.chapter || "",
    kps: o.kps || [], tags: o.tags || [], note: o.note || "", marks: o.marks || {},
    wrongAnswer: o.wrongAnswer || "", titleTex: o.titleTex || "", solutionTex: o.solutionTex || "",
    createdAt: o.createdAt || Date.now(), urgent: !!o.urgent,
    calcWeak: !!o.calcWeak, needConsolidate: !!o.needConsolidate
  };
}

function handleImportFile(files) {
  const f = files && files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.questions)) throw new Error("缺少 questions 数组");
      window.__importData = data;
      showImportSummary(importPreview(data));
    } catch (e) {
      toast("导入文件解析失败：" + e.message, "error");
    }
  };
  reader.readAsText(f);
  $("#import-file").value = "";
}

/* ---------------- CSV 批量导入（题面,解析,错因,科目,子科目,章节,知识点;分号,标签;分号） ---------------- */
function handleCsvFile(files) {
  const f = files && files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCSV(String(reader.result));
      if (!rows.length) { toast("CSV 为空或格式不对（首行应为表头：题面,解析,错因,科目,子科目,章节,知识点,标签）", "error"); return; }
      let ok = 0, skip = 0;
      rows.forEach(r => {
        const titleTex = String(r["题面"] || r.title || "").trim();
        if (!titleTex) { skip++; return; }
        const q = mkQ({
          titleTex,
          solutionTex: String(r["解析"] || r.solution || "").trim(),
          wrongAnswer: String(r["错因"] || "").trim(),
          subject: findNodeName(String(r["科目"] || ""), 0) || "subj-math",
          subSubject: findNodeName(String(r["子科目"] || ""), 1) || "",
          chapter: findNodeName(String(r["章节"] || ""), 2) || "",
          kps: String(r["知识点"] || "").split(/[;；]/).map(s => s.trim()).filter(Boolean),
          tags: String(r["标签"] || "").split(/[;；]/).map(s => s.trim()).filter(Boolean)
            .map(t => { const m = TAGS.find(x => x.name.startsWith(t) || x.key === t); return m ? m.key : ""; }).filter(Boolean)
        });
        questions.push(q);
        apiCall(API.saveQuestion(q));
        ok++;
      });
      qPage = 1;
      renderQuestions();
      toast(`CSV 导入完成：新增 ${ok} 题${skip ? `，跳过 ${skip} 行（题面为空）` : ""}`, ok ? "success" : "error");
    } catch (e) {
      toast("CSV 解析失败：" + e.message, "error");
    }
  };
  reader.readAsText(f, "utf-8");
  $("#import-csv").value = "";
}

/* 按名称在知识点树中找节点 id（level: 0 科目 / 1 子科目 / 2 章节），找不到返回 "" */
function findNodeName(name, level) {
  const n = String(name || "").trim();
  if (!n) return "";
  if (level === 0) { const s = TREE.find(x => x.name === n); return s ? s.id : ""; }
  if (level === 1) { const ss = TREE.flatMap(s => s.children).find(c => c.name === n); return ss ? ss.id : ""; }
  const ch = TREE.flatMap(s => s.children).flatMap(c => c.children).find(c => c.name === n);
  return ch ? ch.id : "";
}

function parseCSV(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const row = {};
    head.forEach((h, i) => { if (h) row[h] = cells[i] || ""; });
    return row;
  });
}

function importPreview(data) {
  const existing = new Set(questions.map(q => norm(q.titleTex) + "|" + q.subject + "|" + q.type));
  let add = 0, upd = 0;
  data.questions.forEach(q => {
    const key = norm(q.titleTex) + "|" + q.subject + "|" + q.type;
    existing.has(key) ? upd++ : add++;
  });
  const logs = Array.isArray(data.reviewLogs) ? data.reviewLogs.length : 0;
  return { add, upd, logs, treeAdd: treeDiffCount(data.tree) };
}

function treeDiffCount(inTree) {
  if (!Array.isArray(inTree)) return 0;
  let n = 0;
  inTree.forEach(s => {
    const subj = TREE.find(x => x.id === s.id);
    if (!subj) { n++; return; }
    (s.children || []).forEach(c => {
      const ss = subj.children.find(y => y.id === c.id);
      if (!ss) { n++; return; }
      (c.children || []).forEach(ch => { if (!ss.children.includes(ch)) n++; });
    });
  });
  return n;
}

function showImportSummary(prev) {
  openModal("导入预检", `
    <div class="alert alert-info">解析完成，请确认以下导入摘要：</div>
    <div class="small" style="line-height:2;">
      将新增 <b>${prev.add}</b> 条题目（按 科目+类型+题面归一化 判定）<br />
      将更新 <b>${prev.upd}</b> 条（同题面已存在，覆盖解析/知识点/错因）<br />
      将导入 <b>${prev.logs}</b> 条复习记录（自动 ID 重映射 + 去重）<br />
      知识点树：将新增 <b>${prev.treeAdd}</b> 个节点（同名跳过）
    </div>
    <div class="divider"></div>
    <div class="small muted">默认「合并」保留现有数据；「覆盖」会清空现有数据，需输入确认文字。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="closeModal();doMergeImport()">确认合并</button>
     <button class="btn btn-danger" onclick="showOverwriteConfirm()">覆盖模式</button>`
  );
}

function mergeTree(inTree) {
  if (!Array.isArray(inTree)) return;
  inTree.forEach(s => {
    let subj = TREE.find(x => x.id === s.id);
    if (!subj) { subj = { id: s.id, name: s.name, children: [] }; TREE.push(subj); }
    (s.children || []).forEach(c => {
      let ss = subj.children.find(y => y.id === c.id);
      if (!ss) { ss = { id: c.id, name: c.name, children: [] }; subj.children.push(ss); }
      (c.children || []).forEach(ch => { if (!ss.children.includes(ch)) ss.children.push(ch); });
    });
  });
}

/* 合并导入：个人数据按 id / day 去重合并（不覆盖已有内容） */
function mergePersonal(p) {
  if (!p) return;
  const tids = new Set(personal.todos.map(t => t.id));
  (p.todos || []).forEach(t => { if (!tids.has(t.id)) { personal.todos.push(t); tids.add(t.id); } });
  const gids = new Set(personal.goals.map(g => g.id));
  (p.goals || []).forEach(g => { if (!gids.has(g.id)) { personal.goals.push(g); gids.add(g.id); } });
  const rdays = new Set(personal.reviews.map(r => r.day));
  (p.reviews || []).forEach(r => { if (!rdays.has(r.day)) { personal.reviews.push(r); rdays.add(r.day); } });
  const iids = new Set(personal.inbox.map(i => i.id));
  (p.inbox || []).forEach(i => { if (!iids.has(i.id)) { personal.inbox.push(i); iids.add(i.id); } });
  const bids = new Set(personal.bookmarks.map(b => b.id));
  (p.bookmarks || []).forEach(b => { if (!bids.has(b.id)) { personal.bookmarks.push(b); bids.add(b.id); } });
  personal.reviews.sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

function doMergeImport() {
  const data = window.__importData;
  if (!data) return;
  mergeTree(data.tree);
  mergePersonal(data.personal);
  const idMap = {};
  data.questions.forEach(q => {
    const hit = questions.find(x => x.subject === q.subject && x.type === q.type && norm(x.titleTex) === norm(q.titleTex));
    if (hit) {
      Object.assign(hit, normalizeQ(q), { id: hit.id, createdAt: hit.createdAt });
      idMap[q.id] = hit.id;
    } else {
      const newId = nextQid();
      idMap[q.id] = newId;
      questions.push(normalizeQ({ ...q, id: newId }));
    }
  });
  const seen = new Set(reviewLogs.map(l => l.qid + "|" + l.at + "|" + l.result));
  (data.reviewLogs || []).forEach(l => {
    const qid = idMap[l.qid];
    if (qid == null) return;
    const key = qid + "|" + l.at + "|" + l.result;
    if (seen.has(key)) return;
    seen.add(key);
    reviewLogs.push({ id: ++reviewSeq, qid, at: l.at, result: l.result });
  });
  window.__importData = null;
  persistLocal();
  toast("合并完成，复习记录已重映射", "success");
  go("dashboard");
}
function showOverwriteConfirm() {
  openModal("覆盖模式（危险操作）", `
    <div class="small muted">将清空现有数据并完整导入。请输入 <b>覆盖</b> 确认：</div>
    <div class="field mt-16"><input class="input" id="ov-confirm" placeholder="输入：覆盖" /></div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="doOverwrite()">确认覆盖</button>`
  );
}
function doOverwrite() {
  if ($("#ov-confirm").value.trim() !== "覆盖") { toast("需输入「覆盖」二字", "error"); return; }
  const data = window.__importData;
  if (!data) { closeModal(); return; }
  questions = [];
  reviewLogs = [];
  if (Array.isArray(data.tree) && data.tree.length) {
    TREE.length = 0;
    data.tree.forEach(s => TREE.push(s));
  }
  data.questions.forEach(q => questions.push(normalizeQ(q)));
  (data.reviewLogs || []).forEach(l => reviewLogs.push({ id: ++reviewSeq, qid: l.qid, at: l.at, result: l.result }));
  personal.todos = Array.isArray(data.personal && data.personal.todos) ? data.personal.todos : [];
  personal.goals = Array.isArray(data.personal && data.personal.goals) ? data.personal.goals : [];
  personal.reviews = Array.isArray(data.personal && data.personal.reviews) ? data.personal.reviews : [];
  personal.inbox = Array.isArray(data.personal && data.personal.inbox) ? data.personal.inbox : [];
  personal.bookmarks = Array.isArray(data.personal && data.personal.bookmarks) ? data.personal.bookmarks : [];
  personal.reviews.sort((a, b) => String(b.day).localeCompare(String(a.day)));
  if (data.study) {
    study.seconds = data.study.seconds || 0;
    study.blurPrompt = !!data.study.blurPrompt;
    study.perDay = data.study.perDay || {};
    if (["auto", "always", "never"].includes(data.study.awayPolicy)) study.awayPolicy = data.study.awayPolicy;
    if (Number(data.study.awayThresholdMin) > 0) study.awayThresholdMin = Number(data.study.awayThresholdMin);
  }
  if (typeof data.remindOn === "boolean") remindOn = data.remindOn;
  if (data.reviewCfg) reviewCfg = { subject: "all", sub: "all", chapter: "", lv: "all", num: 3, ...data.reviewCfg };
  // 覆盖导入：完整替换扩展状态（v1.15+ 字段），缺省回退默认值
  if (data.theme === "dark" || data.theme === "light") theme = data.theme; else theme = "light";
  if (typeof data.remindDate === "string") remindDate = data.remindDate; else remindDate = "";
  if (data.reviewResume && typeof data.reviewResume === "object") reviewResume = data.reviewResume; else reviewResume = null;
  if (typeof data.examDate === "string") examDate = data.examDate; else examDate = "";
  if (data.moduleOn && typeof data.moduleOn === "object") moduleOn = data.moduleOn; else moduleOn = {};
  reviewSets = Array.isArray(data.reviewSets) ? data.reviewSets : [];
  habits = Array.isArray(data.habits) ? data.habits : [];
  applyTheme();
  applyModuleVisibility();
  qidSeq = Math.max(100, ...questions.map(q => q.id || 0));
  window.__importData = null;
  persistLocal();
  closeModal();
  toast("已覆盖导入", "success");
  go("dashboard");
}

/* ---------------- 考研倒计时 & 模块开关（v1.18） ---------------- */
/* 学习计时离开策略（v1.18.2）：auto / always / never */
function saveAwayPolicy(v) {
  study.awayPolicy = ["auto", "always", "never"].includes(v) ? v : "auto";
  apiCall(API.saveSettings({ awayPolicy: study.awayPolicy, awayThresholdMin: study.awayThresholdMin }));
  const el = $("#away-policy");
  if (el) el.value = study.awayPolicy;
  toast(study.awayPolicy === "auto" ? "自动策略：离开 ≤5 分钟自动计入" : study.awayPolicy === "always" ? "已设为总是计入离开时间" : "已设为不计入离开时间", "success");
}

function saveExamDate() {
  examDate = $("#exam-date").value || "";
  apiCall(API.saveSettings({ examDate }));
  toast(examDate ? `已设置考试日期：${examDate}` : "已清除考试日期", "success");
  if (currentView === "dashboard") renderDashboard();
}

function toggleModule(key, on) {
  moduleOn[key] = !!on;
  apiCall(API.saveSettings({ moduleOn }));
  applyModuleVisibility();
  toast(on ? "模块已显示" : "模块已隐藏（数据保留，可随时恢复）", "success");
}

/* 按模块开关隐藏/恢复导航项（侧边栏 + 移动 Tab + 更多抽屉） */
function applyModuleVisibility() {
  ["hot", "bookmarks"].forEach(v => {
    const hide = moduleOn[v] === false;
    $$(`.nav-item[data-view="${v}"], .mobile-tabbar a[data-view="${v}"], #mobile-menu .nav-item[data-view="${v}"]`)
      .forEach(el => { el.style.display = hide ? "none" : ""; });
  });
}

/* ================= 个人工作台：今日概览 / 待办 / 目标 / 总结 / 健康 / 复盘 ================= */

