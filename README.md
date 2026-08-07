# 考研错题本（个人工作台）

单用户考研错题管理工具：拍照录入 → OCR 识别 → 人工校对 → 分类归档 → 随机抽题复习 → 六级掌握度评估 → 学习统计。

## 版本

- 当前版本：**v1.0.0**
- 版本规则见 `AGENTS.md`：每次修改代码必须升级版本号并推送到 GitHub。

## 当前能力（v1.0.0）

- 统一「识别录入」：单题（1 张图）与批量（多张图，题目/解题标记 + 配对）合为一个入口。
- 本地持久化：数据存浏览器 localStorage，刷新不丢；首次进入自动播种演示数据。
- API 契约层：`api.js` 定义前后端唯一接口；后端接入只需切 `mode = "remote"`。
- 题库浏览 / 搜索筛选 / 知识点树 / 批量归类、随机复习 + 四档自评 + 六级掌握度、统计图表、JSON 导出导入、学习时长。

## 运行

直接用浏览器打开 `index.html`（双击即可，无需构建）。地址栏加 `?auto=1` 可自动登录。

## 测试

```powershell
node smoke-test.mjs     # 功能链路：单题/批量录入、OCR、持久化
node layout-check.mjs   # 桌面/移动布局检查
```

## 目录

```text
assets/
├── index.html       # 应用入口（含统一识别录入页）
├── app.js           # 业务逻辑（v1.0.0）
├── api.js           # API 契约层（local / remote 可切换）
├── style.css        # 样式
├── docs/api-contract.md  # 后端接口契约
├── smoke-test.mjs   # 功能冒烟测试
└── layout-check.mjs # 布局检查
```
