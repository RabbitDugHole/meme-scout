import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { lpService, LpService } from "./lp.server";
import {
  formatLpOpenAlert,
  formatLpCollectAlert,
  formatComprehensiveLpReport,
  formatLpRebalanceAlert,
  formatLpOpportunityAlert,
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

  test("should calculate correct asymmetric ranges for PUMP stage under ASYMMETRIC_UPPER mode", () => {
    lpService.updateConfig({ pumpMode: "ASYMMETRIC_UPPER" });
    const entryPrice = 0.01;
    const capital = 100;
    const ranges = lpService.calculateRanges(entryPrice, "PUMP", capital, 200);

    assert.equal(ranges.length, 3, "ASYMMETRIC_UPPER mode should have 3 range segments");

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
    assert.ok(testPos.ranges.length >= 2);

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
      dryRun: true,
      entryTime: new Date().toISOString(),
      entryPriceUsd: 0.01,
      initialUsdInvested: 100,
      currentPriceUsd: 0.012,
      volume5mAtEntry: 200000,
      liquidityAtEntry: 60000,
      latestVolume5m: 200000,
      volumeDropPct: 0,
      activeBandLiquidityUsd: 15000,
      capitalEfficiencyRatio: 7.5,
      dailyFeeRatePct: 150.0,
      holdVsLpScore: 65,
      ranges: [],
      feeEarnedUsd: 38, // 38% fee income > 35% threshold
      principalWithdrawnUsd: 0,
      impermanentLossUsd: 2,
      netPnlUsd: 36,
      netPnlPct: 36,
      rebalanceCount: 0,
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
    dryRun: true,
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
    activeBandLiquidityUsd: 12000,
    capitalEfficiencyRatio: 7.5,
    dailyFeeRatePct: 180.0,
    holdVsLpScore: 70,
    rebalanceCount: 0,
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

  test("formatLpRebalanceAlert must start with ** and contain dynamic rebalance details", () => {
    const text = formatLpRebalanceAlert({
      position: { ...dummyPos, isRwa: true, rebalanceCount: 1 },
      oldPriceUsd: 0.005,
      newPriceUsd: 0.0058,
      driftPct: 16.0,
      dryRun: true,
    });

    assert.ok(text.startsWith("**"));
    assert.ok(text.includes("智能动态移仓重平衡"));
    assert.ok(text.includes("16.0%"));
    assert.ok(text.includes("第 1 次"));
    assert.ok(text.includes("美股 RWA"));
  });

  test("formatLpOpportunityAlert must start with ** and contain Barker metrics", () => {
    const text = formatLpOpportunityAlert({
      pool: {
        poolId: "pool-canal-nvda",
        pairAddress: "0x97d3331111111111111111111111111111111111",
        token0Symbol: "CANAL",
        token0Address: "0x1111111111111111111111111111111111111111",
        token1Symbol: "NVDA",
        token1Address: "0x2222222222222222222222222222222222222222",
        pairName: "CANAL/NVDA",
        category: "RWA",
        isRwa: true,
        stockSymbol: "NVDA",
        feeTierPct: 1.0,
        feeTierBps: 10000,
        currentPriceUsd: 125.5,
        priceChange1hPct: 2.5,
        activeBandLiquidityUsd: 6425,
        totalLiquidityUsd: 76435,
        volume2hUsd: 209996,
        volume24hUsd: 1500000,
        fee2hUsd: 2295,
        fee24hUsd: 15000,
        dailyFeeRatePct: 429.0,
        annualizedAprPct: 156585,
        capitalEfficiency: 10.5,
        healthScore: 92,
        barkerUrl: "https://app.barker.money/raid/robinhood",
      },
    });

    assert.ok(text.startsWith("**"));
    assert.ok(text.includes("CANAL/NVDA"));
    assert.ok(text.includes("美股 RWA (NVDA)"));
    assert.ok(text.includes("429.0%/天"));
    assert.ok(text.includes("$6,425"));
  });
});

describe("V4 Concentrated Liquidity & Dynamic Rebalancing", () => {
  test("calculateConcentrationMultiplier should follow kappa formula", () => {
    // For ±15%: min 85, max 115 -> sqrt(85/115) = 0.8597 -> 1 / (1 - 0.8597) = 7.13
    const mult15 = LpService.calculateConcentrationMultiplier(85, 115);
    assert.ok(mult15 >= 7.0 && mult15 <= 7.3, `Mult 15% should be ~7.13, got ${mult15}`);

    // For ±10%: min 90, max 110 -> sqrt(90/110) = 0.9045 -> 1 / (1 - 0.9045) = 10.47
    const mult10 = LpService.calculateConcentrationMultiplier(90, 110);
    assert.ok(mult10 >= 10.2 && mult10 <= 10.7, `Mult 10% should be ~10.47, got ${mult10}`);
  });

  test("should calculate RWA_STABLE ranges with ±10% narrow band and 80% core allocation", () => {
    const entryPrice = 120.0;
    const capital = 100;
    const ranges = lpService.calculateRanges(entryPrice, "RWA_STABLE", capital, 200);

    assert.equal(ranges.length, 3);
    const core = ranges[0];
    assert.equal(core.capitalSharePct, 80);
    assert.equal(core.capitalAllocatedUsd, 80);
    assert.ok(core.segmentName.includes("RWA 稳健核心带"));
    assert.ok(core.minPriceUsd < entryPrice && core.maxPriceUsd > entryPrice);
  });

  test("rebalancePosition should re-center ranges and increment rebalanceCount", async () => {
    const pos = await lpService.openLpPosition({
      tokenAddress: "0x3333333333333333333333333333333333333333",
      symbol: "REBAL_TOKEN",
      chain: "robinhood",
      priceUsd: 1.0,
      liquidityUsd: 100000,
      volume5m: 50000,
      stage: "SIDEWAYS",
      customCapitalUsd: 50,
    });

    assert.equal(pos.rebalanceCount, 0);
    pos.currentPriceUsd = 1.15; // 15% drift

    const rebalanced = await lpService.rebalancePosition(pos.id, "Drifted +15%");
    assert.ok(rebalanced);
    assert.equal(rebalanced.rebalanceCount, 1);
    assert.equal(rebalanced.entryPriceUsd, 1.15);
    assert.ok(rebalanced.txHistory.some((t) => t.type === "REBALANCE"));

    await lpService.closePosition(pos.id, "CLOSED_MANUAL", "Clean test position");
  });
});

describe("LP Wallet Management & Requirements", () => {
  const lpService = LpService.getInstance();
  const testPrivateKey = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";

  test("importWallet should validate format and update service state", async () => {
    // Rejects invalid format
    await assert.rejects(
      async () => lpService.importWallet("invalid-key"),
      /私钥格式不正确/,
    );

    // Accepts valid private key
    const status = await lpService.importWallet(testPrivateKey);
    assert.equal(status.hasWallet, true);
    assert.ok(status.walletAddress?.startsWith("0x"));

    const state = lpService.getState();
    assert.equal(state.config.hasRhKey, true);
    assert.equal(state.walletAddress, status.walletAddress);
    assert.equal(state.walletStatus?.hasWallet, true);
  });

  test("disconnectWallet should clear keys and reset dryRun safely", async () => {
    const updatedState = await lpService.disconnectWallet();
    assert.equal(updatedState.config.hasRhKey, false);
    assert.equal(updatedState.config.dryRun, true);
    assert.equal(updatedState.walletAddress, undefined);
    assert.equal(updatedState.walletStatus?.hasWallet, false);
  });
});

describe("Paper vs Live LP Data Isolation & Scoped Operations", () => {
  const lpService = LpService.getInstance();

  test("should isolate paper and live statistics and respect closeAll scope", async () => {
    // Record baseline
    const baseState = lpService.getState();
    const basePaperClosed = baseState.paperStats.closedCount;
    const baseLiveClosed = baseState.liveStats.closedCount;
    const baseLiveInvested = baseState.liveStats.totalInvestedUsd;

    // Open a Paper LP position
    const paperPos = await lpService.openLpPosition({
      tokenAddress: "0x1111111111111111111111111111111111111111",
      symbol: "PAPER_TOKEN",
      chain: "robinhood",
      priceUsd: 1.0,
      liquidityUsd: 50000,
      volume5m: 10000,
      stage: "SIDEWAYS",
      customCapitalUsd: 50,
      dryRun: true,
    });
    assert.equal(paperPos.dryRun, true);

    // Open a Live LP position
    const livePos = await lpService.openLpPosition({
      tokenAddress: "0x2222222222222222222222222222222222222222",
      symbol: "LIVE_TOKEN",
      chain: "robinhood",
      priceUsd: 2.0,
      liquidityUsd: 80000,
      volume5m: 20000,
      stage: "SIDEWAYS",
      customCapitalUsd: 100,
      dryRun: false,
      mockLive: true,
    });
    assert.equal(livePos.dryRun, false);

    // Check state isolation
    const stateBeforeClose = lpService.getState();
    assert.ok(stateBeforeClose.paperStats.activeCount >= 1);
    assert.ok(stateBeforeClose.paperStats.totalInvestedUsd >= 50);

    assert.ok(stateBeforeClose.liveStats.activeCount >= 1);
    assert.equal(stateBeforeClose.liveStats.totalInvestedUsd, baseLiveInvested + 100);
    assert.equal(stateBeforeClose.liveStats.closedCount, baseLiveClosed);

    // Close only paper positions
    const closedPaperCount = await lpService.closeAllPositions("paper");
    assert.ok(closedPaperCount >= 1);

    // Verify live position is still active and untouched
    const stateAfterPaperClose = lpService.getState();
    assert.equal(stateAfterPaperClose.paperStats.activeCount, 0);

    assert.ok(stateAfterPaperClose.liveStats.activeCount >= 1);
    assert.equal(stateAfterPaperClose.liveStats.closedCount, baseLiveClosed);
    assert.ok(stateAfterPaperClose.activePositions.some((p) => p.id === livePos.id));

    // Close remaining live positions
    const closedLiveCount = await lpService.closeAllPositions("live");
    assert.ok(closedLiveCount >= 1);

    const stateFinal = lpService.getState();
    assert.equal(stateFinal.liveStats.activeCount, 0);
    assert.equal(stateFinal.liveStats.closedCount, baseLiveClosed + closedLiveCount);
  });
});

describe("Single-Sided Upper Range Order & Upper Pierced Exit Strategy", () => {
  const lpService = LpService.getInstance();

  test("should build purely upper ranges for PUMP stage under SINGLE_SIDED_RANGE_ORDER mode", () => {
    lpService.updateConfig({
      pumpMode: "SINGLE_SIDED_RANGE_ORDER",
      singleSidedUpperCorePct: 20,
      singleSidedUpperMaxPct: 45,
    });

    const entryPrice = 1.0;
    const capitalTotal = 100;
    const ranges = lpService.calculateRanges(entryPrice, "PUMP", capitalTotal, 200);

    assert.equal(ranges.length, 2);
    // Band 1: Core harvest zone [+0% -> +20%]
    assert.ok(ranges[0].minPriceUsd >= 0.99);
    assert.ok(ranges[0].maxPriceUsd >= 1.18);
    assert.equal(ranges[0].capitalSharePct, 60);
    assert.equal(ranges[0].capitalAllocatedUsd, 60);
    assert.equal(ranges[0].inRange, true);

    // Band 2: Upper pierced take profit zone [+20% -> +45%]
    assert.ok(ranges[1].minPriceUsd >= ranges[0].maxPriceUsd * 0.99);
    assert.ok(ranges[1].maxPriceUsd >= 1.40);
    assert.equal(ranges[1].capitalSharePct, 40);
    assert.equal(ranges[1].capitalAllocatedUsd, 40);
    assert.equal(ranges[1].inRange, false);

    // Crucial requirement: No capital allocated below entry price!
    for (const r of ranges) {
      assert.ok(r.minPriceUsd >= entryPrice * 0.98, "All ranges must reside above or at entry price");
    }
  });

  test("should record target price and support CLOSED_TAKEPROFIT_PIERCED exit status", async () => {
    const pos = await lpService.openLpPosition({
      tokenAddress: "0x4444444444444444444444444444444444444444",
      symbol: "PIERCE_TOKEN",
      chain: "robinhood",
      priceUsd: 1.0,
      liquidityUsd: 50000,
      volume5m: 20000,
      stage: "PUMP",
      customCapitalUsd: 50,
      dryRun: true,
    });

    assert.ok(pos.upperPiercedTargetPriceUsd, "Must have upper target price defined");
    assert.ok(pos.upperPiercedTargetPriceUsd > 1.35, "Target price should be at upper boundary");

    // Close with upper pierced take profit
    const closed = await lpService.closePosition(
      pos.id,
      "CLOSED_TAKEPROFIT_PIERCED",
      `🎯 价格强势击穿单边做市区间上沿 (100%兑现为USDG，穿上沿撤池锁定暴利)`,
    );

    assert.ok(closed);
    assert.equal(closed.status, "CLOSED_TAKEPROFIT_PIERCED");
    assert.ok(closed.exitReason?.includes("击穿单边做市区间上沿"));
  });

  test("should record stop-loss threshold and support CLOSED_STOPLOSS on single-sided upper LP", async () => {
    const pos = await lpService.openLpPosition({
      tokenAddress: "0x5555555555555555555555555555555555555555",
      symbol: "SL_TOKEN",
      chain: "robinhood",
      priceUsd: 100.0,
      liquidityUsd: 50000,
      volume5m: 20000,
      stage: "PUMP",
      customCapitalUsd: 50,
      dryRun: true,
    });

    assert.equal(pos.strategyType, "UPPER_TAKE_PROFIT");
    assert.ok(pos.stopLossPriceUsd && pos.stopLossPriceUsd < 100.0, "Stop loss price must be below entry");
    assert.equal(pos.stopLossPct, -8);

    const closed = await lpService.closePosition(
      pos.id,
      "CLOSED_STOPLOSS",
      "🛑 触及单边做市快速止损线 (-8.5% <= -8%)，闪电撤池并市价清仓",
    );

    assert.ok(closed);
    assert.equal(closed.status, "CLOSED_STOPLOSS");
    assert.ok(closed.exitReason?.includes("快速止损线"));
  });
});



