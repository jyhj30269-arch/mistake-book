/* 掌握度算法专项测试（v1.18）：node verify-mastery.mjs
   覆盖：computeMastery 六级流转（ok 连击升级 / fail 连击降级 / half·stuck 打断不升降）/
   displayMastery 7 天时间衰减降档 / 边界（无记录、单条记录） */
import { startServer, startBrowser, connect, getWsUrl, loginAndReload, makeCheck, EDGE, sleep } from "./test-helper.mjs";

const PORT = 9399;
const CDP_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}/index.html?auto=1&view=dashboard`;

const server = startServer(PORT, "mast");
await sleep(2000);
const browser = startBrowser(EDGE, CDP_PORT, "mast");
const { check, abort, report } = makeCheck("掌握度算法检查");

try {
  const client = await connect(await getWsUrl(CDP_PORT));
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.navigate", { url: URL });
  await sleep(2500);
  await loginAndReload(client, PORT);

  const res = await client.evalJS(`(() => {
    const now = Date.now();
    const d = n => now - n * 86400000;
    const out = {};
    // 无记录 → 未复习
    const q0 = { id: 9901, titleTex: "t0", createdAt: now };
    out.unreviewed = computeMastery(9901).lv.key;

    // ok 连击：1/2/3 次 → yellow/green/blue
    let seq = 1;
    const logs = (qid, list) => list.forEach(([at, result]) => reviewLogs.push({ id: seq++, qid, at, result }));
    logs(9902, [[d(9), "ok"]]);
    out.ok1 = computeMastery(9902).lv.key;
    logs(9903, [[d(9), "ok"], [d(6), "ok"]]);
    out.ok2 = computeMastery(9903).lv.key;
    logs(9904, [[d(9), "ok"], [d(6), "ok"], [d(3), "ok"]]);
    out.ok3 = computeMastery(9904).lv.key;

    // fail 连击：1/2/3 次 → orange/red/darkred
    logs(9905, [[d(9), "fail"]]);
    out.fail1 = computeMastery(9905).lv.key;
    logs(9906, [[d(9), "fail"], [d(6), "fail"]]);
    out.fail2 = computeMastery(9906).lv.key;
    logs(9907, [[d(9), "fail"], [d(6), "fail"], [d(3), "fail"]]);
    out.fail3 = computeMastery(9907).lv.key;

    // half/stuck 打断连续段且不升降级
    logs(9908, [[d(9), "ok"], [d(6), "ok"], [d(3), "half"]]);
    const m8 = computeMastery(9908);
    out.halfPause = m8.pause === true && m8.lv.key === "green"; // 保持 green（2 连 ok）
    logs(9909, [[d(9), "fail"], [d(6), "fail"], [d(3), "stuck"]]);
    const m9 = computeMastery(9909);
    out.stuckPause = m9.pause === true && m9.lv.key === "red";   // 保持 red（2 连 fail）

    // 最新 half 后跟 ok：从该 ok 重新计
    logs(9910, [[d(9), "fail"], [d(6), "half"], [d(3), "ok"]]);
    out.afterHalfOk = computeMastery(9910).lv.key; // 1 连 ok → yellow

    // 时间衰减：7 天前最后复习 → 降一档
    logs(9911, [[d(20), "ok"], [d(9), "ok"]]); // 2 连 ok → green，但 9 天前 → 降 yellow
    const m11 = displayMastery(9911);
    out.decayGreen = m11.decay === true && m11.lv.key === "yellow";
    logs(9912, [[d(20), "ok"], [d(2), "ok"]]); // 2 天前 → 不衰减
    out.freshGreen = displayMastery(9912).decay === false && displayMastery(9912).lv.key === "green";

    // 单条 fail → orange（不衰减则保持）
    logs(9913, [[d(2), "fail"]]);
    out.singleFail = computeMastery(9913).lv.key === "orange";

    reviewLogs = reviewLogs.filter(l => l.qid < 9901); // 只清理测试注入的日志（9901-9913），保留种子日志
    return out;
  })()`);

  check("无记录 → 未复习", res.unreviewed === "unreviewed");
  check("ok×1/2/3 → yellow/green/blue", res.ok1 === "yellow" && res.ok2 === "green" && res.ok3 === "blue");
  check("fail×1/2/3 → orange/red/darkred", res.fail1 === "orange" && res.fail2 === "red" && res.fail3 === "darkred");
  check("half 打断且保持不降级", res.halfPause === true);
  check("stuck 打断且保持不降级", res.stuckPause === true);
  check("half 后 ok 重新计数", res.afterHalfOk === "yellow");
  check("7 天未复习衰减降档（green→yellow）", res.decayGreen === true);
  check("2 天内复习不衰减", res.freshGreen === true);
  check("单条 fail → orange", res.singleFail === true);

  check("无运行时异常", client.errors.length === 0);
  client.close();
} catch (e) {
  abort(e.message);
} finally {
  await browser.stop();
  await server.stop();
}
report();
