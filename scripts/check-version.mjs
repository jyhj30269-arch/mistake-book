/* 版本号单一来源校验：VERSION 文件必须与各处的版本号一致。
   用法：node scripts/check-version.mjs （退出码 0 = 一致，1 = 不一致） */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION 文件内容非法：${version}`);
  process.exit(1);
}

const checks = [
  ["app.js 头注释", "app.js", /业务逻辑 v(\d+\.\d+\.\d+)/],
  ["app.js APP_VERSION", "app.js", /const APP_VERSION = "(\d+\.\d+\.\d+)"/],
  ["api.js 头注释", "api.js", /接口契约 v(\d+\.\d+\.\d+)/],
  ["index.html 头注释", "index.html", /个人工作台 v(\d+\.\d+\.\d+)/],
  ["server.js 头注释", "server.js", /本地服务（v(\d+\.\d+\.\d+)/],
  ["README 当前版本", "README.md", /当前版本：\*\*v(\d+\.\d+\.\d+)\*\*/],
  ["docs/api-contract.md", "docs/api-contract.md", /版本：v(\d+\.\d+\.\d+)/],
  ["package.json version", "package.json", /"version": "(\d+\.\d+\.\d+)"/]
];

let failed = 0;
for (const [name, file, re] of checks) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const m = text.match(re);
  if (!m) { console.error(`✘ ${name}：未找到版本号`); failed++; continue; }
  if (m[1] !== version) {
    console.error(`✘ ${name}：${m[1]} ≠ VERSION ${version}`);
    failed++;
  } else {
    console.log(`✔ ${name}：${m[1]}`);
  }
}

if (failed) { console.error(`\n版本号不一致（${failed} 处），请按 AGENTS.md 规则同步。`); process.exit(1); }
console.log(`\n全部一致 ✔ 当前版本 v${version}`);
