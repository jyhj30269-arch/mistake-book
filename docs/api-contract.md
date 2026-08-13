# 考研错题本 · 前端 API 接口契约

> 版本：v1.13.3 ｜ 状态：本地 SQLite 服务（server.js）已实现同一契约
>
> 本文件与 `../api.js` 一一对应。后端接入时按此契约实现同名方法即可，前端业务代码无需改动。

## 一、当前接入方式

本地阶段由 `server.js` 提供同一契约（`GET/POST /api/db`、`/api/questions`、`/api/review-logs`、`/api/study`、`/api/dedup/check`、`/api/ocr/recognize`），数据存 `mistake-book.db`（SQLite）。前端 `api.js` 为 remote 模式，base 自动取当前服务地址。

云端后端接入时，把 `server.js` 替换为远端实现（同一套方法签名）即可，前端零改动。

## 二、通用约定

- 所有方法返回 Promise；远端实现用 `fetch`，错误统一返回 `{ code, message, detail }`。
- 错误码分段：`400xx` 参数错误、`401xx` 认证失败、`404xx` 不存在、`409xx` 冲突、`500xx` 服务端、`502xx` 第三方（MinerU）、`503xx` 限流/额度。
- 涉及 MinerU Token 的逻辑只允许在后端，前端永远不接触密钥。
- 单用户系统；v1.13.3 起本地服务**强制 Cookie 会话鉴权**：除 `auth/login`、`auth/register`、`auth/me`、`auth/logout` 与 `paper/html`（无头浏览器打印，靠随机 token 保护）外，所有 `/api/*` 接口必须携带有效 `mb_session` Cookie，否则返回 `40100`。云端后端可自行选择 Authorization 头方案。

## 三、方法清单

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `loadAll()` | 无 | 整库对象 `{ questions, reviewLogs, tree, study, remindOn }` | 本地：读 localStorage；远端：拉取全量数据或按需加载 |
| `saveAll(data)` | 整库对象 | 无 | 本地：写 localStorage；远端：由各写接口替代，可不实现 |
| `ocrRecognize(image, opts)` | `image`（`{dataUrl,name}`）、`opts.isSolution` | `{ taskId, titleTex, solutionTex, lowConf, source, costSec }` | 提交单张图片 OCR；本地服务调用 MinerU 官方 CLI（pipeline，失败回退 flash） |
| `ocrStatus(taskId)` | taskId | `{ status: "pending"\|"done"\|"failed", result? }` | 轮询 OCR 任务（Phase C 使用） |
| `hotItems(opts)` | `{ window, q?, category?, limit? }` | AI HOT 资讯列表 | 服务端代理匿名请求 + 60s 缓存 |
| `hotTopics()` | 无 | 最热话题列表 | 服务端代理 |
| `hotDaily()` | 无 | 最新 AI 日报 | 服务端代理 |
| `exportPaper(paper)` | `{ title, subtitle, answers, questions[] }` | PDF 字节（ArrayBuffer） | 本机 Edge/Chrome 无头打印，KaTeX 渲染 |
| `uploadBookmarkFile(name, dataUrl)` | 文件名 + dataURL | `{ ok, url }` | 存本地 `uploads/`，静态可访问 |
| `checkDuplicate(payload)` | `{ titleTex, subject, type, excludeId, pool? }` | 疑似重复题目数组 | 同科目同类型 + 7 天时间窗 + 中文 bigram Jaccard > 0.7；远端由后端查库 |
| `listQuestions()` | 无 | 题目数组 | 题库列表 |
| `saveQuestion(q)` | 题目对象 | `{ ok, id }` | 新增题目 |
| `deleteQuestion(id)` | id | `{ ok }` | 删除题目（复习记录置空或级联，按 §4.3 规范） |
| `saveReviewLog(log)` | 复习记录对象 | `{ ok }` | 追加一条自评记录（实时计算掌握度） |
| `saveStudy(seconds)` | 秒数 | `{ ok }` | 学习时长落库 |
| `resetAll()` | 无 | 无 | 清空本机数据（仅本地测试用） |

## 四、核心数据对象

### 题目 `question`

```json
{
  "id": 16,
  "type": "problem",
  "subject": "subj-math",
  "subSubject": "ss-gaoshu",
  "chapter": "ch-c1",
  "kps": ["极限计算"],
  "tags": ["method"],
  "titleTex": "\\lim_{x \\to 0} \\frac{1 - \\cos x}{x \\sin x}",
  "solutionTex": "1 - \\cos x \\sim \\frac{x^2}{2} ...",
  "wrongAnswer": "",
  "note": "",
  "marks": {},
  "createdAt": 1754000000000,
  "urgent": false
}
```

### 复习记录 `reviewLog`

```json
{ "id": 1, "qid": 16, "at": 1754000000000, "result": "ok" }
```

`result` 枚举：`ok`（做对）/ `fail`（做错）/ `half`（思路对细节错，不升降级）/ `stuck`（卡住，不升降级）。

### 个人数据 `personal`

```json
{
  "todos": [{ "id": 1, "title": "周五交报告", "done": false, "due": "2026-08-14", "priority": 3,
              "subtasks": [{ "id": 1, "title": "写提纲", "done": true }], "tags": ["工作"],
              "note": "", "remind": "", "createdAt": 1754000000000 }],
  "goals": [{ "id": 2, "title": "考研初试", "category": "学习", "progress": 50, "milestone": "",
              "targetDate": "2026-12-20", "status": "active",
              "linkedTodoIds": [1], "milestones": [{ "id": 1, "title": "完成一轮复习", "done": true }],
              "note": "", "createdAt": 1754000000000 }],
  "reviews": [{ "day": "2026-08-08", "done": "", "stuck": "", "plan": "", "mood": "🙂",
                "stats": { "studySec": 7200, "added": 5, "reviewed": 9, "todoDone": 2, "todoTotal": 4 },
                "updatedAt": 1754000000000 }],
  "inbox": [{ "id": 3, "text": "周三前给导师发初稿", "tags": ["论文"], "status": "open", "createdAt": 1754000000000 }]
  ,"bookmarks": [{ "id": 4, "title": "高数公式手册", "kind": "link", "url": "https://…",
                    "note": "", "tags": ["高数"], "createdAt": 1754000000000 }]
}
```

- `todos.priority`：0 无 / 1 低 / 2 中 / 3 高；`goals.status`：active 进行中 / done 已完成 / paused 已搁置。
- `goals.progress` 为手动兜底值：挂关联待办或里程碑后由前端按完成率自动计算。
- `bookmarks.kind`：link 链接 / pdf 文件 / note 笔记；文件类 url 指向 `/uploads/`。
- `health_logs` 表已随健康模块移除（老库启动时自动 DROP）。

### OCR 结果

```json
{
  "taskId": "task_xxx",
  "titleTex": "OCR 后的题面 LaTeX / Markdown",
  "solutionTex": "OCR 后的解题过程（isSolution 时返回）",
  "lowConf": [{ "from": 18, "to": 22 }],
  "source": "mineru | agent | mock"
}
```

## 五、后端接入检查单

- [ ] `ocrRecognize` / `ocrStatus` 对接 MinerU（先 curl 实测连通性；Supabase 国外域名拉取超时则用方案 B：函数下载 → 申请 MinerU 上传链接 → PUT → 轮询）
- [ ] `checkDuplicate` 用后端数据实现 7 天窗口 + bigram Jaccard
- [ ] `saveQuestion` / `deleteQuestion` / `saveReviewLog` 落库，掌握度实时计算（六级状态流转严格按设计文档 §三）
- [ ] 错误格式统一 `{ code, message, detail }`
- [ ] 前端切换 `mode = "remote"` 后全流程回归（录入 → 题库 → 复习 → 统计 → 导入导出）
