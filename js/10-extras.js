/* ============================================================
   个人工作台 v1.18.2 · 10-extras.js（由 app.js 拆分）
   外围模块（热点资讯/收藏夹/试卷 PDF 导出）
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 热点资讯（AI HOT） ---------------- */
let hotTab = "today";

function setHotTab(v) {
  hotTab = v;
  $$("#hot-tabs .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  loadHot();
}

function renderHot() {
  const sub = $("#hot-sub");
  if (sub) sub.textContent = "AI 圈动态 · 数据来源：AI HOT";
  loadHot();
}

function zhTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* AI HOT 返回结构做健壮归一化（兼容多种字段名） */
function hotList(data) {
  const d = data && data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.list)) return d.list;
  if (Array.isArray(d.records)) return d.records;
  if (Array.isArray(d.topics)) return d.topics;
  if (Array.isArray(d)) return d;
  return [];
}
function hotItemTitle(it) { return it.title || it.name || it.headline || ""; }
function hotItemSummary(it) { return it.summary || it.description || it.digest || ""; }
function hotItemSource(it) {
  const s = it.source;
  return (typeof s === "string" ? s : s && (s.name || s.title)) || it.source_name || it.sourceName || "";
}
function hotItemLink(it) {
  const l = it.links;
  return (l && (l.aihot || l.original || l.url || l.story)) || it.url || it.link || "";
}
function hotItemTime(it) {
  return zhTime(it.publishedAt || it.published_at || it.discoveredAt || it.discovered_at || it.createdAt || it.latestAt || it.date);
}

const HOT_CATS = {
  industry: "行业", paper: "论文", "ai-products": "AI 产品", "ai-companies": "公司",
  model: "模型", research: "研究", tips: "技巧", tools: "工具", "ai-hot": "精选"
};
function hotCatName(c) {
  return HOT_CATS[c] || c || "";
}

function hotLinkHtml(url, text, cls) {
  const body = esc(text || url || "");
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${body}</a>` : `<span class="${cls}">${body}</span>`;
}

async function loadHot() {
  const box = $("#hot-list");
  if (!box) return;
  box.innerHTML = `<div class="card"><div class="small muted">加载中…</div></div>`;
  try {
    if (hotTab === "topics") {
      renderHotTopics(await API.hotTopics());
    } else if (hotTab === "daily") {
      renderHotDaily(await API.hotDaily());
    } else {
      renderHotItems(await API.hotItems({ window: hotTab === "week" ? "7d" : "24h", limit: 30 }));
    }
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="small muted">⚠️ ${esc(e.message)}</div></div>`;
  }
}

function renderHotItems(data) {
  const list = hotList(data);
  const box = $("#hot-list");
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无内容，稍后再来看看。</div></div>`;
    return;
  }
  box.innerHTML = list.map((it, i) => {
    const title = hotItemTitle(it);
    const sum = hotItemSummary(it);
    const src = hotItemSource(it);
    const time = hotItemTime(it);
    const tag = it.category ? `<span class="chip mini">${esc(hotCatName(it.category))}</span>` : "";
    return `<div class="hot-item">
      <div class="flex-between" style="gap:10px;align-items:flex-start;">
        <div class="flex" style="gap:8px;align-items:flex-start;min-width:0;">
          <span class="hot-rank">${i + 1}</span>
          ${hotLinkHtml(hotItemLink(it), title, "hot-title")}
        </div>
        ${tag}
      </div>
      ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
      <div class="small muted mt-4">${src ? esc(src) + " · " : ""}${time}</div>
    </div>`;
  }).join("");
}

function renderHotTopics(data) {
  const list = hotList(data);
  const box = $("#hot-list");
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无最热话题，稍后再来看看。</div></div>`;
    return;
  }
  box.innerHTML = list.map((it, i) => {
    const title = hotItemTitle(it);
    const sum = hotItemSummary(it);
    const src = hotItemSource(it);
    const time = hotItemTime(it);
    return `<div class="hot-item">
      <div class="flex" style="gap:8px;align-items:flex-start;">
        <span class="hot-rank hot">${i + 1}</span>
        ${hotLinkHtml(hotItemLink(it), title, "hot-title")}
      </div>
      ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
      ${src || time ? `<div class="small muted mt-4">${src ? esc(src) + " · " : ""}${time}</div>` : ""}
    </div>`;
  }).join("");
}

function renderHotDaily(data) {
  const d = (data && data.report) || (data && data.data && data.data.report) || data || {};
  const box = $("#hot-list");
  const date = d.date || d.day || "";
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const flashes = Array.isArray(d.flashes) ? d.flashes : [];
  if (!sections.length && !flashes.length) {
    box.innerHTML = `<div class="card"><div class="small muted">暂无日报内容。</div></div>`;
    return;
  }
  const renderBlock = (list) => list.map((s, i) => {
    const label = s.label || s.title || s.headline || s.name || "条目 " + (i + 1);
    let body = "";
    if (typeof s.items === "string") {
      body = esc(s.items || "");
    } else if (Array.isArray(s.items)) {
      body = s.items.map(it => {
        const t = hotItemTitle(it);
        const link = hotItemLink(it);
        const sum = hotItemSummary(it);
        const src = hotItemSource(it);
        return `<div class="hot-item">
          <div class="flex" style="gap:8px;align-items:flex-start;">
            ${hotLinkHtml(link, t, "hot-title")}
          </div>
          ${sum ? `<div class="small mt-4 hot-sum">${esc(sum)}</div>` : ""}
          ${src ? `<div class="small muted mt-4">${esc(src)}</div>` : ""}
        </div>`;
      }).join("");
    } else if (typeof s.items === "object" && s.items) {
      body = esc(JSON.stringify(s.items));
    }
    return `<div class="card mb-16">
      <div class="card-head"><div class="card-title">${esc(label)}</div></div>
      ${body ? `<div class="small hot-sum" style="white-space:pre-line;">${body}</div>` : `<div class="small muted">暂无内容</div>`}
    </div>`;
  }).join("");
  box.innerHTML = `
    <div class="card mb-16">
      <div class="card-head"><div class="card-title">📰 AI 日报${date ? " · " + esc(String(date).slice(0, 10)) : ""}</div></div>
      <div class="small muted">${esc(d.summary || d.digest || "AI HOT 每日精选")}</div>
    </div>
    ${renderBlock(sections)}
    ${flashes.length ? `<div class="card-head mt-16"><div class="card-title">⚡ 快讯</div></div>` + renderBlock(flashes) : ""}`;
}

/* ---------------- 收藏夹 ---------------- */
let bmFilter = "all";

function setBmFilter(v) {
  bmFilter = v;
  $$("#bm-filter .chip").forEach(c => c.classList.toggle("on", c.dataset.v === v));
  renderBookmarks();
}

function renderBookmarks() {
  const sub = $("#bm-sub");
  if (sub) sub.textContent = `${personal.bookmarks.length} 条收藏 · 链接 / PDF / 笔记`;
  const box = $("#bm-list");
  const list = personal.bookmarks.filter(b => bmFilter === "all" || b.kind === bmFilter);
  if (!personal.bookmarks.length) {
    box.innerHTML = `<div class="card"><div class="small muted">还没有收藏。粘贴一个链接，或上传 PDF 资料，随手存起来。</div></div>`;
    return;
  }
  box.innerHTML = list.map(b => `
    <div class="bm-item">
      <div class="flex" style="gap:12px;align-items:flex-start;">
        <span class="bm-icon">${b.kind === "pdf" ? "📄" : b.kind === "note" ? "📝" : "🔗"}</span>
        <div style="flex:1;min-width:0;">
          <div class="flex" style="gap:8px;align-items:center;flex-wrap:wrap;">
            ${hotLinkHtml(b.url, b.title, "bm-title")}
            <span class="tag">${b.kind === "pdf" ? "PDF / 文件" : b.kind === "note" ? "笔记" : "链接"}</span>
          </div>
          ${b.note ? `<div class="small mt-4 hot-sum">${esc(b.note)}</div>` : ""}
          <div class="flex mt-4" style="gap:4px;flex-wrap:wrap;">
            ${(b.tags || []).map(x => `<span class="chip mini">#${esc(x)}</span>`).join("")}
            <span class="small muted">${fmtDate(b.createdAt)}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="delBookmark(${b.id})">删除</button>
      </div>
    </div>`).join("") || `<div class="card"><div class="small muted">该分类暂无收藏。</div></div>`;
}

function addBookmark() {
  const title = $("#bm-title").value.trim();
  const url = $("#bm-url").value.trim();
  const kind = $("#bm-kind").value;
  const note = $("#bm-note").value.trim();
  if (!title) { toast("请填写标题", "error"); return; }
  if ((kind === "link" || kind === "pdf") && !url) { toast("请填写链接或先上传文件", "error"); return; }
  const tags = String($("#bm-tags").value || "").split(/[,，\s#]+/).map(x => x.trim()).filter(Boolean);
  const b = { id: nextTodoId(), title, kind, url, note, tags, createdAt: Date.now() };
  personal.bookmarks.unshift(b);
  $("#bm-title").value = ""; $("#bm-url").value = ""; $("#bm-note").value = ""; $("#bm-tags").value = "";
  apiCall(API.saveBookmark(b));
  renderBookmarks();
  toast("已收藏", "success");
}

function delBookmark(id) {
  const b = personal.bookmarks.find(x => x.id === id);
  if (!b) return;
  openModal("删除收藏", `<div class="small muted">确定删除「${esc(b.title)}」？</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doDelBookmark(${id})">删除</button>`);
}

function doDelBookmark(id) {
  personal.bookmarks = personal.bookmarks.filter(x => x.id !== id);
  apiCall(API.deleteBookmark(id));
  renderBookmarks();
  toast("已删除收藏");
}

function handleBmFile(files) {
  const f = files && files[0];
  if (!f) return;
  if (f.size > 15 * 1024 * 1024) { toast("文件太大（限 15MB）", "error"); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await API.uploadBookmarkFile(f.name, reader.result);
      $("#bm-url").value = r.url;
      $("#bm-title").value = $("#bm-title").value.trim() || f.name;
      toast("文件已上传，点「收藏」保存", "success");
    } catch (e) {
      toast(e.message || "上传失败", "error");
    }
  };
  reader.readAsDataURL(f);
}

/* ---------------- 试卷 PDF 导出 ---------------- */
let exportingPaper = false;

function openPaperExport() {
  openModal("📄 导出试卷（PDF）", `
    <div class="field"><label>试卷标题</label><input class="input" id="pp-title" value="错题巩固卷" /></div>
    <div class="grid grid-3">
      <div class="field"><label>科目</label><select class="select" id="pp-subject"><option value="all">全部科目</option>${TREE.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>子科目</label><select class="select" id="pp-subsub"></select></div>
      <div class="field"><label>章节</label><select class="select" id="pp-chapter"></select></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>出题数量</label><input class="input" id="pp-num" type="number" min="1" max="50" value="12" /></div>
      <div class="field"><label>掌握度</label>
        <select class="select" id="pp-lv"><option value="all">全部未掌握</option><option value="err">仅错误轨道 🟠🔴⛔</option><option value="worst">顽固 + 重点 🔴⛔</option></select>
      </div>
    </div>
    <div class="field"><label>副标题（可选）</label><input class="input" id="pp-sub" placeholder="如：高数错题随机卷" /></div>
    <div class="field">
      <label>难度配比：错误轨道题占比 <b id="pp-err-val">50%</b></label>
      <input type="range" id="pp-err-ratio" min="0" max="100" step="10" value="50" style="width:100%;" oninput="document.getElementById('pp-err-val').textContent=this.value+'%'" aria-label="错误轨道题占比" />
      <div class="small muted">100% = 只出错误轨道（🟠🔴⛔）；0% = 只出其他未掌握题</div>
    </div>
    <label class="flex" style="gap:8px;cursor:pointer;"><input type="checkbox" id="pp-answers" checked /> 附带「参考答案与解析」页</label>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="doExportPaper()">生成并下载 PDF</button>`);
  $("#pp-subject").onchange = fillPaperSub;
  $("#pp-subsub").onchange = fillPaperChapter;
  fillPaperSub();
}

function fillPaperSub() {
  const subj = TREE.find(s => s.id === $("#pp-subject").value);
  $("#pp-subsub").innerHTML = `<option value="all">全部子科目</option>` +
    (subj ? subj.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") : "");
  fillPaperChapter();
}

function fillPaperChapter() {
  const ss = TREE.flatMap(s => s.children).find(c => c.id === $("#pp-subsub").value);
  $("#pp-chapter").innerHTML = `<option value="">全部章节</option>` +
    (ss ? ss.children.map(ch => `<option value="${ch.id}">${esc(ch.name)}</option>`).join("") : "");
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function doExportPaper() {
  if (exportingPaper) return;
  const num = Math.max(1, Math.min(50, Number($("#pp-num").value) || 12));
  const subject = $("#pp-subject").value;
  const sub = $("#pp-subsub").value;
  const chapter = $("#pp-chapter").value;
  const lv = $("#pp-lv").value;
  const pool = questions.filter(q => {
    if (q.subject !== "subj-math" && q.subject !== "subj-eng" && q.subject !== "subj-408") return false;
    if (subject !== "all" && q.subject !== subject) return false;
    if (sub !== "all" && q.subSubject !== sub) return false;
    if (chapter && q.chapter !== chapter) return false;
    const m = displayMastery(q.id).lv.key;
    if (lv === "err" && !ERR_TRACK.includes(m)) return false;
    if (lv === "worst" && m !== "darkred" && m !== "red") return false;
    if (m === "blue") return false;
    return true;
  });
  if (!pool.length) { toast("没有符合条件的题目", "error"); return; }
  // ⑦ 难度配比：错误轨道题占比（默认 50%）
  const ratio = (Number($("#pp-err-ratio")?.value) || 50) / 100;
  const errPool = pool.filter(q => ERR_TRACK.includes(displayMastery(q.id).lv.key));
  const otherPool = pool.filter(q => !ERR_TRACK.includes(displayMastery(q.id).lv.key));
  const total = Math.min(num, pool.length);
  const nErr = Math.min(errPool.length, Math.round(total * ratio));
  const picked = [
    ...shuffleArr(errPool).slice(0, nErr),
    ...shuffleArr(otherPool).slice(0, total - nErr)
  ].slice(0, total);
  exportingPaper = true;
  try {
    const buf = await API.exportPaper({
      title: $("#pp-title").value.trim() || "错题巩固卷",
      subtitle: $("#pp-sub").value.trim() || "",
      answers: $("#pp-answers").checked,
      questions: picked.map(q => ({ type: q.type, titleTex: q.titleTex, solutionTex: q.solutionTex }))
    });
    const blob = new Blob([buf], { type: "application/pdf" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = `试卷-${fmtDate(Date.now())}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 8000);
    closeModal();
    toast(`已生成 ${picked.length} 题试卷 PDF`, "success");
  } catch (e) {
    toast(e.message || "PDF 导出失败", "error");
  } finally {
    exportingPaper = false;
  }
}

