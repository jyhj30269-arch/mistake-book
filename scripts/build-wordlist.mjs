/* 生成内置六级核心词书：node scripts/build-wordlist.mjs
   数据源：GitHub hehonghui/dict（公开词库，百词斩格式，JSON Lines）
   流程：下载 CET6 三卷 → 解析 → 按 wordRank 排序取前 N → 精简字段 → 写 wordlists/cet6-3000.json */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT = Number(process.argv[2] || 3000);
const LOCAL_MODE = process.argv.includes("local"); // node scripts/build-wordlist.mjs 3000 local
const ZIPS = [
  ["1521164668667_CET6_1.zip", "CET6_1"],
  ["1524052554766_CET6_2.zip", "CET6_2"],
  ["1521164633851_CET6_3.zip", "CET6_3"]
];

/* 下载 zip 并返回 JSON Lines 文本（local 模式从 wordlists/_raw/ 读取） */
async function fetchZipText(url, inflateRawSync) {
  if (LOCAL_MODE) {
    const rawDir = join(ROOT, "wordlists", "_raw");
    const file = join(rawDir, url.split("/").pop());
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(file);
    return unzipJson(buf, inflateRawSync);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return unzipJson(buf, inflateRawSync);
}

/* 简易 ZIP 解析：定位 .json 条目并解压（inflate 由 main 注入） */
function unzipJson(buf, inflateRawSync) {
  const eocd = buf.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (eocd < 0) throw new Error("不是合法 ZIP");
  const count = buf.readUInt16LE(eocd + 10);
  const cdStart = buf.readUInt32LE(eocd + 16);
  let off = cdStart;
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (name.endsWith(".json")) {
      const method = buf.readUInt16LE(off + 10);
      const compSize = buf.readUInt32LE(off + 20);
      const localHeaderLen = buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28) + 30;
      const data = buf.subarray(localOff + localHeaderLen, localOff + localHeaderLen + compSize);
      const raw = method === 8 ? inflateRawSync(data) : data;
      return raw.toString("utf8");
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("zip 内未找到 json");
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

async function main() {
  const { inflateRawSync } = await import("node:zlib");
  const words = [];
  for (const [file, tag] of ZIPS) {
    const url = `https://raw.githubusercontent.com/hehonghui/dict/master/book/${file}`;
    process.stdout.write(`下载 ${tag}...`);
    const text = await fetchZipText(url, inflateRawSync);
    let n = 0;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const w = JSON.parse(t);
        if (!w.headWord) continue;
        const c = w.content && w.content.word && w.content.word.content || {};
        const trs = (c.trans || []).map(x => (x.pos ? x.pos + ". " : "") + clean(x.tranCn || x.tran)).filter(Boolean);
        const sent = (c.sentence && c.sentence.sentences && c.sentence.sentences[0]) || null;
        // v1.20：英英释义 / 英音 / 近义词 / 同根词
        const en = (c.trans || []).map(x => clean(x.tranOther)).find(Boolean) || "";
        const syns = [];
        (c.syno && c.syno.synos || []).forEach(x => { (x.hwds || []).forEach(h => { if (h.w && !syns.includes(h.w)) syns.push(h.w); }); });
        const rels = [];
        (c.relWord && c.relWord.rels || []).forEach(r => { (r.words || []).forEach(wd => {
          if (wd.hwd && rels.length < 6 && !rels.some(x => x.w === wd.hwd)) rels.push({ pos: r.pos, w: wd.hwd, t: clean(wd.tran) });
        }); });
        words.push({
          w: clean(w.headWord),
          t: trs.slice(0, 2).join("；"),
          te: en.slice(0, 160),
          e: sent ? clean(sent.sContent).slice(0, 120) : "",
          ec: sent ? clean(sent.sCn).slice(0, 80) : "",
          ph: clean(c.usphone || c.ukphone || ""),
          uk: clean(c.ukphone || ""),
          syn: syns.slice(0, 5),
          rel: rels.slice(0, 5)
        });
        n++;
      } catch (e) { /* 跳过坏行 */ }
    }
    console.log(` ${n} 词`);
  }
  // 去重（保留首次出现 = 高频在前）+ 截取前 LIMIT
  const seen = new Set();
  const uniq = words.filter(x => { if (seen.has(x.w)) return false; seen.add(x.w); return true; });
  const top = uniq.slice(0, LIMIT);
  const dir = join(ROOT, "wordlists");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `cet6-${LIMIT}.json`);
  writeFileSync(out, JSON.stringify(top, null, 0), "utf8");
  console.log(`\n完成：${uniq.length} 唯一词 → 取前 ${top.length} → ${out}（${(top.length * 160 / 1024).toFixed(0)} KB 估算）`);
  console.log("样例：", JSON.stringify(top.slice(0, 3)));
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
