import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { formatTradeAlertText } from "./lark";
import { tradeService, TradeService } from "./trade.server";
import type { TradePosition, TradeTxRecord } from "./types";

after(() => {
  tradeService.stop();
});

describe("Trade Alerts Lark Formatting", () => {
  it("should format trade buy alerts strictly starting with ** and independent bash block for CA", () => {
    const mockPos: TradePosition = {
      id: "pos-1",
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      symbol: "PEPE_MOON",
      name: "Pepe Moon Token",
      chain: "bsc",
      source: "test",
      entryTime: new Date().toISOString(),
      entryPriceUsd: 0.00045,
      entryPriceNative: 0.05,
      entryAmountTokens: "10000",
      initialTokens: "10000",
      remainingTokens: "10000",
      entryCostNative: 0.05,
      entryCostUsd: 30,
      highestPriceUsd: 0.00045,
      highestGainPct: 0,
      currentPriceUsd: 0.00045,
      currentGainPct: 0,
      status: "OPEN",
      tp1Done: false,
      tp2Done: false,
      txHistory: [],
      realizedPnlUsd: 0,
      realizedPnlNative: 0,
    };

    const mockTx: TradeTxRecord = {
      id: "tx-1",
      type: "BUY",
      timestamp: new Date().toISOString(),
      amountIn: "0.05 BNB",
      amountOut: "10000 PEPE_MOON",
      priceUsd: 0.00045,
      priceNative: 0.05,
      dryRun: true,
      status: "CONFIRMED",
    };

    const text = formatTradeAlertText({
      type: "BUY",
      position: mockPos,
      tx: mockTx,
      dryRun: true,
    });

    assert.ok(text.startsWith("**"), "Text must start with **");
    assert.ok(text.includes("买入建仓成功"), "Must include buy action header");
    assert.ok(
      text.includes("```bash\n0x1234567890abcdef1234567890abcdef12345678\n```"),
      "CA must be formatted in independent bash block for 1-click copying",
    );
  });

  it("should format trade TP and SL alerts with correct titles", () => {
    const mockPos: TradePosition = {
      id: "pos-2",
      tokenAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      symbol: "TEST",
      chain: "robinhood",
      source: "test",
      entryTime: new Date().toISOString(),
      entryPriceUsd: 0.001,
      entryPriceNative: 0.005,
      entryAmountTokens: "5000",
      initialTokens: "5000",
      remainingTokens: "2500",
      entryCostNative: 0.005,
      entryCostUsd: 14,
      highestPriceUsd: 0.0015,
      highestGainPct: 50,
      currentPriceUsd: 0.0015,
      currentGainPct: 50,
      status: "PARTIAL_TP1",
      tp1Done: true,
      tp2Done: false,
      txHistory: [],
      realizedPnlUsd: 10.5,
      realizedPnlNative: 0.00375,
    };

    const mockTx: TradeTxRecord = {
      id: "tx-2",
      type: "SELL_TP1",
      timestamp: new Date().toISOString(),
      amountIn: "2500 TEST",
      amountOut: "0.00375 ETH",
      priceUsd: 0.0015,
      priceNative: 0.005,
      pnlUsd: 10.5,
      pnlPct: 50,
      dryRun: false,
      status: "CONFIRMED",
    };

    const tpText = formatTradeAlertText({
      type: "SELL_TP1",
      position: mockPos,
      tx: mockTx,
      dryRun: false,
    });
    assert.ok(tpText.startsWith("**"), "Must start with **");
    assert.ok(tpText.includes("第一止盈达成"));

    const slText = formatTradeAlertText({
      type: "SELL_SL",
      position: mockPos,
      tx: { ...mockTx, type: "SELL_SL", pnlUsd: -5.4, pnlPct: -18.2 },
      dryRun: true,
    });
    assert.ok(slText.startsWith("**"), "Must start with **");
    assert.ok(slText.includes("破位快速止损"));
  });
});

describe("TradeService Strategy Engine", () => {
  it("should correctly update and retrieve config", () => {
    const service = new TradeService();
    service.stop();

    service.updateConfig({
      buyAmountBscBnb: 0.08,
      stopLossPct: -15,
    });
    const updated = service.getState();
    assert.equal(updated.config.buyAmountBscBnb, 0.08);
    assert.equal(updated.config.stopLossPct, -15);

    // Reset back to standard default
    service.updateConfig({
      buyAmountBscBnb: 0.05,
      stopLossPct: -18,
    });
    const reset = service.getState();
    assert.equal(reset.config.buyAmountBscBnb, 0.05);
    assert.equal(reset.config.stopLossPct, -18);
  });

  it("should reject signals older than executionTimeoutSeconds", async () => {
    const service = new TradeService();
    service.stop();
    service.updateConfig({
      autoBuyEnabled: true,
      executionTimeoutSeconds: 60,
    });

    const res = await service.handleTokenAlert({
      tokenAddress: "0x1111111111111111111111111111111111111111",
      symbol: "OLD_MEME",
      name: "Old Meme",
      chain: "robinhood",
      source: "robinhood-scout",
      score: 85,
      priceUsd: 0.01,
      timestamp: new Date(Date.now() - 120_000).toISOString(), // 2 minutes ago
    });

    assert.equal(res.executed, false, "Should abort trade on expired signal");
    assert.ok(res.reason.includes("超时放弃"));
  });

  it("should create position and allow manual close", async () => {
    const service = new TradeService();
    service.stop();
    service.updateConfig({ dryRun: true, larkTradeNotification: false });

    const tokenAddress = `0xunit${Date.now()}00000000000000000000000000000000`.slice(0, 42);
    const buyResult = await service.executeBuy({
      tokenAddress,
      symbol: "TEST_DOGE",
      name: "Test Doge Token",
      chain: "bsc",
      amountNative: 0.05,
      expectedPriceUsd: 0.001,
      source: "unit-test",
    });

    assert.equal(buyResult.executed, true);
    assert.ok(buyResult.position);
    assert.equal(buyResult.position.symbol, "TEST_DOGE");

    const state = service.getState();
    const pos = state.activePositions.find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
    assert.ok(pos, "Active position exists in state");

    const closeResult = await service.manualClosePosition(buyResult.position.id);
    assert.equal(closeResult, true);

    const stateAfter = service.getState();
    const closedPos = stateAfter.closedPositions.find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
    assert.ok(closedPos, "Position moved to closed positions");
    assert.equal(closedPos.status, "CLOSED_MANUAL");
  });
});
