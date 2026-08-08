/* ============================================================
   个人工作台 · API 服务层（前后端接口契约 v1.13.1）
   ------------------------------------------------------------
   本文件是前后端的唯一接口契约。业务代码只通过 window.API 访问
   OCR / 数据 / 去重，不直接读写 localStorage 或 fetch。

   阶段：
   Phase A（当前）mode = "local"
     数据存本机浏览器 localStorage，OCR 为模拟实现，用于本机功能测试。
   Phase B        mode = "remote"
     后端按本契约实现同一批方法，前端只需把 mode 改为 "remote"、
     填入 base 地址，业务代码零改动。
   Phase C        云端部署 + MinerU
     后端 ocrRecognize / ocrStatus 内部对接 MinerU 官方 API，
     前端契约不变。

   后端实现要求：
   1. 方法签名、入参、返回值与本文件保持一致；
   2. 错误统一返回 { code, message, detail }；
   3. 涉及 MinerU Token 的逻辑只允许在后端，前端永远不接触密钥。
   ============================================================ */
(function () {
  "use strict";

  const LS_KEY = "mb-local-db-v1";
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function readDB() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; }
    catch (e) { console.warn("本地存储读取失败", e); return null; }
  }

  function writeDB(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
    catch (e) { console.warn("本地存储写入失败", e); }
  }

  /* ---------- 本地工具：中文 bigram Jaccard 相似度 ---------- */
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
  }
  function bigrams(s) {
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  function jaccard(a, b) {
    const A = bigrams(norm(a)), B = bigrams(norm(b));
    if (!A.size && !B.size) return norm(a) === norm(b) ? 1 : 0;
    let inter = 0;
    A.forEach((x) => { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  const API = {
    mode: "remote",  // "local"（旧内存/localStorage 模式）| "remote"（本地 SQLite 服务）
    // 本地服务（server.js）同源提供 API；file:// 直开时回退 8788
    base: (typeof location !== "undefined" && location.protocol.startsWith("http"))
      ? location.origin + "/api"
      : "http://127.0.0.1:8788/api",
    version: 1,

    /* ================= 账号（cookie 登录，密码存 SQLite） ================= */
    async authLogin(username, password) {
      const res = await fetch(`${this.base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j && j.message) || `登录失败 ${res.status}`);
      return j;
    },
    async authRegister(username, password) {
      const res = await fetch(`${this.base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j && j.message) || `注册失败 ${res.status}`);
      return j;
    },
    async authLogout() {
      await fetch(`${this.base}/auth/logout`, { method: "POST" });
    },
    async authMe() {
      const res = await fetch(`${this.base}/auth/me`);
      if (!res.ok) return null;
      const j = await res.json();
      return j.user;
    },

    /* ================= 数据层（本地实现） ================= */

    /** 读取整库（本地模式；远端模式应改为 GET /api/db 或逐表拉取） */
    async loadAll() {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/db`);
        if (!res.ok) throw new Error(`本地服务返回 ${res.status}`);
        return res.json();
      }
      return readDB();
    },

    /** 保存整库快照（本地模式；远端模式由各写接口替代） */
    saveAll(data) {
      if (this.mode === "remote") {
        return fetch(`${this.base}/db`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        }).then(res => { if (!res.ok) throw new Error(`保存到本地服务失败 ${res.status}`); return res.json(); });
      }
      writeDB({ schema_version: 1, saved_at: Date.now(), ...data });
    },

    /* ================= OCR 识别 ================= */

    /** 读取 MinerU 配置（localStorage，前端仅存 token 供本地测试；生产环境请放后端） */
    mineruConfig() {
      try { return JSON.parse(localStorage.getItem("mb-mineru-config")) || {}; }
      catch (e) { return {}; }
    },

    /**
     * 提交一张图片做 OCR。
     * @param {Object} image  { dataUrl, name, size }（本地） / File（远端 multipart）
     * @param {Object} opts   { isSolution: boolean }
     * @returns {Promise<{ taskId, titleTex, solutionTex, lowConf, source }>}
     *   远端（Phase C）返回 { taskId }，再用 ocrStatus 轮询结果。
     */
    async ocrRecognize(image, opts = {}) {
      const cfg = this.mineruConfig();
      // local 模式：前端直连 MinerU；remote 模式：由本地服务（server.js）统一走真实 MinerU CLI
      if (this.mode === "local" && cfg.engine === "mineru" && cfg.token) {
        return this.ocrRecognizeMineru(image, opts);
      }
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/ocr/recognize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: image.dataUrl, isSolution: !!opts.isSolution })
        });
        if (!res.ok) throw new Error(`OCR 提交失败 ${res.status}`);
        return res.json();
      }
      // 本地模拟：1~2 秒返回示例 LaTeX（低置信度字符黄色高亮）
      await delay(900 + Math.random() * 900);
      const isSolution = !!opts.isSolution;
      return {
        taskId: "mock-" + Date.now(),
        titleTex: isSolution
          ? ""
          : "\\lim_{x \\to 0} \\frac{1 - \\cos x}{x \\sin x}",
        solutionTex: isSolution
          ? "1 - \\cos x \\sim \\frac{x^2}{2}，x \\sin x \\sim x^2，故极限 = \\frac{1}{2}"
          : "",
        lowConf: isSolution ? [] : [{ from: 18, to: 22 }],
        source: "mock"
      };
    },

    /**
     * MinerU 真实识别（v4 流程：申请上传链接 → PUT 图片 → 建任务 → 轮询 → 提取文本）
     * 接口细节以实测为准；若返回格式不同，错误信息里会带原始 JSON。
     */
    async ocrRecognizeMineru(image, opts = {}) {
      const cfg = this.mineruConfig();
      const base = (cfg.base || "https://api.mineru.net").replace(/\/$/, "");
      const auth = { Authorization: `Bearer ${cfg.token}` };
      const t0 = Date.now();

      // 1) 申请上传链接
      const upRes = await fetch(`${base}/api/v4/file-urls/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ files: [{ name: image.name || "question.png" }] })
      });
      const upJson = await upRes.json().catch(() => null);
      if (!upRes.ok) throw new Error(`MinerU 申请上传链接失败（${upRes.status}）：${JSON.stringify(upJson)?.slice(0, 300)}`);
      const first = (upJson?.data?.[0]) || (upJson?.data?.files?.[0]) || upJson?.[0] || upJson?.files?.[0] || null;
      const uploadUrl = first?.upload_url || first?.put_url || first?.uploadUrl || null;
      const fileUrl = first?.file_url || first?.url || first?.fileUrl || null;
      if (!uploadUrl || !fileUrl) {
        throw new Error("MinerU 上传接口返回格式与预期不符，请把这段 JSON 发给开发者：" + JSON.stringify(upJson).slice(0, 300));
      }

      // 2) PUT 图片内容
      const blob = this.dataUrlToBlob(image.dataUrl);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "image/png" },
        body: blob
      });
      if (putRes.status !== 200 && putRes.status !== 201 && putRes.status !== 204) {
        throw new Error(`MinerU 上传文件失败（${putRes.status}）`);
      }

      // 3) 创建识别任务
      const taskRes = await fetch(`${base}/api/v4/extract/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ url: fileUrl, enable_formula: true })
      });
      const taskJson = await taskRes.json().catch(() => null);
      if (!taskRes.ok) throw new Error(`MinerU 创建任务失败（${taskRes.status}）：${JSON.stringify(taskJson)?.slice(0, 300)}`);
      const taskId = taskJson?.data?.task_id || taskJson?.task_id || taskJson?.data?.batch_id || null;
      if (!taskId) throw new Error("MinerU 任务返回格式与预期不符：" + JSON.stringify(taskJson).slice(0, 300));

      // 4) 轮询任务结果（最多 120 秒）
      let result = null;
      for (let i = 0; i < 40; i++) {
        await delay(3000);
        const qRes = await fetch(`${base}/api/v4/extract/task/${taskId}`, { headers: { ...auth } });
        const qJson = await qRes.json().catch(() => null);
        if (!qRes.ok) throw new Error(`MinerU 查询任务失败（${qRes.status}）：${JSON.stringify(qJson)?.slice(0, 300)}`);
        const st = qJson?.data?.state || qJson?.state || qJson?.data?.status || "";
        if (["done", "succeeded", "finished", "complete"].includes(st)) { result = qJson; break; }
        if (["failed", "error", "canceled"].includes(st)) {
          throw new Error("MinerU 识别失败：" + JSON.stringify(qJson).slice(0, 300));
        }
      }
      if (!result) throw new Error("MinerU 任务超时（>120 秒），请稍后重试或改用手动输入");

      // 5) 提取文本（兼容多种返回形态）
      const text = await this.extractMineruText(result);
      if (!text) throw new Error("MinerU 已完成但未提取到文本：" + JSON.stringify(result).slice(0, 300));
      const cost = Math.round((Date.now() - t0) / 1000);
      return {
        taskId,
        titleTex: opts.isSolution ? "" : text,
        solutionTex: opts.isSolution ? text : "",
        lowConf: [],
        source: "mineru",
        costSec: cost
      };
    },

    dataUrlToBlob(dataUrl) {
      const [head, body] = String(dataUrl || "").split(",");
      const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
      const bin = atob(body || "");
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    },

    async extractMineruText(result) {
      const d = result?.data || result || {};
      if (typeof d.extract_result === "string" && d.extract_result) return d.extract_result;
      if (typeof d.markdown === "string" && d.markdown) return d.markdown;
      if (typeof d.full_markdown === "string" && d.full_markdown) return d.full_markdown;
      if (typeof d.text === "string" && d.text) return d.text;
      const files = d.files || d.file_list || d.result_files || [];
      const md = files.find(f => /\.md$/i.test(f.file_name || f.name || "") || /markdown/i.test(f.file_name || f.name || ""));
      if (md && (md.url || md.download_url)) {
        const res = await fetch(md.url || md.download_url);
        if (res.ok) return await res.text();
      }
      return null;
    },

    /**
     * 轮询 OCR 任务结果（Phase C 接 MinerU 后使用）。
     * @returns {Promise<{ status: "pending"|"done"|"failed", result? }>}
     */
    async ocrStatus(taskId) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/ocr/status?taskId=${encodeURIComponent(taskId)}`);
        return res.json();
      }
      return { status: "done", result: null };
    },

    /* ================= AI HOT 资讯（服务端代理，60s 缓存） ================= */

    /** 热点资讯列表（window: 24h | 7d，可带 q / category） */
    async hotItems(opts = {}) {
      const params = new URLSearchParams();
      if (opts.window) params.set("window", opts.window);
      if (opts.q) params.set("q", opts.q);
      if (opts.category) params.set("category", opts.category);
      if (opts.limit) params.set("limit", opts.limit);
      const res = await fetch(`${this.base}/hot/items?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.message) || `AI HOT 请求失败 ${res.status}`);
      }
      return res.json();
    },

    /** 当前最热话题 */
    async hotTopics() {
      const res = await fetch(`${this.base}/hot/topics`);
      if (!res.ok) throw new Error(`AI HOT 请求失败 ${res.status}`);
      return res.json();
    },

    /** 最新 AI 日报 */
    async hotDaily() {
      const res = await fetch(`${this.base}/hot/daily`);
      if (!res.ok) throw new Error(`AI HOT 请求失败 ${res.status}`);
      return res.json();
    },

    /* ================= 试卷 PDF 导出 ================= */

    /**
     * 生成试卷 PDF（服务端用本机 Edge/Chrome 无头打印，KaTeX 渲染公式）。
     * @param {Object} paper { title, subtitle, answers, questions: [{ type, titleTex, solutionTex }] }
     * @returns {Promise<ArrayBuffer>} PDF 字节
     */
    async exportPaper(paper) {
      const res = await fetch(`${this.base}/paper/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paper)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.message) || `PDF 导出失败 ${res.status}`);
      }
      return res.arrayBuffer();
    },

    /* ================= 收藏夹文件上传 ================= */

    /** 上传收藏文件（PDF 等），返回可访问的 URL */
    async uploadBookmarkFile(name, dataUrl) {
      const res = await fetch(`${this.base}/bookmark/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dataUrl })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j && j.message) || `文件上传失败 ${res.status}`);
      return j;
    },

    /* ================= 去重检测 ================= */

    /**
     * 保存前去重：同科目同类型 + 7 天时间窗 + bigram Jaccard > 0.7。
     * @param {Object} p { titleTex, subject, type, excludeId, pool? }
     *   pool：本地模式由前端传入当前内存题库；远端模式由后端查库。
     * @returns {Promise<Array>} 疑似重复题目列表
     */
    async checkDuplicate(p) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/dedup/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titleTex: p.titleTex, subject: p.subject, type: p.type, excludeId: p.excludeId })
        });
        return res.json();
      }
      const windowMs = 7 * 86400000;
      const pool = p.pool || [];
      return pool.filter((q) =>
        q.id !== p.excludeId &&
        q.subject === p.subject &&
        q.type === p.type &&
        Date.now() - (q.createdAt || 0) <= windowMs &&
        jaccard(q.titleTex, p.titleTex) > 0.7
      );
    },

    /* ================= 题目 CRUD ================= */

    /** 列出全部题目 */
    async listQuestions() {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/questions`);
        const body = await res.json();
        return body.data || [];
      }
      return (readDB() || {}).questions || [];
    },

    /** 保存一道题（本地：直接落库；远端：POST /api/questions） */
    async saveQuestion(q) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q)
        });
        return res.json();
      }
      const db = readDB() || {};
      const list = Array.isArray(db.questions) ? db.questions : [];
      list.push(q);
      writeDB({ ...db, questions: list });
      return { ok: true, id: q.id };
    },

    /** 删除一道题 */
    async deleteQuestion(id) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/questions/${id}`, { method: "DELETE" });
        return res.json();
      }
      const db = readDB() || {};
      db.questions = (db.questions || []).filter((q) => q.id !== id);
      writeDB(db);
      return { ok: true };
    },

    /** 记录一条复习记录（selfRate / quickRate 时调用） */
    async saveReviewLog(log) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/review-logs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(log)
        });
        return res.json();
      }
      const db = readDB() || {};
      db.reviewLogs = [...(db.reviewLogs || []), log];
      writeDB(db);
      return { ok: true };
    },

    /** 保存学习时长（秒） */
    async saveStudy(seconds) {
      if (this.mode === "remote") {
        const res = await fetch(`${this.base}/study`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds })
        });
        return res.json();
      }
      const db = readDB() || {};
      db.study = { seconds, updatedAt: Date.now() };
      writeDB(db);
      return { ok: true };
    },

    /** 清空本机数据（恢复演示数据用） */
    resetAll() {
      localStorage.removeItem(LS_KEY);
    }
  };

  window.API = API;
})();
