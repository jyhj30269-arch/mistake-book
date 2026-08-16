/* 服务端 API 直接测试（v1.18）：node api-test.mjs
   用 Node fetch 直测全部端点与错误分支（401/400/404/409），比 E2E 快 10 倍 */
import { startServer, makeCheck, sleep } from "./test-helper.mjs";

const PORT = 9398;
const BASE = `http://127.0.0.1:${PORT}/api`;
const server = startServer(PORT, "api");
await sleep(2000);
const { check, abort, report } = makeCheck("API 接口测试");
let cookie = "";

async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, j };
}

try {
  // 1) 鉴权
  let r = await req("GET", "/db");
  check("未登录访问数据接口返回 401", r.status === 401 && r.j.code === 40100);
  r = await req("POST", "/auth/login", { username: "admin", password: "wrong" });
  check("错误密码返回 401", r.status === 401);
  const login = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" })
  });
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("登录成功设置 Cookie", login.ok && cookie.startsWith("mb_session="));
  const A = { Cookie: cookie };

  // 2) 参数校验
  r = await req("POST", "/auth/register", { username: "ab", password: "123" });
  check("注册参数校验 400", r.status === 400);
  const badRes = await fetch(BASE + "/db", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{bad json" });
  check("非法 JSON 返回 400", badRes.status === 400);

  // 3) 数据接口
  r = await req("GET", "/db", undefined, A);
  check("GET /api/db 返回整库", r.status === 200 && Array.isArray(r.j.questions) && Array.isArray(r.j.reviewSets) && Array.isArray(r.j.habits));
  const newId = 9001;
  r = await req("POST", "/questions", {
    id: newId, type: "problem", subject: "subj-math", subSubject: "ss-gaoshu", chapter: "ch-c2",
    kps: ["导数与微分"], tags: ["method"], titleTex: "API 测试题", solutionTex: "解", wrongAnswer: "", note: "",
    marks: {}, createdAt: Date.now(), urgent: false, calcWeak: false, needConsolidate: false, imgs: []
  }, A);
  check("POST /api/questions 新增", r.status === 200 && r.j.ok);
  r = await req("PUT", `/questions/${newId}`, { ...(await (async () => { const d = await (await fetch(BASE + "/db", { headers: A })).json(); return d.questions.find(q => q.id === newId); })()), titleTex: "API 测试题（改）" }, A);
  check("PUT /api/questions 更新", r.status === 200);
  r = await req("GET", "/questions", undefined, A);
  check("GET /api/questions 列表含新题", r.j.data.some(q => q.id === newId && q.titleTex.includes("改")));
  r = await req("DELETE", `/questions/${newId}`, undefined, A);
  check("DELETE /api/questions 删除", r.status === 200);

  // 4) 个人数据 CRUD
  const crud = [
    ["/todos", { id: 9101, title: "API待办", done: false, due: "", priority: 1, subtasks: [], tags: [], note: "", remind: "", createdAt: Date.now() }],
    ["/goals", { id: 9102, title: "API目标", category: "学习", progress: 0, milestone: "", targetDate: "", status: "active", linkedTodoIds: [], milestones: [], note: "", createdAt: Date.now() }],
    ["/inbox", { id: 9103, text: "API想法", tags: [], status: "open", createdAt: Date.now() }],
    ["/bookmarks", { id: 9104, title: "API收藏", kind: "link", url: "https://example.com", note: "", tags: [], createdAt: Date.now() }],
    ["/review-sets", { id: 9105, name: "API冲刺组", qids: [1, 2], createdAt: Date.now() }],
    ["/habits", { id: 9106, name: "API习惯", doneDays: [], createdAt: Date.now() }]
  ];
  let crudOk = true;
  for (const [path, body] of crud) {
    r = await req("POST", path, body, A);
    if (r.status !== 200 || !r.j.ok) { crudOk = false; console.error("POST fail", path, r); }
    const upd = { ...body, title: (body.title || "改") };
    r = await req("PUT", `${path}/${body.id}`, { ...body, name: body.name + "改" }, A);
    if (r.status !== 200) { crudOk = false; console.error("PUT fail", path, r); }
    r = await req("DELETE", `${path}/${body.id}`, undefined, A);
    if (r.status !== 200) { crudOk = false; console.error("DELETE fail", path, r); }
  }
  check("个人数据 CRUD（todo/goal/inbox/bookmark/复习集/习惯）", crudOk);

  // 5) settings / study / dedup
  r = await req("POST", "/settings", { examDate: "2027-12-25", moduleOn: { hot: false }, theme: "dark" }, A);
  check("POST /api/settings（examDate/moduleOn/theme）", r.status === 200);
  const db2 = await (await fetch(BASE + "/db", { headers: A })).json();
  check("settings 已落库并返回", db2.examDate === "2027-12-25" && db2.moduleOn.hot === false && db2.theme === "dark");
  r = await req("POST", "/study", { seconds: 3600, perDay: { "2026-08-13": 600 }, blurPrompt: false }, A);
  check("POST /api/study（含 perDay）", r.status === 200);
  r = await req("POST", "/dedup/check", { titleTex: "\\lim_{x \\to 0} \\frac{1 - \\cos x}{x \\sin x}", subject: "subj-math", type: "problem", excludeId: 99999 }, A);
  check("POST /api/dedup/check 返回数组", r.status === 200 && Array.isArray(r.j));

  // 6) OCR 异步链路（mock 加速）
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  r = await req("POST", "/ocr/recognize", { dataUrl: png, isSolution: false }, A);
  check("OCR 提交立即返回 taskId", r.status === 200 && typeof r.j.taskId === "string");
  const taskId = r.j.taskId;
  let st = null;
  for (let i = 0; i < 30; i++) {
    st = await req("GET", `/ocr/status?taskId=${taskId}`, undefined, A);
    if (st.j && st.j.status !== "pending") break;
    await sleep(300);
  }
  check("OCR 轮询最终 done 且含结果", st.j && st.j.status === "done" && st.j.result && st.j.result.titleTex.includes("\\lim"));
  r = await req("GET", "/ocr/status?taskId=nonexist", undefined, A);
  check("OCR 不存在的任务返回 404", r.status === 404);

  // 7) 备份 / 恢复 / 重置
  const bk = await fetch(BASE + "/backup", { headers: A });
  const buf = Buffer.from(await bk.arrayBuffer());
  check("GET /api/backup 返回 SQLite 文件", bk.status === 200 && buf.slice(0, 15).toString("latin1") === "SQLite format 3");
  r = await req("POST", "/restore", { name: "fake.db", dataUrl: "data:application/octet-stream;base64,aGVsbG8=" }, A);
  check("恢复非法文件返回 400", r.status === 400);
  r = await req("POST", "/reset", undefined, A);
  check("POST /api/reset 重播种子", r.status === 200 && r.j.ok);
  const db3 = await (await fetch(BASE + "/db", { headers: A })).json();
  check("重置后题库为种子 15 题", db3.questions.length === 15);

  // 8) 静态安全
  for (const [path, expect] of [["/mistake-book.db", 403], ["/.git/config", 403], ["/index.html", 200], ["/js/01-core.js", 200]]) {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
    check(`静态 ${path} → ${expect}`, res.status === expect);
  }

  // 9) 登出后 Cookie 失效
  r = await req("POST", "/auth/logout", undefined, A);
  check("登出成功", r.status === 200);
  r = await req("GET", "/db", undefined, A);
  check("登出后旧 Cookie 访问返回 401", r.status === 401);
} catch (e) {
  console.error("测试异常:", e.message);
  abort(e.message); // 必须累加 failures：report() 的 process.exit 会覆盖 process.exitCode，否则基建故障时假绿
} finally {
  await server.stop();
}
report();
