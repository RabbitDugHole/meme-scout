import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMemeToken } from "./indicators.ts";
import { formatMemeAlarmText, formatMemeAlarmCard } from "./lark.ts";
import type { Candidate } from "./types.ts";

const mockCandidate: Candidate = {
  address: "0x1234567890123456789012345678901234567890",
  name: "Robin Peep",
  symbol: "PEEP",
  stage: "graduated",
  ageMs: 3600000,
  launchedAt: new Date(Date.now() - 3600000).toISOString(),
  graduatedAt: new Date(Date.now() - 1800000).toISOString(),
  deployer: "0xdeployer00000000000000000000000000000001",
  pairToken: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  pairSymbol: "WETH",
  stockPair: null,
  mcapUsd: 150000,
  liquidityUsd: 65000,
  priceUsd: 0.00015,
  holders: 350,
  top10ExLp: 0.28,
  lpLocked: true,
  lockReason: "Pons Locker 100% Locked",
  smartBuyers2h: [
    { address: "0xwhale1", usd: 500, at: new Date().toISOString() },
    { address: "0xwhale2", usd: 350, at: new Date().toISOString() },
  ],
  verified: true,
  mintOrPause: false,
  deployerLaunchCount: 1,
  dexscreenerTrending: false,
  dexUrl: "https://dexscreener.com/robinhood/0x1234567890123456789012345678901234567890",
  explorerUrl: "https://robinhoodchain.blockscout.com/token/0x1234567890123456789012345678901234567890",
  ponsUrl: "https://app.ponsvault.com/token/0x1234567890123456789012345678901234567890",
  tweetUrl: "https://x.com/peep_meme",
  tweetIsOriginal: true,
  narrative: "First community meme on Robinhood chain",
  quoteSymbol: "WETH",
  volumeH1: 45000,
  priceChangeH1: 18.5,
  lights: {
    lp_gt_50k: "PASS",
    holders_gt_100: "PASS",
    top10_lt_60: "PASS",
    lp_locked: "PASS",
    smart_money_2plus: "PASS",
  },
  soft: {
    unverified_or_mint: "PASS",
    serial_deployer: "PASS",
    late_layer: "PASS",
  },
  verdict: "ALERT",
  tier: 3,
  hardPassed: 5,
  reasons: [],
};

test("evaluateMemeToken produces high score and S-Tier for solid meme token", () => {
  const ind = evaluateMemeToken(mockCandidate, {
    liquidity: { usd: 65000 },
    marketCap: 150000,
    volume: { h1: 45000, h24: 120000, m5: 5000 },
    priceChange: { h1: 18.5, m5: 3.2, h24: 45.0 },
    txns: { h1: { buys: 120, sells: 40 } },
  });

  assert.equal(ind.isLpLocked, true);
  assert.equal(ind.isMintDisabled, true);
  assert.equal(ind.isVerified, true);
  assert.equal(ind.smartBuyersCount, 2);
  assert.equal(ind.holderHealth, "decentralized");
  assert.equal(ind.netBuyersEstimate, "strong_buy");
  assert.ok(ind.totalScore >= 80, `Expected score >= 80, got ${ind.totalScore}`);
  assert.equal(ind.potentialTier, "S");
  assert.equal(ind.isPotentialAlarm, true);
});

test("formatMemeAlarmText strictly begins with ** prefix", () => {
  const ind = evaluateMemeToken(mockCandidate);
  const text = formatMemeAlarmText(mockCandidate, ind);

  assert.ok(text.startsWith("**"), "Alarm message text MUST strictly begin with '**'");
  assert.ok(text.includes("$PEEP"), "Must contain token symbol");
  assert.ok(text.includes("0x1234567890123456789012345678901234567890"), "Must contain contract address");
  assert.ok(text.includes("S-Tier"), "Must include tier rating");
});

test("evaluateMemeToken flags unlocked LP and low score for risky token", () => {
  const riskyCandidate: Candidate = {
    ...mockCandidate,
    lpLocked: false,
    mintOrPause: true,
    top10ExLp: 0.85,
    holders: 12,
    smartBuyers2h: [],
    verified: false,
    liquidityUsd: 2000,
  };

  const ind = evaluateMemeToken(riskyCandidate);
  assert.equal(ind.isLpLocked, false);
  assert.equal(ind.isPotentialAlarm, false);
  assert.ok(ind.totalScore < 50, `Expected score < 50, got ${ind.totalScore}`);
});

test("formatMemeAlarmCard strictly begins with ** and contains copyable address code block", () => {
  const ind = evaluateMemeToken(mockCandidate);
  const card = formatMemeAlarmCard(mockCandidate, ind);

  assert.ok(
    card.header.title.content.startsWith("**"),
    "Card header title MUST strictly begin with '**'",
  );
  assert.equal(card.header.template, "carmine"); // Score >= 80

  const cardJson = JSON.stringify(card);
  assert.ok(
    cardJson.includes("```text\\n" + mockCandidate.address + "\\n```"),
    "Card MUST contain contract address in code block for 1-click copy",
  );
  assert.ok(cardJson.includes("DexScreener"), "Card MUST include DexScreener button");
});
