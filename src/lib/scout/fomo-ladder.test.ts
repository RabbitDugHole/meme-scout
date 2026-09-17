import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFomoTape,
  isArgusSignal,
  isRobinhoodLpTarget,
  isWebhookOnlyChannel,
  parseBundlePct,
  parseIntervalMin,
  parsePhishPct,
  parsePushIndex,
  resetFomoTape,
  resolveSignalChain,
  shouldArmLpFromTape,
} from "./fomo-ladder.ts";

test("parsePushIndex reads arabic and Chinese bobo headers", () => {
  assert.equal(parsePushIndex("🔥 【第 1 次推送】 🔥"), 1);
  assert.equal(parsePushIndex("🚀 【第 5 次跟推】"), 5);
  assert.equal(parsePushIndex("🔥 【第一次推送】"), 1);
  assert.equal(parsePushIndex("【第七次推送】"), 7);
  assert.equal(parsePushIndex("战壕首推 $FOMO"), 1);
});

test("parse interval / phish / bundle from bobo card text", () => {
  const text = `
• 跟推间隔: 7.79 分钟
• 钓鱼钱包: 0.2%
• 老鼠仓偷跑比例: 0%
  `;
  assert.equal(parseIntervalMin(text), 7.79);
  assert.equal(parsePhishPct(text), 0.2);
  assert.equal(parseBundlePct(text), 0);
});

test("Argus ≠ Robinhood: bobo9632 0x CAs are not RH LP targets", () => {
  const chain = resolveSignalChain({
    channel: "bobo9632",
    platform: "Argus",
    address: "0x7d2c34f8be61ae93cce3d408007f73fb3a4e7cfb",
  });
  assert.equal(chain, "Argus");
  assert.equal(isArgusSignal({ channel: "bobo9632", chain }), true);
  assert.equal(
    isRobinhoodLpTarget({ chain, channel: "bobo9632", platform: "Argus" }),
    false,
  );
});

test("explicit 链: ARC is Argus, not Arbitrum/Robinhood", () => {
  const chain = resolveSignalChain({
    channel: "unknown",
    chainText: "ARC",
    address: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
  });
  assert.equal(chain, "Argus");
});

test("bobo9527 is webhook-only (no public t.me/s feed)", () => {
  assert.equal(isWebhookOnlyChannel("bobo9527"), true);
  assert.equal(isWebhookOnlyChannel("@bobo9527", false), true);
  assert.equal(isWebhookOnlyChannel("bobo9632"), false);
  assert.equal(isWebhookOnlyChannel("bobo9632", true), true);
});

test("first print = inventory; shrinking 跟推 + rising vol = FOMO; toxic = do not arm", () => {
  resetFomoTape();
  const ca = "0x1111111111111111111111111111111111111111";

  const p1 = applyFomoTape({
    channel: "bobo8567",
    ca,
    pushIndex: 1,
    vol5m: 22730,
    top10: 34.8,
    phish: 0.2,
    bundle: 0,
    timestamp: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(p1.kind, "inventory");
  assert.equal(p1.armLp, true);

  const p2 = applyFomoTape({
    channel: "bobo8567",
    ca,
    pushIndex: 2,
    intervalMin: 22.11,
    vol5m: 62100,
    timestamp: "2026-09-17T00:22:00.000Z",
  });
  assert.equal(p2.kind, "fomo");
  assert.equal(p2.armLp, false);

  const p5 = applyFomoTape({
    channel: "bobo8567",
    ca,
    pushIndex: 5,
    intervalMin: 7.79,
    vol5m: 125340,
    timestamp: "2026-09-17T01:20:00.000Z",
  });
  // prior interval on tape is 22.11 from p2; 7.79 is shrinking + vol up
  assert.equal(p5.kind, "fomo");
  assert.equal(shouldArmLpFromTape(ca, "Robinhood Chain", "bobo8567"), false);
});

test("toxic top10 / phish trap / bundle do not arm", () => {
  resetFomoTape();
  const top10 = applyFomoTape({
    channel: "bobo8567",
    ca: "0x2222222222222222222222222222222222222222",
    pushIndex: 1,
    top10: 73.8,
    rawText: "Top 10 持仓占比: 73.8% (⚠️ 庄家控盘过高)",
  });
  assert.equal(top10.kind, "toxic");
  assert.equal(top10.armLp, false);

  const phish = applyFomoTape({
    channel: "bobo8567",
    ca: "0x3333333333333333333333333333333333333333",
    pushIndex: 1,
    phish: 54.7,
    rawText: "钓鱼钱包: 54.7% ⚠️(高危诱捕!)",
  });
  assert.equal(phish.kind, "toxic");
  assert.equal(phish.armLp, false);

  const bundle = applyFomoTape({
    channel: "bobo8567",
    ca: "0x4444444444444444444444444444444444444444",
    pushIndex: 1,
    bundle: 40.9,
  });
  assert.equal(bundle.kind, "toxic");
  assert.equal(bundle.armLp, false);
});

test("Argus first print is inventory signal but never arms RH LP", () => {
  resetFomoTape();
  const snap = applyFomoTape({
    channel: "bobo9632",
    ca: "0x5555555555555555555555555555555555555555",
    pushIndex: 1,
    vol5m: 8000,
    top10: 30,
    bundle: 0,
    chain: "Argus",
    platform: "Argus",
  });
  assert.equal(snap.kind, "inventory");
  assert.equal(snap.armLp, false);
  assert.equal(
    shouldArmLpFromTape(snap.ca, "Argus", "bobo9632"),
    false,
  );
});
