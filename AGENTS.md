# 个人工作台 · 项目约定

## 版本管理（强制）

- 当前版本：v1.13.0（见 `VERSION` 文件）。
- 每次修改代码 / 功能 / 文档并交付时，必须升级版本号，规则：
  - 大版本（1.x → 2.x）：录入 / 复习等核心流程重构，或部署方式变化（如云端上线）。
  - 次版本（x.1 → x.2）：新增功能模块、新页面、新接口。
  - 修订版（x.x.1 → x.x.2）：bug 修复、样式调整、文案修改、文档同步。
- 升级步骤：
  1. 修改 `VERSION` 文件；
  2. 同步修改 `app.js` / `api.js` / `index.html` 头部注释里的版本号；
  3. 若涉及接口，同步 `docs/api-contract.md` 的版本号与说明；
  4. 提交信息格式：`v<版本号>：<一句话改动摘要>`（如 `v1.0.1：修复 OCR 结果被覆盖`）；
  5. 每次提交后推送到 GitHub（本仓库）。

## 技术约定

- 前端数据访问统一走 `window.API`（`api.js`），业务代码不直接读写 localStorage / fetch。
- 数据层：本地 SQLite（`server.js` + `node:sqlite`，数据库 `mistake-book.db`），前端通过 `api.js`（remote 模式）读写；启动方式 `node server.js` 或双击 `start.bat`，访问 http://127.0.0.1:8788。
- 页面不内置测试数据：种子数据在 `seed-data.js`，仅当 SQLite 为空时写入一次。
- OCR：真实识别由 `server.js` 调用本机 `mineru-open-api`（token 在 `~/.mineru/config.yaml`）；回归测试用 `MINERU_DISABLE=1` 走模拟加速。
- 登录：Cookie 会话（HttpOnly，7 天），账号密码加密存 SQLite（scrypt 加盐哈希）；演示账号 admin/admin123。
- 合并入口：单题 / 批量识别合为「识别录入」一个入口，1 张图 = 单题，多张图 = 批量。
- 修改后先跑 `node smoke-test.mjs` 与 `node layout-check.mjs` 再交付。
