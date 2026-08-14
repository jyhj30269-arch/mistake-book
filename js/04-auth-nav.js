/* ============================================================
   个人工作台 v1.21.0 · 04-auth-nav.js（由 app.js 拆分）
   导航 / 登录注册 / 主题 / 移动抽屉
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

/* ---------------- 导航 ---------------- */
let currentView = "dashboard";
let serverDown = false; // 本地 SQLite 服务是否可用
function go(view) {
  $$("#view-app section").forEach(s => s.style.display = "none");
  $("#view-" + view).style.display = "block";
  $$(".nav-item, .mobile-tabbar a").forEach(a => a.classList.toggle("active", a.dataset.view === view));
  currentView = view;
  if (view === "dashboard") renderDashboard();
  if (view === "questions") renderQuestions();
  if (view === "settings") renderSettings();
  if (view === "input") { fillInputSelects(); renderInput(); }
  if (view === "todos") renderTodos();
  if (view === "goals") renderGoals();
  if (view === "summary") renderSummary();
  if (view === "daily") renderDaily();
  if (view === "inbox") renderInbox();
  if (view === "calendar") renderCalendar();
  if (view === "hot") renderHot();
  if (view === "bookmarks") renderBookmarks();
  if (view === "wordbook") { renderWordPanel(); showWordConfig(); }
  window.scrollTo(0, 0);
}

/* 仪表盘内分区定位：随机复习 / 数据统计 */
function goDashSection(sec) {
  go("dashboard");
  setTimeout(() => {
    const el = document.getElementById("dash-" + sec);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

/* 移动端底部「更多」抽屉 */
function toggleMobileMenu() {
  const menu = $("#mobile-menu");
  if (!menu) return;
  menu.style.display = menu.style.display === "none" ? "block" : "none";
}
function hideMobileMenu() {
  const menu = $("#mobile-menu");
  if (menu) menu.style.display = "none";
}

let loginMode = "login";
function toggleLoginMode() {
  loginMode = loginMode === "login" ? "register" : "login";
  const btn = $("#login-btn"), tg = $("#login-toggle");
  if (btn) btn.textContent = loginMode === "login" ? "登录并进入工作台" : "注册并进入工作台";
  if (tg) tg.textContent = loginMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
  const pw = $("#login-pass");
  if (pw) pw.autocomplete = loginMode === "login" ? "current-password" : "new-password";
}
async function doLogin() {
  const u = $("#login-user").value.trim();
  const p = $("#login-pass").value;
  if (!u || !p) { toast("请输入用户名和密码", "error"); return; }
  try {
    if (loginMode === "register") await API.authRegister(u, p);
    else await API.authLogin(u, p);
    window.__currentUser = u;
    // 登录成功后才加载数据（服务端 API 已强制会话鉴权）
    const ok = await loadLocal();
    if (!ok) toast("数据加载失败：本地服务异常，请检查服务", "error");
    enterApp();
    toast(`欢迎，${u}`, "success");
  } catch (e) {
    toast(e.message || "登录失败", "error");
  }
}
function enterApp() {
  $("#view-login").style.display = "none";
  $("#view-app").style.display = "block";
  applyModuleVisibility(); // 登录后按模块开关刷新导航（doLogin 路径同样生效）
  go("dashboard");
  setTimeout(remindCheckToday, 1200);
}
async function doLogout() {
  try { await API.authLogout(); } catch (e) { /* 忽略 */ }
  $("#view-app").style.display = "none";
  $("#mobile-tabbar").style.display = "none";
  $("#view-login").style.display = "grid";
  window.__currentUser = null;
}
function goSearch() {
  const kw = $("#global-search").value.trim();
  if (kw) { $("#q-search").value = kw; go("questions"); }
}

/* ---------------- 仪表盘 ---------------- */
