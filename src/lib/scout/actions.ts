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


