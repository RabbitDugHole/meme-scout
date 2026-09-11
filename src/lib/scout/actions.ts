import { createServerFn } from "@tanstack/react-start";
import { isAddress } from "./format";
import type { StockAsset } from "./types";

export const scanRadar = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runScan } = await import("./scan.server");
    return runScan(Boolean(data?.force));
  });

export const inspectToken = createServerFn({ method: "POST" })
  .validator((input: { address: string }) => {
    const address = input.address.trim();
    if (!isAddress(address)) throw new Error("需要 0x 开头的 40 位合约地址");
    return { address };
  })
  .handler(async ({ data }) => {
    const { inspectAddress } = await import("./scan.server");
    return inspectAddress(data.address);
  });

export const refreshQuotes = createServerFn({ method: "POST" })
  .validator((input: { addresses: string[] }) => ({
    addresses: (input.addresses ?? []).filter(isAddress).slice(0, 8),
  }))
  .handler(async ({ data }) => {
    const { quotePrices } = await import("./scan.server");
    return quotePrices(data.addresses);
  });

export const listStocks = createServerFn({ method: "GET" }).handler(
  async (): Promise<StockAsset[]> => {
    const { fetchStockAssets } = await import("./stocks");
    return fetchStockAssets();
  },
);

export const scoreTokenNarrative = createServerFn({ method: "POST" })
  .validator((input: {
    name: string;
    symbol: string;
    narrative: string | null;
    tweetUrl: string | null;
    stockPair: string | null;
  }) => input)
  .handler(async ({ data }) => {
    const { scoreNarrative } = await import("./scan.server");
    return scoreNarrative(data);
  });

export const getMonitorStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { monitorService } = await import("./monitor.server");
    return monitorService.getState();
  },
);

export const triggerMonitorScan = createServerFn({ method: "POST" })
  .validator((input: { forceCheck?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { monitorService } = await import("./monitor.server");
    return monitorService.runCycle(Boolean(data?.forceCheck));
  });

export const updateMonitorConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      webhookUrl?: string;
      minScoreThreshold?: number;
      minLiquidityUsd?: number;
      cooldownMinutes?: number;
      intervalSeconds?: number;
      autoAlarmEnabled?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { monitorService } = await import("./monitor.server");
    return monitorService.updateConfig(data);
  });

export const sendTestLarkAlarm = createServerFn({ method: "POST" })
  .validator((input: { webhookUrl?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { sendLarkTestMessage } = await import("./lark");
    return sendLarkTestMessage(data?.webhookUrl);
  });

export const sendCandidateToLark = createServerFn({ method: "POST" })
  .validator((input: { candidate: any }) => input)
  .handler(async ({ data }) => {
    const { monitorService } = await import("./monitor.server");
    return monitorService.sendManualAlarm(data.candidate);
  });

export const getTgMonitorStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.getState();
  },
);

export const triggerTgPoll = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.runPollCycle(Boolean(data?.force));
  });

export const updateTgMonitorConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      webhookUrl?: string;
      minScoreThreshold?: number;
      minLiquidityUsd?: number;
      cooldownMinutes?: number;
      pollIntervalSeconds?: number;
      autoAlarmEnabled?: boolean;
      enabled?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.updateConfig(data);
  });

export const addTgChannel = createServerFn({ method: "POST" })
  .validator((input: { channel: string; name?: string }) => input)
  .handler(async ({ data }) => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.addChannel(data.channel, data.name);
  });

export const removeTgChannel = createServerFn({ method: "POST" })
  .validator((input: { channel: string }) => input)
  .handler(async ({ data }) => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.removeChannel(data.channel);
  });

export const toggleTgChannel = createServerFn({ method: "POST" })
  .validator((input: { channel: string; enabled?: boolean }) => input)
  .handler(async ({ data }) => {
    const { tgMonitorService } = await import("./tg-monitor.server");
    return tgMonitorService.toggleChannel(data.channel, data.enabled);
  });

export const getBacktestStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { backtestEngine } = await import("./backtest.server");
    return backtestEngine.getState();
  },
);

export const triggerHourlyBacktest = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { backtestEngine } = await import("./backtest.server");
    return backtestEngine.runHourlyBacktest(Boolean(data?.force));
  });

export const triggerDailyBacktest = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { backtestEngine } = await import("./backtest.server");
    return backtestEngine.runDailyBacktest(Boolean(data?.force));
  });

export const updateBacktestConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      enabled?: boolean;
      hourlyCheckEnabled?: boolean;
      dailyCheckEnabled?: boolean;
      priceTrackIntervalMinutes?: number;
      takeProfitThresholdPct?: number;
      autoLarkPush?: boolean;
      webhookUrl?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { backtestEngine } = await import("./backtest.server");
    return backtestEngine.updateConfig(data);
  });

export const getTradeState = createServerFn({ method: "GET" }).handler(
  async () => {
    const { tradeService } = await import("./trade.server");
    return tradeService.getState();
  },
);

export const updateTradeConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      dryRun?: boolean;
      autoBuyEnabled?: boolean;
      buyAmountBscBnb?: number;
      buyAmountRhEth?: number;
      maxPriceDeviationPct?: number;
      executionTimeoutSeconds?: number;
      slippagePct?: number;
      gasMultiplier?: number;
      tp1Pct?: number;
      tp1SellRatioPct?: number;
      tp2Pct?: number;
      tp2SellRatioPct?: number;
      tp3TrailingStopPct?: number;
      stopLossPct?: number;
      maxHoldTimeMinutes?: number;
      emergencyLiquidityDrainPct?: number;
      larkTradeNotification?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { tradeService } = await import("./trade.server");
    return tradeService.updateConfig(data);
  });

export const executeManualBuy = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tokenAddress: string;
      symbol: string;
      name?: string;
      chain: "bsc" | "robinhood";
      amountNative: number;
      expectedPriceUsd: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { tradeService } = await import("./trade.server");
    return tradeService.executeBuy({
      ...data,
      source: "manual-ui",
    });
  });

export const closePosition = createServerFn({ method: "POST" })
  .validator((input: { positionId: string }) => input)
  .handler(async ({ data }) => {
    const { tradeService } = await import("./trade.server");
    return tradeService.manualClosePosition(data.positionId);
  });

export const closeAllPositions = createServerFn({ method: "POST" }).handler(
  async () => {
    const { tradeService } = await import("./trade.server");
    return tradeService.closeAllPositions();
  },
);

// ==========================================
// V3 Asymmetric LP Server Actions
// ==========================================

export const getLpState = createServerFn({ method: "GET" }).handler(
  async () => {
    const { lpService } = await import("./lp.server");
    return lpService.getState();
  },
);

export const updateLpConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      dryRun?: boolean;
      autoLpEnabled?: boolean;
      capitalPerPoolUsd?: number;
      maxActivePools?: number;
      minVolumeToLiquidityRatio?: number;
      preferredFeeTier?: number;
      pumpCoreSharePct?: number;
      pumpCoreUpPct?: number;
      pumpChaseSharePct?: number;
      pumpChaseUpPct?: number;
      pumpBufferSharePct?: number;
      pumpBufferDownPct?: number;
      sidewaysCoreSharePct?: number;
      sidewaysCoreWidthPct?: number;
      rwaBandWidthPct?: number;
      rwaCapitalUsd?: number;
      enableAutoRebalance?: boolean;
      rebalanceDriftThresholdPct?: number;
      maxRebalancesPerPosition?: number;
      netPnlStopLossPct?: number;
      minOpportunityFeeRatePct?: number;
      minOpportunityVolume2hUsd?: number;
      maxOpportunityActiveLiqUsd?: number;
      opportunityAlertCooldownMin?: number;
      withdrawPrincipalFeeRatio?: number;
      volumeDropExitThresholdPct?: number;
      stopLossPriceDropPct?: number;
      maxHoldMinutes?: number;
      larkNotification?: boolean;
      webhookUrl?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { lpService } = await import("./lp.server");
    return lpService.updateConfig(data);
  });

export const openManualLp = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tokenAddress: string;
      symbol: string;
      name?: string;
      chain: string;
      pairAddress?: string;
      priceUsd: number;
      liquidityUsd: number;
      volume5m: number;
      stage: "PUMP" | "SIDEWAYS" | "RWA_STABLE";
      feeTier?: number;
      category?: "RWA" | "MEME" | "BLUECHIP";
      isRwa?: boolean;
      stockSymbol?: string;
      activeBandLiquidityUsd?: number;
      customCapitalUsd?: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { lpService } = await import("./lp.server");
    return lpService.openLpPosition(data);
  });

export const rebalanceLpPositionAction = createServerFn({ method: "POST" })
  .validator((input: { positionId: string }) => input)
  .handler(async ({ data }) => {
    const { lpService } = await import("./lp.server");
    return lpService.rebalancePosition(
      data.positionId,
      "控制面板手动触发智能移仓重平衡",
    );
  });

export const closeLpPosition = createServerFn({ method: "POST" })
  .validator((input: { positionId: string }) => input)
  .handler(async ({ data }) => {
    const { lpService } = await import("./lp.server");
    return lpService.closePosition(
      data.positionId,
      "CLOSED_MANUAL",
      "用户控制面板手动撤池结项",
    );
  });

export const closeAllLpPositions = createServerFn({ method: "POST" }).handler(
  async () => {
    const { lpService } = await import("./lp.server");
    return lpService.closeAllPositions();
  },
);

export const getV4MarketSummary = createServerFn({ method: "GET" }).handler(
  async () => {
    const { barkerService } = await import("./barker.server");
    return barkerService.getMarketSummary();
  },
);

export const triggerV4RadarScan = createServerFn({ method: "POST" }).handler(
  async () => {
    const { v4PoolRadarService } = await import("./v4-pool-radar.server");
    return v4PoolRadarService.scanForOpportunities();
  },
);

export const importLpWalletAction = createServerFn({ method: "POST" })
  .validator((input: { privateKey: string }) => {
    const key = input.privateKey.trim();
    if (!key) throw new Error("请输入 64 位十六进制做市钱包私钥");
    return { privateKey: key };
  })
  .handler(async ({ data }) => {
    const { lpService } = await import("./lp.server");
    return lpService.importWallet(data.privateKey);
  });

export const disconnectLpWalletAction = createServerFn({ method: "POST" }).handler(
  async () => {
    const { lpService } = await import("./lp.server");
    return lpService.disconnectWallet();
  },
);

export const getLpWalletStatusAction = createServerFn({ method: "GET" }).handler(
  async () => {
    const { lpService } = await import("./lp.server");
    return lpService.getWalletStatus(true);
  },
);

// ==========================================
// Google 2FA Authentication Server Actions
// ==========================================

export const getTwoFactorStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { twoFactorService } = await import("./two-factor.server");
    return twoFactorService.getStatus();
  },
);

export const createTwoFactorSetup = createServerFn({ method: "POST" }).handler(
  async () => {
    const { twoFactorService } = await import("./two-factor.server");
    return twoFactorService.createSetupSession();
  },
);

export const confirmTwoFactorSetup = createServerFn({ method: "POST" })
  .validator((input: { setupId: string; code: string }) => input)
  .handler(async ({ data }) => {
    const { twoFactorService } = await import("./two-factor.server");
    return twoFactorService.confirmSetup(data);
  });

export const verifyTwoFactorLogin = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }) => {
    const { twoFactorService } = await import("./two-factor.server");
    return twoFactorService.verifyLogin(data.code);
  });

export const validateTwoFactorSession = createServerFn({ method: "POST" })
  .validator((input: { token?: string | null }) => input)
  .handler(async ({ data }) => {
    const { twoFactorService } = await import("./two-factor.server");
    return {
      valid: twoFactorService.validateSession(data.token),
      isConfigured: twoFactorService.getStatus().isConfigured,
    };
  });

export const resetTwoFactor = createServerFn({ method: "POST" })
  .validator((input: { currentCode: string }) => input)
  .handler(async ({ data }) => {
    const { twoFactorService } = await import("./two-factor.server");
    return twoFactorService.resetConfig(data.currentCode);
  });

