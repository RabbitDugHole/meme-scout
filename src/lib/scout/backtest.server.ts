/**
 * Meme Token Backtest & Win-Rate Engine
 *
 * Tracks every meme token alerted (from Robinhood Chain Scout and Telegram Channels),
 * records real-time price trajectories, peak ATH multiples, and drawdowns.
 * Automatically runs:
 * 1) 1-Hour Backtest: Measures immediate post-alert momentum & quick profit taking opportunity.
 * 2) 24-Hour Backtest: Daily comprehensive wrap-up measuring 24h retention and peak win-rate.
 * Pushes formatted reports to Lark Webhook bot.
 */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LARK_WEBHOOK_URL, sendLarkBacktestReport } from "./lark";
import type {
  BacktestConfig,
  BacktestReport,
  BacktestReportItem,
  BacktestState,
  BacktestSummary,
  TrackedAlertToken,
} from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORAGE_FILE = path.join(DATA_DIR, "scout-tracked-alerts.json");
const REPORTS_FILE = path.join(DATA_DIR, "scout-backtest-reports.json");

export class BacktestEngine {
  private static instance: BacktestEngine | null = null;

  private isRunning: boolean = false;
  private trackTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;

  private config: BacktestConfig = {
    enabled: true,
    hourlyCheckEnabled: true,
    dailyCheckEnabled: true,
    priceTrackIntervalMinutes: 5, // Track prices every 5 mins
    takeProfitThresholdPct: 30, // >= +30% is considered successful take-profit
    autoLarkPush: true,
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
  };

  private trackedTokens: Map<string, TrackedAlertToken> = new Map();
  private recentReports: BacktestReport[] = [];

  private lastPriceTrackTime: string | null = null;
  private lastHourlyCheckTime: string | null = null;
  private lastDailyCheckTime: string | null = null;

  private constructor() {
    this.loadFromStorage();
    this.start();
  }

  public static getInstance(): BacktestEngine {
    if (!BacktestEngine.instance) {
      BacktestEngine.instance = new BacktestEngine();
    }
    return BacktestEngine.instance;
  }

  /**
   * Load tracked tokens and reports from disk persistence.
   */
  private loadFromStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, "utf8");
        const list: TrackedAlertToken[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            this.trackedTokens.set(item.tokenAddress.toLowerCase(), item);
          }
          console.log(
            `[Backtest] 📂 成功载入 ${this.trackedTokens.size} 个历史追踪代币记录`,
          );
        }
      }

      if (fs.existsSync(REPORTS_FILE)) {
        const rawReports = fs.readFileSync(REPORTS_FILE, "utf8");
        const reports: BacktestReport[] = JSON.parse(rawReports);
        if (Array.isArray(reports)) {
          this.recentReports = reports.slice(0, 30);
        }
      }
    } catch (err: any) {
      console.warn("[Backtest] 载入存储数据异常:", err?.message || err);
    }
  }

  /**
   * Persist tracked tokens and reports to disk.
   */
  private saveToStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const list = Array.from(this.trackedTokens.values());
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(list, null, 2), "utf8");

      fs.writeFileSync(
        REPORTS_FILE,
        JSON.stringify(this.recentReports.slice(0, 30), null, 2),
        "utf8",
      );
    } catch (err: any) {
      console.warn("[Backtest] 持久化数据保存异常:", err?.message || err);
    }
  }

  public getState(): BacktestState {
    const list = Array.from(this.trackedTokens.values()).sort(
      (a, b) =>
        new Date(b.alertTimestamp).getTime() - new Date(a.alertTimestamp).getTime(),
    );

    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      trackedTokensCount: this.trackedTokens.size,
      lastHourlyCheckTime: this.lastHourlyCheckTime,
      lastDailyCheckTime: this.lastDailyCheckTime,
      lastPriceTrackTime: this.lastPriceTrackTime,
      recentReports: [...this.recentReports],
      trackedTokens: list.slice(0, 100),
    };
  }

  public updateConfig(patch: Partial<BacktestConfig>): BacktestState {
    this.config = { ...this.config, ...patch };
    return this.getState();
  }

  /**
   * Register a new alert for backtesting & price tracking.
   * Called automatically when an alert is fired.
   */
  public recordAlert(data: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain: string;
    source: "robinhood-scanner" | "telegram-channel";
    channel?: string;
    score: number;
    tier: string;
    priceUsd: number | null;
    mcapUsd?: number | null;
    liquidityUsd?: number | null;
  }): void {
    const addrKey = data.tokenAddress.toLowerCase();
    const existing = this.trackedTokens.get(addrKey);
    const now = new Date().toISOString();

    if (existing) {
      // If already recorded within 12 hours, update score if higher
      const elapsedHours =
        (Date.now() - new Date(existing.alertTimestamp).getTime()) / 3600000;
      if (elapsedHours < 12) {
        if (data.score > existing.score) {
          existing.score = data.score;
          existing.tier = data.tier;
        }
        return;
      }
    }

    const price = data.priceUsd ?? null;

    const token: TrackedAlertToken = {
      id: `${addrKey}-${Date.now()}`,
      tokenAddress: data.tokenAddress,
      symbol: data.symbol,
      name: data.name,
      chain: data.chain,
      source: data.source,
      channel: data.channel,
      score: data.score,
      tier: data.tier,
      alertTimestamp: now,
      alertPriceUsd: price,
      alertMcapUsd: data.mcapUsd ?? null,
      alertLiquidityUsd: data.liquidityUsd ?? null,

      latestPriceUsd: price,
      latestCheckTime: now,
      highestPriceUsd: price,
      highestGainPct: 0,
      lowestPriceUsd: price,
      lowestChangePct: 0,

      review1hDone: false,
      review24hDone: false,
    };

    this.trackedTokens.set(addrKey, token);
    this.saveToStorage();

    console.log(
      `[Backtest] 📝 已建档回测追踪代币: $${token.symbol} (${token.chain}) CA: ${token.tokenAddress}, 推送基准价: $${price ?? "未知"}`,
    );
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. High frequency price tracking loop (every 5 mins)
    const trackMs = this.config.priceTrackIntervalMinutes * 60 * 1000;
    this.trackTimer = setInterval(() => {
      this.trackActiveTokensPrice().catch((err) => {
        console.warn("[Backtest] 定时价格追踪异常:", err?.message || err);
      });
    }, trackMs);

    // Initial price track after 10s
    setTimeout(() => {
      this.trackActiveTokensPrice().catch(() => {});
    }, 10000);

    // 2. Hourly backtest review loop (every 1 hour)
    // Run every 60 minutes
    this.hourlyTimer = setInterval(() => {
      if (this.config.hourlyCheckEnabled) {
        this.runHourlyBacktest().catch((err) => {
          console.warn("[Backtest] 1小时回测循环异常:", err?.message || err);
        });
      }
    }, 60 * 60 * 1000);

    // 3. Daily backtest review loop (every 24 hours)
    this.dailyTimer = setInterval(() => {
      if (this.config.dailyCheckEnabled) {
        this.runDailyBacktest().catch((err) => {
          console.warn("[Backtest] 24小时回测循环异常:", err?.message || err);
        });
      }
    }, 24 * 60 * 60 * 1000);

    console.log("📈 [Backtest Engine] 土狗/Meme 收益回测与胜率追踪引擎已启动");
  }

  public stop(): void {
    if (this.trackTimer) {
      clearInterval(this.trackTimer);
      this.trackTimer = null;
    }
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
    this.isRunning = false;
  }

  /**
   * Query live price for a token across Robinhood and other chains via DexScreener.
   */
  public async fetchLivePrice(
    tokenAddress: string,
    chain?: string,
  ): Promise<{ priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null }> {
    const isRh = chain?.toLowerCase().includes("robinhood");
    const urls: string[] = [];

    if (isRh) {
      urls.push(`https://api.dexscreener.com/tokens/v1/robinhood/${tokenAddress}`);
    }
    urls.push(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MemeScout/1.0)",
          },
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as any;
          const pairs = Array.isArray(json)
            ? json
            : Array.isArray(json.pairs)
              ? json.pairs
              : [];

          if (pairs.length > 0) {
            pairs.sort(
              (a: any, b: any) =>
                (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0),
            );
            const p = pairs[0];
            const price = Number(p.priceUsd);
            if (!isNaN(price) && price > 0) {
              return {
                priceUsd: price,
                mcapUsd: Number(p.marketCap) || Number(p.fdv) || null,
                liquidityUsd: Number(p.liquidity?.usd) || null,
              };
            }
          }
        }
      } catch {
        // Try next
      }
    }

    return { priceUsd: null, mcapUsd: null, liquidityUsd: null };
  }

  /**
   * Track prices for all tokens alerted in the past 48 hours to capture peak ATH and drawdowns.
   */
  public async trackActiveTokensPrice(): Promise<{ updatedCount: number }> {
    this.lastPriceTrackTime = new Date().toISOString();
    const now = Date.now();
    const activeTokens: TrackedAlertToken[] = [];

    for (const token of this.trackedTokens.values()) {
      const elapsedHours = (now - new Date(token.alertTimestamp).getTime()) / 3600000;
      if (elapsedHours <= 48) {
        activeTokens.push(token);
      }
    }

    if (activeTokens.length === 0) return { updatedCount: 0 };

    let updatedCount = 0;
    for (const token of activeTokens) {
      const live = await this.fetchLivePrice(token.tokenAddress, token.chain);
      if (live.priceUsd != null && live.priceUsd > 0) {
        const price = live.priceUsd;
        token.latestPriceUsd = price;
        token.latestCheckTime = new Date().toISOString();

        if (token.alertPriceUsd == null || token.alertPriceUsd === 0) {
          token.alertPriceUsd = price;
        }

        const basePrice = token.alertPriceUsd;
        if (basePrice && basePrice > 0) {
          const currentRoi = ((price - basePrice) / basePrice) * 100;

          // Update Peak Price & Peak Gain %
          if (token.highestPriceUsd == null || price > token.highestPriceUsd) {
            token.highestPriceUsd = price;
            token.highestGainPct = ((price - basePrice) / basePrice) * 100;
          }

          // Update Trough Price & Drawdown %
          if (token.lowestPriceUsd == null || price < token.lowestPriceUsd) {
            token.lowestPriceUsd = price;
            token.lowestChangePct = currentRoi;
          }
        }

        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.saveToStorage();
    }

    return { updatedCount };
  }

  /**
   * 1-Hour Backtest Execution
   * Reviews tokens alerted between 45m and 150m ago (or unreviewed tokens >= 50m).
   */
  public async runHourlyBacktest(force: boolean = false): Promise<BacktestReport> {
    this.lastHourlyCheckTime = new Date().toISOString();
    const now = Date.now();
    const targetTokens: TrackedAlertToken[] = [];

    for (const token of this.trackedTokens.values()) {
      const alertMs = new Date(token.alertTimestamp).getTime();
      const elapsedMinutes = (now - alertMs) / 60000;

      if (force) {
        // In force mode, review tokens alerted in the last 3 hours
        if (elapsedMinutes <= 180) {
          targetTokens.push(token);
        }
      } else {
        // Normal mode: unreviewed and >= 50 minutes, or within 45~120 mins
        if (!token.review1hDone && elapsedMinutes >= 45 && elapsedMinutes <= 150) {
          targetTokens.push(token);
        }
      }
    }

    const items: BacktestReportItem[] = [];

    for (const token of targetTokens) {
      // Refresh current price
      const live = await this.fetchLivePrice(token.tokenAddress, token.chain);
      const curPrice = live.priceUsd ?? token.latestPriceUsd ?? token.alertPriceUsd;

      token.latestPriceUsd = curPrice;
      token.review1hDone = true;
      token.price1hUsd = curPrice;

      const basePrice = token.alertPriceUsd;
      let priceChangePct: number | null = null;

      if (basePrice && curPrice && basePrice > 0) {
        priceChangePct = ((curPrice - basePrice) / basePrice) * 100;
        token.change1hPct = priceChangePct;

        if (token.highestPriceUsd == null || curPrice > token.highestPriceUsd) {
          token.highestPriceUsd = curPrice;
          token.highestGainPct = priceChangePct;
        }
      }

      const peakGain = token.highestGainPct ?? priceChangePct ?? 0;

      let verdict: BacktestReportItem["verdict"] = "MODEST_GAIN";
      let statusText = "稳健观察";

      if (peakGain >= 200) {
        verdict = "PUMP_3X";
        statusText = "🚀 爆拉 3x+ (超级大肉)";
      } else if (peakGain >= 100) {
        verdict = "PUMP_2X";
        statusText = "🌟 翻倍 2x (充足止盈)";
      } else if (peakGain >= this.config.takeProfitThresholdPct) {
        verdict = "PROFIT_TAKE";
        statusText = "🎯 达成止盈 (波段盈利)";
      } else if (priceChangePct != null && priceChangePct < -30) {
        verdict = "DUMP_LOSS";
        statusText = "🔴 跌破支撑 (触发止损)";
      } else if (peakGain >= 15 && (priceChangePct ?? 0) < 0) {
        verdict = "PULLBACK";
        statusText = "📉 冲高回落";
      }

      items.push({
        tokenAddress: token.tokenAddress,
        symbol: token.symbol,
        chain: token.chain,
        source: token.source,
        score: token.score,
        alertTimestamp: token.alertTimestamp,
        alertPriceUsd: token.alertPriceUsd,
        reviewTimestamp: new Date().toISOString(),
        reviewPriceUsd: curPrice,
        priceChangePct,
        highestPriceUsd: token.highestPriceUsd,
        highestGainPct: token.highestGainPct,
        verdict,
        statusText,
      });
    }

    this.saveToStorage();

    const summary = this.computeSummary("1h", items);
    let larkOk = false;
    let larkMsg = "";

    const report: BacktestReport = {
      id: `backtest-1h-${now}`,
      interval: "1h",
      timestamp: new Date().toISOString(),
      summary,
      items,
      larkOk,
      larkMsg,
    };

    if (this.config.autoLarkPush && items.length > 0) {
      const sendRes = await sendLarkBacktestReport(report, this.config.webhookUrl);
      larkOk = sendRes.ok;
      larkMsg = sendRes.msg || sendRes.error || (larkOk ? "Success" : "Failed");
      report.larkOk = larkOk;
      report.larkMsg = larkMsg;
    }

    this.recentReports.unshift(report);
    if (this.recentReports.length > 30) {
      this.recentReports = this.recentReports.slice(0, 30);
    }
    this.saveToStorage();

    console.log(
      `[Backtest] ⏱️ 1小时回测完成: 统计 ${items.length} 个标的, 止盈胜率: ${summary.winRatePct.toFixed(1)}%, 翻倍数: ${summary.doubledTokens}, Lark状态: ${larkOk ? "已送达" : items.length === 0 ? "无新标的" : larkMsg}`,
    );

    return report;
  }

  /**
   * 24-Hour Daily Backtest Execution
   * Reviews all tokens alerted in the last 24 hours.
   */
  public async runDailyBacktest(force: boolean = false): Promise<BacktestReport> {
    this.lastDailyCheckTime = new Date().toISOString();
    const now = Date.now();
    const targetTokens: TrackedAlertToken[] = [];

    for (const token of this.trackedTokens.values()) {
      const alertMs = new Date(token.alertTimestamp).getTime();
      const elapsedHours = (now - alertMs) / 3600000;

      // Review all tokens alerted within the last 24 hours (or up to 36h if force)
      if (elapsedHours <= (force ? 36 : 24)) {
        targetTokens.push(token);
      }
    }

    const items: BacktestReportItem[] = [];

    for (const token of targetTokens) {
      const live = await this.fetchLivePrice(token.tokenAddress, token.chain);
      const curPrice = live.priceUsd ?? token.latestPriceUsd ?? token.alertPriceUsd;

      token.latestPriceUsd = curPrice;
      token.review24hDone = true;
      token.price24hUsd = curPrice;

      const basePrice = token.alertPriceUsd;
      let priceChangePct: number | null = null;

      if (basePrice && curPrice && basePrice > 0) {
        priceChangePct = ((curPrice - basePrice) / basePrice) * 100;
        token.change24hPct = priceChangePct;

        if (token.highestPriceUsd == null || curPrice > token.highestPriceUsd) {
          token.highestPriceUsd = curPrice;
          token.highestGainPct = priceChangePct;
        }
      }

      const peakGain = token.highestGainPct ?? priceChangePct ?? 0;

      let verdict: BacktestReportItem["verdict"] = "MODEST_GAIN";
      let statusText = "稳健观察";

      if (peakGain >= 200) {
        verdict = "PUMP_3X";
        statusText = "🚀 爆拉 3x+ (超级大肉)";
      } else if (peakGain >= 100) {
        verdict = "PUMP_2X";
        statusText = "🌟 翻倍 2x (大幅止盈)";
      } else if (peakGain >= this.config.takeProfitThresholdPct) {
        verdict = "PROFIT_TAKE";
        statusText = "🎯 达成止盈 (波段盈利)";
      } else if (priceChangePct != null && priceChangePct < -30) {
        verdict = "DUMP_LOSS";
        statusText = "🔴 跌破支撑 (注意止损)";
      } else if (peakGain >= 15 && (priceChangePct ?? 0) < 0) {
        verdict = "PULLBACK";
        statusText = "📉 冲高回落";
      }

      items.push({
        tokenAddress: token.tokenAddress,
        symbol: token.symbol,
        chain: token.chain,
        source: token.source,
        score: token.score,
        alertTimestamp: token.alertTimestamp,
        alertPriceUsd: token.alertPriceUsd,
        reviewTimestamp: new Date().toISOString(),
        reviewPriceUsd: curPrice,
        priceChangePct,
        highestPriceUsd: token.highestPriceUsd,
        highestGainPct: token.highestGainPct,
        verdict,
        statusText,
      });
    }

    this.saveToStorage();

    const summary = this.computeSummary("24h", items);
    let larkOk = false;
    let larkMsg = "";

    const report: BacktestReport = {
      id: `backtest-24h-${now}`,
      interval: "24h",
      timestamp: new Date().toISOString(),
      summary,
      items,
      larkOk,
      larkMsg,
    };

    if (this.config.autoLarkPush && items.length > 0) {
      const sendRes = await sendLarkBacktestReport(report, this.config.webhookUrl);
      larkOk = sendRes.ok;
      larkMsg = sendRes.msg || sendRes.error || (larkOk ? "Success" : "Failed");
      report.larkOk = larkOk;
      report.larkMsg = larkMsg;
    }

    this.recentReports.unshift(report);
    if (this.recentReports.length > 30) {
      this.recentReports = this.recentReports.slice(0, 30);
    }
    this.saveToStorage();

    console.log(
      `[Backtest] 📅 24小时大盘复盘完成: 统计 ${items.length} 个标的, 止盈胜率: ${summary.winRatePct.toFixed(1)}%, 翻倍数: ${summary.doubledTokens}, Lark状态: ${larkOk ? "已送达" : items.length === 0 ? "无标的" : larkMsg}`,
    );

    return report;
  }

  private computeSummary(
    interval: "1h" | "24h",
    items: BacktestReportItem[],
  ): BacktestSummary {
    const total = items.length;
    if (total === 0) {
      return {
        interval,
        totalTokens: 0,
        positiveTokens: 0,
        takeProfitTokens: 0,
        doubledTokens: 0,
        lossTokens: 0,
        winRatePct: 0,
        netPositiveRatePct: 0,
        avgChangePct: 0,
        maxGainPct: 0,
      };
    }

    let positiveTokens = 0;
    let takeProfitTokens = 0;
    let doubledTokens = 0;
    let lossTokens = 0;
    let sumChange = 0;
    let validChangeCount = 0;
    let maxGainPct = 0;
    let mvpSymbol = "";
    let mvpGainPct = 0;

    for (const it of items) {
      const roi = it.priceChangePct ?? 0;
      const peak = it.highestGainPct ?? roi;

      if (roi > 0) positiveTokens++;
      if (roi < 0) lossTokens++;

      // Meme token quick win: peak >= take-profit threshold (e.g. 30%)
      if (peak >= this.config.takeProfitThresholdPct) {
        takeProfitTokens++;
      }

      if (peak >= 100) {
        doubledTokens++;
      }

      if (it.priceChangePct != null) {
        sumChange += it.priceChangePct;
        validChangeCount++;
      }

      if (peak > maxGainPct) {
        maxGainPct = peak;
        mvpSymbol = it.symbol;
        mvpGainPct = peak;
      }
    }

    const winRatePct = total > 0 ? (takeProfitTokens / total) * 100 : 0;
    const netPositiveRatePct = total > 0 ? (positiveTokens / total) * 100 : 0;
    const avgChangePct = validChangeCount > 0 ? sumChange / validChangeCount : 0;

    return {
      interval,
      totalTokens: total,
      positiveTokens,
      takeProfitTokens,
      doubledTokens,
      lossTokens,
      winRatePct,
      netPositiveRatePct,
      avgChangePct,
      maxGainPct,
      mvpSymbol: mvpSymbol || undefined,
      mvpGainPct: mvpGainPct > 0 ? mvpGainPct : undefined,
    };
  }
}

export const backtestEngine = BacktestEngine.getInstance();
