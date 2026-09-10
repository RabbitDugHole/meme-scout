import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { barkerService } from "./barker.server";
import { v4PoolRadarService } from "./v4-pool-radar.server";
import { extractRwaStock, isRwaSymbol } from "./stocks";

before(() => {
  v4PoolRadarService.stop();
});

after(() => {
  v4PoolRadarService.stop();
});

describe("Barker V4 Pool Indexing & RWA Tagging", () => {
  test("extractRwaStock should correctly identify stock pairs", () => {
    const nvdaMatch = extractRwaStock("CANAL/NVDA");
    assert.equal(nvdaMatch.isRwa, true);
    assert.equal(nvdaMatch.stockSymbol, "NVDA");

    const aaplMatch = extractRwaStock("CANAL/AAPL");
    assert.equal(aaplMatch.isRwa, true);
    assert.equal(aaplMatch.stockSymbol, "AAPL");

    const memeMatch = extractRwaStock("SHROOM/USDG");
    assert.equal(memeMatch.isRwa, false);

    assert.equal(isRwaSymbol("TSLA"), true);
    assert.equal(isRwaSymbol("DOGE"), false);
  });

  test("getMarketSummary should return parsed pools and summary", async () => {
    const summary = await barkerService.getMarketSummary();
    assert.ok(summary);
    assert.ok(Array.isArray(summary.topYieldPools));
    assert.ok(Array.isArray(summary.rwaPools));
    assert.ok(Array.isArray(summary.memePools));
    assert.ok(typeof summary.avgDailyFeeRatePct === "number");

    if (summary.topYieldPools.length > 0) {
      const top = summary.topYieldPools[0];
      assert.ok(top.poolId);
      assert.ok(top.pairName);
      assert.ok(typeof top.dailyFeeRatePct === "number");
      assert.ok(typeof top.activeBandLiquidityUsd === "number");
      assert.ok(typeof top.capitalEfficiency === "number");
      assert.ok(top.dailyFeeRatePct >= 0);
    }
  });

  test("radar service should detect opportunities and return counts", async () => {
    const scanResult = await v4PoolRadarService.scanForOpportunities();
    assert.ok(typeof scanResult.opportunitiesCount === "number");
    assert.ok(typeof scanResult.newPoolsCount === "number");
    assert.ok(scanResult.summary);
  });
});
