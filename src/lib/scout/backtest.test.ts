import assert from "node:assert/strict";
import test from "node:test";
import { formatBacktestReportText } from "./lark";
import type { BacktestReport } from "./types";

test("formatBacktestReportText should strictly start with ** and contain list items with bash CA block", () => {
  const mockReport: BacktestReport = {
    id: "test-report-1h",
    interval: "1h",
    timestamp: "2026-09-09T09:00:00.000Z",
    summary: {
      interval: "1h",
      totalTokens: 2,
      positiveTokens: 2,
      takeProfitTokens: 2,
      doubledTokens: 1,
      lossTokens: 0,
      winRatePct: 100,
      netPositiveRatePct: 100,
      avgChangePct: 85.5,
      maxGainPct: 150.0,
      mvpSymbol: "PEPE",
      mvpGainPct: 150.0,
    },
    items: [
      {
        tokenAddress: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
        symbol: "PEPE",
        chain: "Robinhood Chain",
        source: "robinhood-scanner",
        score: 88,
        alertTimestamp: "2026-09-09T08:00:00.000Z",
        alertPriceUsd: 0.001,
        reviewTimestamp: "2026-09-09T09:00:00.000Z",
        reviewPriceUsd: 0.0022,
        priceChangePct: 120.0,
        highestPriceUsd: 0.0025,
        highestGainPct: 150.0,
        verdict: "PUMP_2X",
        statusText: "🌟 翻倍 2x (大幅止盈)",
      },
      {
        tokenAddress: "0x1234567890123456789012345678901234567890",
        symbol: "DOGE",
        chain: "BSC",
        source: "telegram-channel",
        score: 82,
        alertTimestamp: "2026-09-09T08:10:00.000Z",
        alertPriceUsd: 0.05,
        reviewTimestamp: "2026-09-09T09:00:00.000Z",
        reviewPriceUsd: 0.075,
        priceChangePct: 50.0,
        highestPriceUsd: 0.076,
        highestGainPct: 52.0,
        verdict: "PROFIT_TAKE",
        statusText: "🎯 达成止盈 (波段盈利)",
      },
    ],
    larkOk: true,
  };

  const text = formatBacktestReportText(mockReport);

  // 1. Must strictly start with **
  assert.ok(text.startsWith("**"), "Backtest report must start with **");

  // 2. Must contain bash code blocks for both contract addresses
  assert.ok(
    text.includes("```bash\n0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e\n```"),
    "Must format PEPE contract in standalone bash code block",
  );
  assert.ok(
    text.includes("```bash\n0x1234567890123456789012345678901234567890\n```"),
    "Must format DOGE contract in standalone bash code block",
  );

  // 3. Must contain win rate and peak metrics
  assert.ok(text.includes("100.0%"), "Must include 100% win rate");
  assert.ok(text.includes("$PEPE"), "Must mention MVP symbol");
  assert.ok(text.includes("+150.0%"), "Must include peak gain");
  assert.ok(text.includes("快进快出操盘纪律"), "Must include discipline guidance");
});
