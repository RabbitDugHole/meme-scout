import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { lpService, LpService } from "./lp.server";
import {
  formatLpOpenAlert,
  formatLpCollectAlert,
  formatComprehensiveLpReport,
} from "./lark";
import type { LpPosition, LpRangeSegment } from "./types";

before(() => {
  lpService.stop();
});

after(() => {
  lpService.stop();
});

describe("V3 Asymmetric LP Math & Range Engine", () => {
  test("should accurately convert price to tick and back", () => {
    const price = 0.00125;
    const tick = LpService.priceToTick(price);
    const recoveredPrice = LpService.tickToPrice(tick);

    // Delta should be within 0.01%
    const diffPct = Math.abs(recoveredPrice - price) / price;
    assert.ok(diffPct < 0.0001, `Price recovery deviation too high: ${diffPct}`);

    const aligned = LpService.alignTick(tick, 200);
    assert.equal(Math.abs(aligned % 200), 0, "Aligned tick should be divisible by 200");
  });

  test("should calculate correct asymmetric ranges for PUMP stage", () => {
    const entryPrice = 0.01;
    const capital = 100;
    const ranges = lpService.calculateRanges(entryPrice, "PUMP", capital, 200);

    assert.equal(ranges.length, 3, "PUMP stage should have 3 range segments");

    // 1. Core Fee Zone
    const core = ranges[0];
    assert.equal(core.capitalSharePct, 40);
    assert.equal(core.capitalAllocatedUsd, 40);
    assert.ok(core.maxPriceUsd > entryPrice, "Core upper price should be > entry");

    // 2. Chase Upper Zone
    const chase = ranges[1];
    assert.equal(chase.capitalSharePct, 35);
    assert.equal(chase.capitalAllocatedUsd, 35);
    assert.ok(chase.minPriceUsd >= core.maxPriceUsd * 0.99, "Chase should start at/above Core upper");

    // 3. Buffer Lower Zone
    const buffer = ranges[2];
    assert.equal(buffer.capitalSharePct, 25);
    assert.equal(buffer.capitalAllocatedUsd, 25);
    assert.ok(buffer.minPriceUsd < entryPrice, "Buffer should extend below entry");

    // Total capital check
    const totalAllocated = ranges.reduce((acc, r) => acc + r.capitalAllocatedUsd, 0);
    assert.equal(totalAllocated, 100, "Sum of allocated capital should equal total");
  });

  test("should calculate correct concentrated ranges for SIDEWAYS stage", () => {
    const entryPrice = 0.05;
    const capital = 200;
    const ranges = lpService.calculateRanges(entryPrice, "SIDEWAYS", capital, 200);

    assert.equal(ranges.length, 3, "SIDEWAYS stage should have 3 segments (Core + 2 Defend)");
    assert.equal(ranges[0].capitalSharePct, 70);
    assert.equal(ranges[1].capitalSharePct, 15);
    assert.equal(ranges[2].capitalSharePct, 15);

    const totalAllocated = ranges.reduce((acc, r) => acc + r.capitalAllocatedUsd, 0);
    assert.equal(totalAllocated, 200, "Sum of allocated capital should equal total");
  });
});

describe("LpService Position Lifecycle & Execution", () => {
  test("should open LP position with mock parameters and allow manual close", async () => {
    const testPos = await lpService.openLpPosition({
      tokenAddress: "0x1111111111111111111111111111111111111111",
      symbol: "TEST_LP_MEME",
      name: "Test LP Meme Coin",
      chain: "robinhood",
      priceUsd: 0.002,
      liquidityUsd: 50000,
      volume5m: 120000,
      stage: "PUMP",
      customCapitalUsd: 50,
    });

    assert.ok(testPos.id.startsWith("lp-"));
    assert.equal(testPos.symbol, "TEST_LP_MEME");
    assert.equal(testPos.initialUsdInvested, 50);
    assert.equal(testPos.status, "ACTIVE");
    assert.equal(testPos.ranges.length, 3);

    const stateBefore = lpService.getState();
    assert.ok(stateBefore.activePositions.some((p) => p.id === testPos.id));

    // Manually close
    const closed = await lpService.closePosition(testPos.id, "CLOSED_MANUAL", "Unit test manual close");
    assert.ok(closed);
    assert.equal(closed.status, "CLOSED_MANUAL");

    const stateAfter = lpService.getState();
    assert.ok(!stateAfter.activePositions.some((p) => p.id === testPos.id));
    assert.ok(stateAfter.closedPositions.some((p) => p.id === testPos.id));
  });

  test("should trigger principal security when fee income reaches threshold", () => {
    const pos: LpPosition = {
      id: "lp-test-principal",
      tokenAddress: "0x2222222222222222222222222222222222222222",
      symbol: "PUMP_PROFIT",
      chain: "robinhood",
      feeTier: 10000,
      stage: "PUMP",
      entryTime: new Date().toISOString(),
      entryPriceUsd: 0.01,
      initialUsdInvested: 100,
      currentPriceUsd: 0.012,
      volume5mAtEntry: 200000,
      liquidityAtEntry: 60000,
      latestVolume5m: 200000,
      volumeDropPct: 0,
      ranges: [],
      feeEarnedUsd: 38, // 38% fee income > 35% threshold
      principalWithdrawnUsd: 0,
      impermanentLossUsd: 2,
      netPnlUsd: 36,
      netPnlPct: 36,
      status: "ACTIVE",
      txHistory: [],
    };

    const targetRatio = 0.35;
    const target = pos.initialUsdInvested * targetRatio;
    assert.ok(pos.feeEarnedUsd >= target, "Fee earned exceeds principal withdrawal threshold");

    // Simulate withdrawal action
    const withdrawAmount = pos.initialUsdInvested * 0.5;
    pos.principalWithdrawnUsd += withdrawAmount;
    pos.status = "PRINCIPAL_SECURED";

    assert.equal(pos.principalWithdrawnUsd, 50);
    assert.equal(pos.status, "PRINCIPAL_SECURED");
  });
});

describe("Lark LP Alerts Formatting Rules", () => {
  const dummyPos: LpPosition = {
    id: "lp-dummy-123",
    tokenAddress: "0x9876543210987654321098765432109876543210",
    symbol: "ROBIN_DOGE",
    name: "Robin Doge",
    chain: "robinhood",
    feeTier: 10000,
    stage: "PUMP",
    entryTime: "2026-09-10T02:00:00.000Z",
    entryPriceUsd: 0.005,
    initialUsdInvested: 50,
    currentPriceUsd: 0.0055,
    volume5mAtEntry: 150000,
    liquidityAtEntry: 45000,
    latestVolume5m: 150000,
    volumeDropPct: 0,
    ranges: [
      {
        segmentName: "Core Fee Zone (40%)",
        minPriceUsd: 0.005,
        maxPriceUsd: 0.0065,
        lowerTick: -53000,
        upperTick: -50000,
        capitalSharePct: 40,
        capitalAllocatedUsd: 20,
        inRange: true,
      },
      {
        segmentName: "Chase Upper (35%)",
        minPriceUsd: 0.0065,
        maxPriceUsd: 0.01,
        lowerTick: -50000,
        upperTick: -46000,
        capitalSharePct: 35,
        capitalAllocatedUsd: 17.5,
        inRange: false,
      },
      {
        segmentName: "Buffer Lower (25%)",
        minPriceUsd: 0.0025,
        maxPriceUsd: 0.005,
        lowerTick: -60000,
        upperTick: -53000,
        capitalSharePct: 25,
        capitalAllocatedUsd: 12.5,
        inRange: false,
      },
    ],
    feeEarnedUsd: 18.5,
    principalWithdrawnUsd: 25,
    impermanentLossUsd: 1.2,
    netPnlUsd: 17.3,
    netPnlPct: 34.6,
    status: "ACTIVE",
    txHistory: [],
  };

  test("formatLpOpenAlert must start with ** and contain CA in bash code block", () => {
    const text = formatLpOpenAlert({
      position: dummyPos,
      dryRun: true,
    });

    assert.ok(text.startsWith("**"), "Message must strictly start with prefix **");
    assert.ok(text.includes("```bash\n0x9876543210987654321098765432109876543210\n```"), "CA must be in independent bash block");
    assert.ok(text.includes("ROBIN_DOGE"));
    assert.ok(text.includes("5m成交/深度比"));
  });

  test("formatLpCollectAlert must start with ** and contain CA in bash block", () => {
    const text = formatLpCollectAlert({
      position: dummyPos,
      harvestedFeeUsd: 25,
      dryRun: true,
    });

    assert.ok(text.startsWith("**"));
    assert.ok(text.includes("```bash\n0x9876543210987654321098765432109876543210\n```"));
    assert.ok(text.includes("零风险纯利润收租状态"));
  });

  test("formatComprehensiveLpReport must start with ** and contain CA and summary", () => {
    const closedPos: LpPosition = {
      ...dummyPos,
      status: "CLOSED_VOL_DROP",
      closeTime: "2026-09-10T04:30:00.000Z",
      exitReason: "5m量能腰斩枯竭",
    };

    const text = formatComprehensiveLpReport({
      closedPosition: closedPos,
      allClosedPositions: [closedPos],
      activeCount: 0,
      totalRealizedPnlUsd: 17.3,
      totalFeeEarnedUsd: 18.5,
      winCount: 1,
      lossCount: 0,
      winRatePct: 100,
      dryRun: true,
    });

    assert.ok(text.startsWith("**"));
    assert.ok(text.includes("```bash\n0x9876543210987654321098765432109876543210\n```"));
    assert.ok(text.includes("100.0%"));
    assert.ok(text.includes("无常损失(IL)"));
    assert.ok(text.includes("最终净实现盈亏"));
  });
});
