/* 抽题算法验证：分层优先 + 加权随机 是否保证覆盖与公平 */

// 与 app.js startReviewWith 一致的抽取逻辑
function pickOnce(poolIds, n, countOf, weightOf) {
  const layers = [[], [], []];
  poolIds.forEach(id => layers[Math.min(countOf(id), 2)].push(id));
  const picked = [];
  const need = Math.min(n, poolIds.length);
  for (const layer of layers) {
    if (picked.length >= need) break;
    const candidates = layer.slice();
    while (candidates.length && picked.length < need) {
      const totalW = candidates.reduce((s, id) => s + weightOf(id), 0);
      let r = Math.random() * totalW;
      let chosen = candidates[0];
      for (const id of candidates) { r -= weightOf(id); if (r <= 0) { chosen = id; break; } }
      picked.push(chosen);
      candidates.splice(candidates.indexOf(chosen), 1);
    }
  }
  return picked;
}

function runScenario(name, total, rounds, num, opts = {}) {
  const counts = new Array(total).fill(0);
  const urgent = new Array(total).fill(false);
  const seen = new Set();
  const coverageByRound = [];
  let firstFull = -1;
  for (let r = 0; r < rounds; r++) {
    const countOf = id => counts[id];
    const weightOf = id => (urgent[id] ? 10 : 5);
    const picked = pickOnce(Array.from({ length: total }, (_, i) => i), num, countOf, weightOf);
    picked.forEach(id => {
      counts[id]++;
      seen.add(id);
      if (opts.urgentOnFail && Math.random() < 0.3) urgent[id] = true;
      if (opts.clearUrgent && urgent[id]) urgent[id] = false;
    });
    coverageByRound.push(seen.size);
    if (firstFull < 0 && seen.size === total) firstFull = r + 1;
  }
  const min = Math.min(...counts), max = Math.max(...counts);
  const zero = counts.filter(c => c === 0).length;
  console.log(`[${name}] ${total} 题 × ${rounds} 轮 × 每轮 ${num} 题`);
  console.log(`  覆盖：${seen.size}/${total}（${(seen.size / total * 100).toFixed(1)}%）${firstFull > 0 ? `，第 ${firstFull} 轮全覆盖` : ""}`);
  console.log(`  每轮累计覆盖：${coverageByRound.join(" → ")}`);
  console.log(`  被抽次数：最少 ${min} / 最多 ${max} / 从未抽到 ${zero} 题`);
  console.log("");
  return { total, seen: seen.size, firstFull, min, max, zero };
}

console.log("=== 抽题算法验证（分层优先 + 加权随机） ===\n");
runScenario("场景A：60 题池，20 轮", 60, 20, 3);
runScenario("场景B：60 题池，30 轮", 60, 30, 3);
runScenario("场景C：当前 15 题池，10 轮", 15, 10, 3);
runScenario("场景D：30 题池，每轮 5 题", 30, 8, 5);
// 边界
runScenario("边界E：池仅 1 题，每轮要 3 题", 1, 5, 3);
const empty = pickOnce([], 3, () => 0, () => 5);
console.log(`边界F：空池抽题 → 返回 ${empty.length} 题（应为 0）`);

// 公平性：同层内加权随机 1000 次分布（10 题，每次抽 1 题，权重相同）
const dist = new Array(10).fill(0);
for (let i = 0; i < 1000; i++) {
  const picked = pickOnce([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1, () => 0, () => 5);
  dist[picked[0]]++;
}
console.log(`公平性：等权重 10 题抽 1000 次，每题次数：${dist.join(",")}（理论各 100）`);
