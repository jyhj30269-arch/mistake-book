/* ============================================================
   考研错题本 · API 服务层（前后端接口契约 v1.0.0）
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
    mode: "local",   // "local"（本机测试）| "remote"（后端接入）
    base: "",        // Phase B 后端地址，如 "http://localhost:8000/api"
    version: 1,

    /* ================= 数据层（本地实现） ================= */

    /** 读取整库（本地模式；远端模式应改为 GET /api/db 或逐表拉取） */
    loadAll() {
      return readDB();
    },

    /** 保存整库快照（本地模式；远端模式由各写接口替代） */
    saveAll(data) {
      writeDB({ schema_version: 1, saved_at: Date.now(), ...data });
    },

    /* ================= OCR 识别 ================= */

    /**
     * 提交一张图片做 OCR。
     * @param {Object} image  { dataUrl, name, size }（本地） / File（远端 multipart）
     * @param {Object} opts   { isSolution: boolean }
     * @returns {Promise<{ taskId, titleTex, solutionTex, lowConf, source }>}
     *   远端（Phase C）返回 { taskId }，再用 ocrStatus 轮询结果。
     */
    async ocrRecognize(image, opts = {}) {
      if (this.mode === "remote") {
        // Phase B：POST `${this.base}/ocr/recognize`（multipart 图片）
        // Phase C：后端内部转发 MinerU，返回 { taskId }
        const fd = new FormData();
        fd.append("file", image);
        fd.append("isSolution", String(!!opts.isSolution));
        const res = await fetch(`${this.base}/ocr/recognize`, { method: "POST", body: fd });
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
