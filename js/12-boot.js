/* ============================================================
   个人工作台 v1.23.0 · 12-boot.js（由 app.js 拆分）
   初始化入口、window 暴露、跨标签同步、?auto=1
   依赖：本文件之前的 js/0X-*.js；经典 script 顺序加载，共享全局词法环境。
   ============================================================ */

function resetDemoData() {
  openModal("重置演示数据", `
    <div class="small muted">将清空本地数据库中的全部数据，并恢复演示题库。此操作不可撤销，建议先「导出 JSON 备份」。</div>`,
    `<button class="btn" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="closeModal();doResetDemo()">确认重置</button>`
  );
}
async function doResetDemo() {
  try {
    // 服务端清空并重播种子数据（单一数据源 = seed-data.js）
    await API.resetAll();
    await loadLocal();
    toast("已重置为演示数据", "success");
    go("dashboard");
  } catch (e) {
    toast("重置失败：" + (e.message || "本地服务未连接"), "error");
  }
}

/* ---------------- 初始化 ---------------- */
(async () => {
  applyTexView();
  // 登录态检查（cookie 会话）→ 登录成功后才加载数据（服务端 API 已强制鉴权）
  const user = await API.authMe().catch(() => null);
  if (user) {
    window.__currentUser = user;
    const ok = await loadLocal();
    if (!ok) toast("数据加载失败：本地服务未连接，请检查服务", "error");
    enterApp();
  } else {
    $("#view-app").style.display = "none";
    $("#view-login").style.display = "grid";
  }
  // 跨标签页同步：其他标签页写库后，本页静默重载数据（录入中不打断）
  if (typeof BroadcastChannel !== "undefined") {
    window.__mbTabId = Math.random().toString(36).slice(2);
    const bc = new BroadcastChannel("mb-data");
    window.__mbBc = bc;
    bc.onmessage = async (ev) => {
      if (ev.data === window.__mbTabId || document.hidden) return;
      if (currentView === "input") return;
      const synced = await loadLocal();
      if (synced && currentView) { go(currentView); toast("已同步其他标签页的更改", "success"); }
    };
  }
  setInterval(studyTick, 1000);
  applyModuleVisibility();
  // ③ 复习卡键盘快捷键（做题时）：空格/回车翻答案 · 1/2/3/4 自评 · S 跳过 · ←/→ 切题
  document.addEventListener("keydown", (e) => {
    if (currentView !== "dashboard" && currentView !== "wordbook") return;
    const t = e.target;
    const tag = (t && t.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    // 🎴 背单词快捷键（优先）：空格翻卡 · 1/2/3 三档自评 · N/→ 下一个（记认识）· 未学习中 "/" 进入查单词
    if (wordSession) {
      const wplay = $("#word-play");
      if (!wplay || wplay.style.display === "none") return;
      const back = $("#word-back"), rate = $("#word-rate");
      const backShown = back && back.style.display !== "none";
      if (e.key === " " || e.key === "Enter") {
        if (!backShown) { e.preventDefault(); flipWord(); }
        return;
      }
      if (["1", "2", "3"].includes(e.key)) {
        if (rate && rate.style.display !== "none") wordRate({ "1": "know", "2": "fuzzy", "3": "miss" }[e.key]);
        return;
      }
      if (e.key === "n" || e.key === "N" || e.key === "ArrowRight") { nextWord(); return; }
      return;
    }
    if (currentView === "wordbook" && e.key === "/") {
      e.preventDefault();
      showWordTab("search");
      setTimeout(() => { const si = $("#word-search-input"); if (si) si.focus(); }, 60);
      return;
    }
    const play = $("#review-play");
    if (!play || play.style.display === "none") return;
    const ans = $("#rev-answer"), rate = $("#rev-rate");
    const ansShown = ans && ans.style.display !== "none";
    const rateShown = rate && rate.style.display !== "none";
    if (e.key === " " || e.key === "Enter") {
      if (!ansShown) { e.preventDefault(); revealAnswer(); }
      return;
    }
    if (["1", "2", "3", "4"].includes(e.key)) {
      if (rateShown) selfRate({ "1": "fail", "2": "stuck", "3": "half", "4": "ok" }[e.key]);
      return;
    }
    if (e.key === "s" || e.key === "S") { skipCurrent(); return; }
    if (e.key === "ArrowLeft" && !ansShown) { e.preventDefault(); if (reviewIdx > 0) jumpTo(reviewIdx - 1); return; }
    if (e.key === "ArrowRight" && !ansShown) { e.preventDefault(); if (reviewIdx < reviewQueue.length - 1) jumpTo(reviewIdx + 1); return; }
  });
  $$(".nav-item, .mobile-tabbar a").forEach(a => a.addEventListener("click", () => {
    if (a.dataset.wordTab) { openWordbook(a.dataset.wordTab); hideMobileMenu(); return; }
    if (a.dataset.view) { go(a.dataset.view); hideMobileMenu(); }
  }));
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-goto]");
    if (t) go(t.dataset.goto);
  });
  window.go = go;
  window.goDashSection = goDashSection;
  window.toggleMobileMenu = toggleMobileMenu;
  window.hideMobileMenu = hideMobileMenu;
  window.toggleLoginMode = toggleLoginMode;
window.doLogin = doLogin;
window.doLogout = doLogout;
window.goSearch = goSearch;
window.toggleFilter = toggleFilter;
window.treePick = treePick;
window.toggleTree = toggleTree;
window.toggleSel = toggleSel;
window.toggleSelectAll = toggleSelectAll;
window.toggleMark = toggleMark;
window.batchClassify = batchClassify;
window.doBatchClassify = doBatchClassify;
window.openDetail = openDetail;
window.askDelete = askDelete;
window.doDelete = doDelete;
window.saveNote = saveNote;
window.quickRate = quickRate;
window.toggleInputKp = toggleInputKp;
window.addInputFiles = addInputFiles;
window.addInputPhotos = addInputPhotos;
window.pasteInput = pasteInput;
window.handleFiles = handleFiles;
window.toggleNoSolution = toggleNoSolution;
window.removeInputImg = removeInputImg;
window.selectInputImg = selectInputImg;
window.autoPairInput = autoPairInput;
window.unpair = unpair;
window.startInputOCR = startInputOCR;
window.renderInput = renderInput;
window.inputPrev = inputPrev;
window.inputNext = inputNext;
window.retryCurrentOcr = retryCurrentOcr;
window.toggleTexView = toggleTexView;
window.resetInput = resetInput;
window.saveCurrentQuestion = saveCurrentQuestion;
window.saveAllQuestions = saveAllQuestions;
window.commitQuestion = commitQuestion;
window.renderQuestions = renderQuestions;
window.startReview = startReview;
window.startReviewFromRec = startReviewFromRec;
window.reviewDueNow = reviewDueNow;
window.toggleReviewCfg = toggleReviewCfg;
window.revealAnswer = revealAnswer;
window.selfRate = selfRate;
window.jumpTo = jumpTo;
window.skipCurrent = skipCurrent;
window.reviewExit = reviewExit;
window.selectDefaultNum = selectDefaultNum;
window.toggleTheme = toggleTheme;
window.toggleRemind = toggleRemind;
window.demoNotify = demoNotify;
window.addTodo = addTodo;
window.toggleTodo = toggleTodo;
window.delTodo = delTodo;
window.editTodo = editTodo;
window.saveTodoEdit = saveTodoEdit;
window.addTodoSub = addTodoSub;
window.toggleTodoSub = toggleTodoSub;
window.delTodoSub = delTodoSub;
window.setTodoView = setTodoView;
window.addGoal = addGoal;
window.goalProgress = goalProgress;
window.editGoal = editGoal;
window.saveGoalEdit = saveGoalEdit;
window.delGoal = delGoal;
window.doDelGoal = doDelGoal;
window.setGoalFilter = setGoalFilter;
window.markGoalDone = markGoalDone;
window.toggleGoalMilestone = toggleGoalMilestone;
window.addGoalMilestone = addGoalMilestone;
window.delGoalMilestone = delGoalMilestone;
window.toggleGoalTodoLink = toggleGoalTodoLink;
window.toggleGoalMsModal = toggleGoalMsModal;
window.setSummaryRange = setSummaryRange;
window.pickMood = pickMood;
window.saveDailyReview = saveDailyReview;
window.addInboxItem = addInboxItem;
window.setInboxFilter = setInboxFilter;
window.renderInbox = renderInbox;
window.inboxToTodo = inboxToTodo;
window.doInboxToTodo = doInboxToTodo;
window.inboxToGoal = inboxToGoal;
window.doInboxToGoal = doInboxToGoal;
window.inboxToReview = inboxToReview;
window.archiveInboxItem = archiveInboxItem;
window.reopenInboxItem = reopenInboxItem;
window.delInboxItem = delInboxItem;
window.renderCalendar = renderCalendar;
window.calShift = calShift;
window.calToday = calToday;
window.calPick = calPick;
window.loadHot = loadHot;
window.setHotTab = setHotTab;
window.renderBookmarks = renderBookmarks;
window.addBookmark = addBookmark;
window.delBookmark = delBookmark;
window.doDelBookmark = doDelBookmark;
window.handleBmFile = handleBmFile;
window.setBmFilter = setBmFilter;
window.openPaperExport = openPaperExport;
window.doExportPaper = doExportPaper;
window.fillPaperSub = fillPaperSub;
window.fillPaperChapter = fillPaperChapter;
window.addNode = addNode;
window.doAddNode = doAddNode;
window.delNode = delNode;
window.delChapter = delChapter;
window.doDelChapter = doDelChapter;
window.exportJSON = exportJSON;
window.backupDb = backupDb;
window.handleRestoreFile = handleRestoreFile;
window.doRestore = doRestore;
window.handleImportFile = handleImportFile;
window.handleCsvFile = handleCsvFile;
window.loadMoreQuestions = loadMoreQuestions;
window.doMergeImport = doMergeImport;
window.showOverwriteConfirm = showOverwriteConfirm;
window.doOverwrite = doOverwrite;
window.resetDemoData = resetDemoData;
window.doResetDemo = doResetDemo;
window.continueResume = continueResume;
window.renderResumeButton = renderResumeButton;
window.openEditModal = openEditModal;
window.editFillSub = editFillSub;
window.editFillChapter = editFillChapter;
window.editFillKps = editFillKps;
window.toggleEditKp = toggleEditKp;
window.toggleEditTag = toggleEditTag;
window.saveEditQuestion = saveEditQuestion;
window.addSubject = addSubject;
window.doAddSubject = doAddSubject;
window.addKp = addKp;
window.doAddKp = doAddKp;
window.askDelKp = askDelKp;
window.doDelKp = doDelKp;
window.renameNode = renameNode;
window.doRenameNode = doRenameNode;
window.doDelSubject = doDelSubject;
window.doDelSubSubject = doDelSubSubject;
window.doDelChapterById = doDelChapterById;
window.switchManualInput = switchManualInput;
window.loadOcrConfig = loadOcrConfig;
window.saveOcrConfig = saveOcrConfig;
window.testOcrConnection = testOcrConnection;
window.closeModal = closeModal;
window.showReviewDone = showReviewDone;
window.toggleRevWrite = toggleRevWrite;
window.revWriteCompare = revWriteCompare;
window.renderReviewSets = renderReviewSets;
window.startSetReview = startSetReview;
window.addReviewSet = addReviewSet;
window.doAddReviewSet = doAddReviewSet;
window.pickReviewSet = pickReviewSet;
window.doAddToSet = doAddToSet;
window.renameReviewSet = renameReviewSet;
window.doRenameReviewSet = doRenameReviewSet;
window.delReviewSet = delReviewSet;
window.doDelReviewSet = doDelReviewSet;
window.saveExamDate = saveExamDate;
window.toggleModule = toggleModule;
window.speakQuestion = speakQuestion;
window.speakCurrent = speakCurrent;
window.batchDeleteQuestions = batchDeleteQuestions;
window.doBatchDeleteQuestions = doBatchDeleteQuestions;
window.batchExportQuestions = batchExportQuestions;
window.genTodayPlan = genTodayPlan;
window.reviewWeakNow = reviewWeakNow;
window.renderHabitsPanel = renderHabitsPanel;
window.addHabit = addHabit;
window.doAddHabit = doAddHabit;
window.toggleHabit = toggleHabit;
window.delHabit = delHabit;
window.exportLearnReport = exportLearnReport;
window.saveAwayPolicy = saveAwayPolicy;

/* 截图辅助：?auto=1 直接进入指定视图（需已登录） */
if (location.search.includes("auto=1")) {
  const v = new URLSearchParams(location.search).get("view");
  if (v && $("#view-" + v)) go(v);
}
})();
