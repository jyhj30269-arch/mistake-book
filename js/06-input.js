/* ============================================================
   个人工作台 v1.18.0 · 06-input.js（由 app.js 拆分）
   识别录入（上传/配对/OCR/校对/保存/单题重试/原图落库）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 单题录入 ---------------- */
let inputType = "problem";
let inputTags = new Set();
let __previewBound = false;

function fillInputSelects() {
  $("#input-tags").innerHTML = "";
  $("#input-subject").innerHTML = TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#input-type").querySelectorAll(".radio-pill").forEach(p => p.onclick = () => {
    inputType = p.dataset.t;
    $$("#input-type .radio-pill").forEach(x => x.classList.remove("on"));
    p.classList.add("on");
    renderInputKps();
  });
  $("#input-subject").onchange = fillInputSub;
  $("#input-subsub").onchange = fillInputChapter;
  $("#input-chapter").onchange = renderInputKps;
  TAGS.forEach(t => {
    const el = document.createElement("span");
    el.className = "chip";
    el.textContent = `${t.icon} ${t.name}`;
    el.onclick = () => {
      if (inputTags.has(t.key)) { inputTags.delete(t.key); el.classList.remove("on"); }
      else {
        const prim = inputTags.size === 0; // 第一个为主因
        inputTags.add(t.key);
        el.classList.add("on");
        if (prim) toast(`已设 ${t.name} 为主因（主因最多 1 个）`);
      }
    };
    $("#input-tags").appendChild(el);
  });
  fillInputSub();
  if (!__previewBound) { bindInputPreview(); __previewBound = true; }
}

function fillInputSub() {
  const subj = TREE.find(s => s.id === $("#input-subject").value);
  $("#input-subsub").innerHTML = (subj ? subj.children : []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  fillInputChapter();
}
function fillInputChapter() {
  const subj = TREE.find(s => s.id === $("#input-subject").value);
  const ss = subj ? subj.children.find(c => c.id === $("#input-subsub").value) : null;
  $("#input-chapter").innerHTML = `<option value="">未分章</option>` + (ss ? ss.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  renderInputKps();
}
function renderInputKps() {
  const ch = TREE.flatMap(s => s.children).find(c => c.id === $("#input-chapter").value);
  const kps = ch ? ch.children : [];
  const wrap = $("#input-kps");
  wrap.innerHTML = `<span class="chip" data-k="" onclick="toggleInputKp(this)">∅ 未分类</span>` +
    kps.map(k => `<span class="chip" data-k="${esc(k)}" onclick="toggleInputKp(this)">${esc(k)}</span>`).join("");
}
function toggleInputKp(el) {
  el.classList.toggle("on");
  const prev = $("#input-kps .chip.on:not([data-k=''])");
  if (el.dataset.k !== "" && el.classList.contains("on")) {
    // 多知识点关联：允许保留已有选择（不再单选）
    toast("已关联知识点（支持多选）");
  }
}

function bindInputPreview() {
  const render = () => {
    renderTexPreview($("#input-preview"), $("#input-title").value);
    renderTexPreview($("#input-solution-preview"), $("#input-solution").value);
  };
  $("#input-title").addEventListener("input", render);
  $("#input-solution").addEventListener("input", render);
}

/* 选择题选项换行：A. xxx B. xxx → 每个选项独立一行 */
function formatOptions(s) {
  const t = String(s || "").replace(/\r\n/g, "\n");
  const re = /([（(]?[A-Fa-f][.、)）]\s*)/g;
  let first = true;
  return t.replace(re, (m) => {
    if (first) { first = false; return m; }
    return "\n" + m;
  });
}

/* MinerU 输出 → KaTeX 可渲染：去 $ 包裹 / HTML 标签 / align→aligned / 选项换行等 */
function normalizeLatex(s) {
  let t = formatOptions(String(s || ""));
  t = t.replace(/```latex|```/g, "");
  t = t.replace(/\$\$/g, "").replace(/\\\(|\\\)/g, "").replace(/\\\[|\\\]/g, "");
  t = t.replace(/\$([^$]+)\$/g, (m, inner) => inner.trim());
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\\begin\{align\*\}/g, "\\begin{aligned}").replace(/\\end\{align\*\}/g, "\\end{aligned}");
  t = t.replace(/\\begin\{align\}/g, "\\begin{aligned}").replace(/\\end\{align\}/g, "\\end{aligned}");
  t = t.replace(/\\begin\{equation\*\}/g, "").replace(/\\end\{equation\*\}/g, "");
  t = t.replace(/\\begin\{equation\}/g, "").replace(/\\end\{equation\}/g, "");
  t = t.replace(/\\begin\{array\}/g, "\\begin{aligned}").replace(/\\end\{array\}/g, "\\end{aligned}");
  t = t.replace(/\\text\{([^}]*)\}/g, (m, inner) => `\\text{${inner.replace(/[{}]/g, "")}}`);
  t = t.replace(/\n/g, " \\\\ ");
  return t.replace(/[ \t]+/g, " ").trim();
}

function renderTexPreview(box, tex) {
  if (!box) return;
  box.innerHTML = "";
  const clean = normalizeLatex(tex);
  if (!clean) {
    box.innerHTML = `<span class="small muted">渲染预览（公式会自动渲染）</span>`;
    return;
  }
  try {
    const node = document.createElement("div");
    if (typeof katex !== "undefined") katex.render(clean, node, { throwOnError: false, displayMode: true });
    else node.textContent = clean;
    box.appendChild(node);
  } catch (e) {
    box.textContent = clean;
  }
}

/* ============================================================
   统一识别录入：1 张 = 单题流程，多张 = 批量流程
   OCR 统一走 window.API（本地模拟；后端接入后契约不变）
   ============================================================ */
let inputSeq = 0;
let inputImgs = [];        // { id, kind: "q"|"s", name, dataUrl }
let inputPairs = [];       // [{ q, s }]
let inputSelQ = null;      // 点选配对：当前选中的题目图 id
let inputQueue = [];       // [{ qImgId, sImgId, titleTex, solutionTex, status }]
let inputCursor = 0;
let texView = "render";

/* ---------- 图片添加：题目(q) / 过程(s) 两个区，各自支持拍照/相册/粘贴 ---------- */
function addInputFiles(kind) {
  const el = $("#input-file-" + kind);
  el.value = "";
  el.onchange = () => handleFiles(el.files, kind);
  el.click();
}
function addInputPhotos(kind) {
  const el = $("#input-cam-" + kind);
  el.value = "";
  el.onchange = () => handleFiles(el.files, kind);
  el.click();
}
async function pasteInput(kind) {
  window.__pasteKind = kind;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) {
        const t = it.types.find(x => x.startsWith("image/"));
        if (t) files.push(await it.getType(t));
      }
      if (files.length) { handleFiles(files, kind); toast(`已粘贴 ${files.length} 张截图到${kind === "s" ? "解题" : "题目"}区`, "success"); return; }
    }
  } catch (e) { /* 无剪贴板权限时引导用户直接 Ctrl+V */ }
  toast(`请按 Ctrl+V 粘贴到${kind === "s" ? "解题" : "题目"}区`);
}
document.addEventListener("paste", e => {
  if (!$("#view-input") || $("#view-input").style.display === "none") return;
  const kind = window.__pasteKind || "q";
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) { handleFiles(files, kind); toast(`已粘贴 ${files.length} 张截图到${kind === "s" ? "解题" : "题目"}区`, "success"); }
});

function handleFiles(files, kind) {
  const arr = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  if (!arr.length) { toast("未识别到图片文件", "error"); return; }
  let pending = arr.length;
  arr.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => {
      inputImgs.push({ id: ++inputSeq, kind: kind === "s" ? "s" : "q", name: f.name || `图片 ${inputSeq}`, dataUrl: reader.result, noSolution: false });
      if (--pending === 0) {
        renderInput();
        toast(`已添加 ${arr.length} 张${kind === "s" ? "过程" : "题目"}图片`, "success");
      }
    };
    reader.readAsDataURL(f);
  });
}

/* ---------- 图片队列：点选配对 / 自动配对 / 该题无过程 ---------- */
function renderInput() {
  const qGrid = $("#input-q-imgs");
  if (!qGrid) return;
  const qs = inputImgs.filter(x => x.kind === "q");
  const ss = inputImgs.filter(x => x.kind === "s");
  $("#input-mode-tag").textContent = !qs.length ? "待添加图片" : qs.length === 1 && !ss.length ? "单题模式" : "批量模式";
  $("#input-pair-actions").style.display = qs.length && ss.length ? "" : "none";
  const card = (img) => `
    <div class="bimg-card ${inputSelQ === img.id ? "sel" : ""} ${img.noSolution ? "no-sol" : ""}" onclick="selectInputImg(${img.id})">
      <img src="${img.dataUrl}" alt="" />
      ${img.kind === "q"
        ? `<span class="bimg-kind" onclick="event.stopPropagation();toggleNoSolution(${img.id})">${img.noSolution ? "🚫 无过程" : "题目"}</span>`
        : `<span class="bimg-kind is-s">解题</span>`}
      <span class="bimg-del" onclick="event.stopPropagation();removeInputImg(${img.id})">✕</span>
    </div>`;
  qGrid.innerHTML = qs.length ? qs.map(card).join("") : `<div class="small muted" style="padding:8px 0;">还没有题目图片，点上方按钮添加</div>`;
  $("#input-s-imgs").innerHTML = ss.length ? ss.map(card).join("") : `<div class="small muted" style="padding:8px 0;">可选的解题过程图；不需要过程可留空</div>`;
  renderPairs();
  renderQueue();
}

/* 该题不需要解题过程：只识别题面 */
function toggleNoSolution(id) {
  const img = inputImgs.find(x => x.id === id);
  if (!img || img.kind !== "q") return;
  img.noSolution = !img.noSolution;
  inputPairs = inputPairs.filter(p => p.q !== id && p.s !== id);
  if (inputSelQ === id) inputSelQ = null;
  renderInput();
  toast(img.noSolution ? "该题标记为「无过程」，只识别题面" : "已取消「无过程」标记");
}
function removeInputImg(id) {
  inputImgs = inputImgs.filter(x => x.id !== id);
  inputPairs = inputPairs.filter(p => p.q !== id && p.s !== id);
  if (inputSelQ === id) inputSelQ = null;
  renderInput();
}
function selectInputImg(id) {
  const img = inputImgs.find(x => x.id === id);
  if (!img) return;
  if (img.kind === "s") {
    if (inputSelQ == null) { toast("请先点选一张「题目」图，再点「解题」图完成配对", "error"); return; }
    if (inputPairs.some(p => p.s === id || p.q === inputSelQ)) { toast("该图片已参与配对，请先取消", "error"); return; }
    inputPairs.push({ q: inputSelQ, s: id });
    inputSelQ = null;
    renderInput();
    toast("已配对", "success");
    return;
  }
  inputSelQ = inputSelQ === id ? null : id;
  renderInput();
}
function autoPairInput() {
  const qs = inputImgs.filter(x => x.kind === "q" && !x.noSolution);
  const ss = inputImgs.filter(x => x.kind === "s");
  if (!qs.length) { toast("请先添加题目图", "error"); return; }
  inputPairs = [];
  const n = Math.min(qs.length, ss.length);
  for (let i = 0; i < n; i++) inputPairs.push({ q: qs[i].id, s: ss[i].id });
  const msg = ss.length > qs.length
    ? `已按上传顺序配对 ${n} 题，多余 ${ss.length - n} 张解题图将忽略`
    : `已按上传顺序配对 ${n} 题，${qs.length - n} 张题目图无解题过程`;
  inputSelQ = null;
  renderInput();
  toast(msg, "success");
}
function renderPairs() {
  const box = $("#batch-pairs");
  if (!inputPairs.length) { box.innerHTML = `<div class="small muted">暂无配对</div>`; $("#batch-count").textContent = "0 题"; return; }
  box.innerHTML = inputPairs.map((p, i) => {
    const q = inputImgs.find(x => x.id === p.q);
    const s = inputImgs.find(x => x.id === p.s);
    return `
    <div class="pair-row">
      <div class="thumb" style="overflow:hidden;"><img src="${q && q.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" /></div>
      <div class="small">第 ${i + 1} 道 · 题图 ${p.q}</div>
      <div class="pair-arrow">↔</div>
      <div class="flex" style="justify-content:space-between;width:100%;">
        <div class="thumb" style="overflow:hidden;"><img src="${s && s.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" /></div>
        <button class="btn btn-sm" onclick="unpair(${i})">取消</button>
      </div>
    </div>`;
  }).join("");
  $("#batch-count").textContent = `${inputPairs.length} 题（未配对的题目图将标记「无解题过程」）`;
}
function unpair(i) { inputPairs.splice(i, 1); renderInput(); }

/* ---------- OCR 与逐题校对 ---------- */
function buildQueue() {
  const qImgs = inputImgs.filter(x => x.kind === "q");
  const sImgs = inputImgs.filter(x => x.kind === "s");
  const pairByQ = {};
  inputPairs.forEach(p => { pairByQ[p.q] = p.s; });
  const usedS = new Set(inputPairs.map(p => p.s));
  let si = 0;
  return qImgs.map(x => {
    let sId = pairByQ[x.id];
    if (!sId && !x.noSolution) {
      // 自动按上传顺序把解题图分给未标记「无过程」的题目（题目与过程各 1 张时自动成对）
      while (si < sImgs.length && usedS.has(sImgs[si].id)) si++;
      if (si < sImgs.length) { sId = sImgs[si].id; usedS.add(sId); si++; }
    }
    return {
      qImgId: x.id,
      sImgId: sId || null,
      titleTex: "",
      solutionTex: "",
      wrongAnswer: "",
      status: "pending",
      noSolution: !!x.noSolution || !sId
    };
  });
}

/* 源码 / 渲染视图切换 */
function applyTexView() {
  const show = texView === "render" ? "none" : "";
  const t1 = $("#input-title"), t2 = $("#input-solution");
  const p1 = $("#input-preview"), p2 = $("#input-solution-preview");
  if (t1) t1.style.display = show;
  if (t2) t2.style.display = show;
  if (p1) p1.style.display = texView === "render" ? "" : "none";
  if (p2) p2.style.display = texView === "render" ? "" : "none";
  const btn = $("#tex-toggle-btn");
  if (btn) btn.textContent = texView === "render" ? "✏️ 编辑源码" : "👁 只看渲染";
}

async function startInputOCR() {
  const qImgs = inputImgs.filter(x => x.kind === "q");
  if (!qImgs.length) { toast("请先添加题目图片", "error"); return; }
  inputQueue = buildQueue();
  if (!inputQueue.length) { toast("没有可识别的题目", "error"); return; }
  inputCursor = 0;
  $("#input-ocr-btn").disabled = true;
  $("#input-ocr-state").textContent = "识别中…";
  $("#input-ocr-progress-wrap").style.display = "";
  renderQueue();
  // 逐题 OCR，单题失败隔离
  for (let i = 0; i < inputQueue.length; i++) {
    const it = inputQueue[i];
    it.status = "ocr";
    renderQueue();
    try {
      const qImg = inputImgs.find(x => x.id === it.qImgId);
      const r = await API.ocrRecognize({ dataUrl: qImg.dataUrl, name: qImg.name }, { isSolution: false });
      it.titleTex = r.titleTex || "";
      it.lowConf = r.lowConf || [];
      if (it.sImgId) {
        const sImg = inputImgs.find(x => x.id === it.sImgId);
        const rs = await API.ocrRecognize({ dataUrl: sImg.dataUrl, name: sImg.name }, { isSolution: true });
        it.solutionTex = rs.solutionTex || "";
      }
      it.status = "done";
    } catch (e) {
      it.status = "failed";
      console.warn("单题 OCR 失败（已隔离，不影响其他题）", e);
    }
    $("#input-ocr-progress").style.width = Math.round(((i + 1) / inputQueue.length) * 100) + "%";
    renderQueue();
  }
  $("#input-ocr-btn").disabled = false;
  texView = "render";
  applyTexView();
  const ok = inputQueue.filter(x => x.status === "done").length;
  const bad = inputQueue.length - ok;
  $("#input-ocr-state").textContent = bad ? `识别完成（${bad} 道失败，可重试）` : "识别完成，请逐题校对";
  toast(`OCR 完成：${ok} 道成功 / ${bad} 道失败（失败不影响其他题）`, bad ? "error" : "success");
  renderInputReview();
}

function captureCurrent() {
  if (!inputQueue.length) return;
  const cur = inputQueue[inputCursor];
  cur.titleTex = $("#input-title").value.trim();
  cur.solutionTex = $("#input-solution").value.trim();
  cur.wrongAnswer = $("#input-wrong").value.trim();
}

function renderInputReview() {
  if (!inputQueue.length) {
    $("#input-q-img-box").innerHTML = "暂无题目图";
    $("#input-s-img-box").innerHTML = "暂无过程图（该题可无过程）";
    $("#input-cursor").textContent = "0 / 0";
    $("#input-prev-btn").style.display = "none";
    $("#input-next-btn").style.display = "none";
    $("#input-save-all-btn").style.display = "none";
    renderQueue();
    return;
  }
  const cur = inputQueue[Math.min(inputCursor, inputQueue.length - 1)];
  const qImg = inputImgs.find(x => x.id === cur.qImgId);
  const sImg = cur.sImgId ? inputImgs.find(x => x.id === cur.sImgId) : null;
  if (qImg) {
    $("#input-q-img-box").innerHTML = `<img src="${qImg.dataUrl}" style="max-width:100%;border-radius:8px;" alt="题目原图" />`;
  }
  $("#input-s-img-box").innerHTML = sImg
    ? `<img src="${sImg.dataUrl}" style="max-width:100%;border-radius:8px;" alt="解题原图" />`
    : `<div class="small muted">${cur.noSolution ? "该题标记为「无过程」" : "暂无解题过程图（可留空）"}</div>`;
  $("#input-title").value = cur.titleTex || "";
  $("#input-solution").value = cur.solutionTex || "";
  $("#input-wrong").value = cur.wrongAnswer || "";
  $("#input-title").dispatchEvent(new Event("input"));
  $("#input-solution").dispatchEvent(new Event("input"));
  $("#input-cursor").textContent = `${inputCursor + 1} / ${inputQueue.length}`;
  $("#input-prev-btn").style.display = inputCursor > 0 ? "" : "none";
  $("#input-next-btn").style.display = inputCursor < inputQueue.length - 1 ? "" : "none";
  $("#input-save-all-btn").style.display = inputQueue.length > 1 ? "" : "none";
  const retryBtn = $("#input-retry-btn");
  if (retryBtn) retryBtn.style.display = cur.status === "failed" ? "" : "none";
  renderQueue();
}

/* ⑩ OCR 单题失败重试：只重跑当前题，不影响其他题 */
function retryCurrentOcr() {
  if (!inputQueue.length) return;
  const it = inputQueue[inputCursor];
  if (!it) return;
  it.status = "ocr";
  renderQueue();
  const retryBtn = $("#input-retry-btn");
  if (retryBtn) retryBtn.style.display = "none";
  (async () => {
    try {
      const qImg = inputImgs.find(x => x.id === it.qImgId);
      if (qImg) {
        const r = await API.ocrRecognize({ dataUrl: qImg.dataUrl, name: qImg.name }, { isSolution: false });
        it.titleTex = r.titleTex || "";
        it.lowConf = r.lowConf || [];
      }
      if (it.sImgId) {
        const sImg = inputImgs.find(x => x.id === it.sImgId);
        if (sImg) {
          const rs = await API.ocrRecognize({ dataUrl: sImg.dataUrl, name: sImg.name }, { isSolution: true });
          it.solutionTex = rs.solutionTex || "";
        }
      }
      it.status = "done";
      toast("重试成功，请校对", "success");
    } catch (e) {
      it.status = "failed";
      toast("重试仍失败：" + (e.message || "OCR 错误"), "error");
    }
    renderQueue();
    renderInputReview();
  })();
}

function renderQueue() {
  const box = $("#input-queue");
  if (!inputQueue.length) { box.innerHTML = ""; return; }
  box.innerHTML = inputQueue.map((it, i) => {
    const map = { pending: "待识别", ocr: "识别中…", done: "待校对", saved: "已保存", failed: "失败" };
    const cls = i === inputCursor ? "now" : "";
    const extra = it.status === "saved" ? "ok" : it.status === "failed" ? "bad" : "";
    return `<div class="input-queue-item ${cls} ${extra}">
      <span class="num">${i + 1}</span>
      <span class="txt">题图 ${it.qImgId}${it.sImgId ? " ↔ 解图 " + it.sImgId : it.noSolution ? " · 该题无过程" : " · 无解题图"}</span>
      <span class="tag">${map[it.status] || it.status}</span>
    </div>`;
  }).join("");
  $("#input-queue-info").textContent =
    `共 ${inputQueue.length} 道 · 已保存 ${inputQueue.filter(x => x.status === "saved").length} · 待校对 ${inputQueue.filter(x => x.status === "done" || x.status === "pending").length}`;
}

function inputPrev() { if (inputCursor > 0) { captureCurrent(); inputCursor--; renderInputReview(); } }
function inputNext() { if (inputCursor < inputQueue.length - 1) { captureCurrent(); inputCursor++; renderInputReview(); } }

function toggleTexView() {
  texView = texView === "render" ? "source" : "render";
  applyTexView();
  toast(texView === "render" ? "渲染视图（KaTeX）" : "源码视图");
}

/* OCR 失败 / 不想识别时：直接手动录入 */
function switchManualInput() {
  $("#input-ocr-state").textContent = "手动输入模式";
  $("#input-ocr-status").textContent = "已切换为手动输入：直接填写题面与解题过程，无需识别。";
  $("#input-ocr-btn").disabled = false;
  $("#input-ocr-progress-wrap").style.display = "none";
  texView = "source";
  applyTexView();
  if (!inputQueue.length && inputImgs.length) {
    inputQueue = buildQueue().map(it => ({ ...it, status: "done" }));
    inputCursor = 0;
    renderInputReview();
  }
  const t = $("#input-title");
  if (t) t.focus();
  toast("已切换手动输入");
}

function resetInput() {
  $("#input-title").value = "";
  $("#input-solution").value = "";
  $("#input-wrong").value = "";
  renderTexPreview($("#input-preview"), "");
  renderTexPreview($("#input-solution-preview"), "");
  window.__pasteKind = "q";
  texView = "render";
  applyTexView();
  inputTags.clear();
  $$("#input-tags .chip").forEach(c => c.classList.remove("on"));
  inputImgs = [];
  inputPairs = [];
  inputQueue = [];
  inputCursor = 0;
  inputSelQ = null;
  $("#batch-hint").textContent = "";
  $("#input-ocr-state").textContent = "待识别";
  $("#input-ocr-progress-wrap").style.display = "none";
  $("#input-q-img-box").innerHTML = "暂无题目图";
  $("#input-s-img-box").innerHTML = "暂无过程图（该题可无过程）";
  renderInput();
  toast("已清空，重新录入");
}

/* ---------- 保存（单题去重弹窗 / 批量不弹窗） ---------- */
function collectForm(titleTex, solutionTex, wrongAnswer) {
  const kps = $$("#input-kps .chip.on").map(c => c.dataset.k).filter(Boolean);
  return mkQ({
    type: inputType,
    subject: $("#input-subject").value,
    subSubject: $("#input-subsub").value,
    chapter: $("#input-chapter").value,
    kps,
    tags: Array.from(inputTags),
    titleTex: formatOptions(titleTex),
    solutionTex: solutionTex !== undefined ? solutionTex : $("#input-solution").value.trim(),
    wrongAnswer: wrongAnswer !== undefined ? wrongAnswer : $("#input-wrong").value.trim()
  });
}

function saveCurrentQuestion() {
  captureCurrent();
  const titleTex = $("#input-title").value.trim();
  if (!titleTex) { toast("题面不能为空（OCR 结果或手动输入）", "error"); return; }
  const q = collectForm(titleTex);
  // 单题保留去重弹窗；批量不弹窗，保存后由题库列表角标提示
  if (inputQueue.length <= 1) {
    const dups = findDupCandidates(titleTex, q.subject, q.type);
    if (dups.length) {
      const d = dups[0];
      openModal("⚠️ 疑似重复（7 天内录入）", `
        <div class="small muted">已存在同科目同类型、7 天内的相似题目（相似度 > 0.7）：</div>
        <div class="mt-8" style="background:var(--primary-soft);border-radius:10px;padding:12px;">
          <div class="katex-render" data-tex="${esc(d.titleTex)}"></div>
          <div class="small muted mt-8">录入于 ${fmtDate(d.createdAt)} · 当前掌握度：${displayMastery(d.id).lv.icon} ${displayMastery(d.id).lv.name}</div>
        </div>
        <div class="small muted mt-8">也可打开详情页与本次内容并排对比。</div>`,
        `<button class="btn" onclick="closeModal();go('questions')">查看题库</button>
         <button class="btn" onclick="closeModal()">取消不录入</button>
         <button class="btn btn-primary" onclick="closeModal();commitQuestion(${q.id})">仍然录入为新题</button>`
      );
      window.__pending = q;
      return;
    }
  }
  commitQuestion(null, q);
}

function saveAllQuestions() {
  captureCurrent();
  const pending = inputQueue.filter(it => it.titleTex && it.status !== "saved");
  if (!pending.length) { toast("没有待保存的题目（需识别完成且已填题面）", "error"); return; }
  const n = pending.length;
  pending.forEach(it => {
    const q = collectForm(it.titleTex, it.solutionTex, it.wrongAnswer);
    questions.push(q);
    attachImages(q, it.qImgId, it.sImgId);       // 原图异步落库（P2）
    apiCall(API.saveQuestion(q));                // 增量写（P1）
    it.status = "saved";
  });
  inputQueue = [];
  inputImgs = [];
  inputPairs = [];
  renderInput();
  setTimeout(() => {
    if (serverDown) toast(`⚠️ 保存失败：${n} 道题未写入数据库，请检查本地服务`, "error");
    else toast(`✅ 已批量录入 ${n} 道题（题库在左侧导航，疑似重复以角标提示）`, "success");
  }, 800);
}

/* P2：把题面/解题原图上传到 uploads/ 并写回题目 imgs 字段（失败不影响题目保存） */
function attachImages(q, qImgId, sImgId) {
  const imgs = inputImgs.filter(x => x.id === qImgId || x.id === sImgId);
  if (!imgs.length || !q) return;
  Promise.all(imgs.map(img => API.uploadQuestionImage(img.name, img.dataUrl).catch(() => null)))
    .then(urls => {
      const list = urls.filter(Boolean).map(r => r.url);
      if (!list.length) return;
      q.imgs = (q.imgs || []).concat(list);
      return API.updateQuestion(q);
    })
    .catch(e => { serverDown = true; console.warn("原图上传失败：", e.message); });
}

function commitQuestion(id, q) {
  // id 传入时：优先取待确认题（__pending，重复录入确认路径），其次题库中已存在题目
  let item = q || null;
  if (id) {
    item = questions.find(x => x.id === id) || (window.__pending && window.__pending.id === id ? window.__pending : null);
  }
  if (!item) { toast("保存失败：题目不存在", "error"); return; }
  if (!questions.includes(item)) questions.push(item);
  window.__pending = null;
  const cur = inputQueue[inputCursor];
  apiCall(API.saveQuestion(item));
  if (cur) attachImages(item, cur.qImgId, cur.sImgId);
  if (inputQueue.length > 1) {
    const cur = inputQueue[inputCursor];
    if (cur) cur.status = "saved";
    inputCursor++;
    if (inputCursor < inputQueue.length) {
      renderInputReview();
      toast(`已保存第 ${inputCursor} 题，继续校对第 ${inputCursor + 1} / ${inputQueue.length} 题`, "success");
    } else {
      toast("本批已全部保存（可在左侧导航查看题库）", "success");
      inputQueue = [];
      inputImgs = [];
      inputPairs = [];
      renderInput();
    }
    return;
  }
  resetInput();
  toast("✅ 已保存，可继续录入；题库在左侧导航", "success");
  setTimeout(() => {
    if (serverDown) toast("⚠️ 保存到数据库失败：本地服务未连接，请检查服务", "error");
  }, 800);
}

/* ---------------- 题库 ---------------- */
