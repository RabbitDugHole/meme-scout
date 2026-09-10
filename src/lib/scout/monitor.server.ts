import { runScan } from "./scan.server";
import { DEFAULT_LARK_WEBHOOK_URL, sendLarkAlarm, sendLarkTestMessage } from "./lark";
import { backtestEngine } from "./backtest.server";
import { tradeService } from "./trade.server";
import { lpService } from "./lp.server";
import type { AlarmRecord, Candidate, MonitorConfig, MonitorState } from "./types";
import type { MemeIndicators } from "./indicators";

class PotentialMemeMonitor {
  private static instance: PotentialMemeMonitor | null = null;

  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastScanTime: string | null = null;
  private nextScanTime: string | null = null;
  private isScanInProgress: boolean = false;

  private config: MonitorConfig = {
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
    minScoreThreshold: 80, // Default to S-Tier (Score >= 80)
    minLiquidityUsd: 30000,
    cooldownMinutes: 120, // 2 hours cooldown per token
    intervalSeconds: 60, // 60s check interval
    autoAlarmEnabled: true,
  };

  // Map of lowercase token address to alert timestamp and previous score
  private alertedTokens: Map<
    string,
    { symbol: string; score: number; alertedAt: string }
  > = new Map();

  // In-memory history of recent alarms sent
  private alarmHistory: AlarmRecord[] = [];

  private constructor() {
    // Start automated background monitoring loop by default
    this.start();
  }

  public static getInstance(): PotentialMemeMonitor {
    if (!PotentialMemeMonitor.instance) {
      PotentialMemeMonitor.instance = new PotentialMemeMonitor();
    }
    return PotentialMemeMonitor.instance;
  }

  public getState(): MonitorState {
    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      lastScanTime: this.lastScanTime,
      nextScanTime: this.nextScanTime,
      alertedCount: this.alertedTokens.size,
      history: [...this.alarmHistory],
    };
  }

  public updateConfig(patch: Partial<MonitorConfig>): MonitorState {
    this.config = { ...this.config, ...patch };
    if (patch.intervalSeconds && this.isRunning) {
      this.stop();
      this.start();
    }
    return this.getState();
  }

  public start(): void {
    if (this.isRunning && this.timer) return;
    this.isRunning = true;
    this.scheduleNextRun();
    // Run an initial check after 5 seconds to avoid startup blocking
    setTimeout(() => {
      this.runCycle().catch((err) => {
        console.warn("[Monitor] Initial cycle error:", err?.message || err);
      });
    }, 5000);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.nextScanTime = null;
  }

  private scheduleNextRun(): void {
    if (!this.isRunning) return;
    if (this.timer) clearTimeout(this.timer);

    const ms = this.config.intervalSeconds * 1000;
    this.nextScanTime = new Date(Date.now() + ms).toISOString();

    this.timer = setTimeout(async () => {
      try {
        await this.runCycle();
      } catch (err: any) {
        console.warn("[Monitor] Polling cycle error:", err?.message || err);
      } finally {
        this.scheduleNextRun();
      }
    }, ms);
  }

  /**
   * Run one scan and trigger Lark alarms for potential meme tokens.
   */
  public async runCycle(forceCheck = false): Promise<{
    scannedCount: number;
    potentialCount: number;
    newAlarmsSent: number;
    alarms: AlarmRecord[];
  }> {
    if (this.isScanInProgress) {
      return { scannedCount: 0, potentialCount: 0, newAlarmsSent: 0, alarms: [] };
    }

    this.isScanInProgress = true;
    this.lastScanTime = new Date().toISOString();
    console.log(`[Monitor] 🔍 开始执行 Robinhood 链上巡检扫描 (强制模式: ${forceCheck})...`);

    try {
      const scanResult = await runScan(true);
      const candidates = scanResult.candidates;
      const newAlarms: AlarmRecord[] = [];

      for (const candidate of candidates) {
        const indicators = candidate.indicators;
        if (!indicators) continue;

        // Check potential token criteria: strictly require score >= minScoreThreshold (default 80)
        const isPotential =
          indicators.totalScore >= this.config.minScoreThreshold &&
          indicators.isLpLocked &&
          (candidate.liquidityUsd ?? 0) >= this.config.minLiquidityUsd;

        if (!isPotential && !forceCheck) continue;

        const addrKey = candidate.address.toLowerCase();
        const prevAlert = this.alertedTokens.get(addrKey);
        const now = Date.now();

        // Deduplication & cooldown check:
        // Skip if alerted within cooldown period, UNLESS score has surged significantly (+15 pts)
        if (prevAlert && !forceCheck) {
          const elapsedMin = (now - new Date(prevAlert.alertedAt).getTime()) / 60000;
          const scoreDelta = indicators.totalScore - prevAlert.score;
          if (elapsedMin < this.config.cooldownMinutes && scoreDelta < 15) {
            continue;
          }
        }

        // Trigger alarm via Lark webhook
        let larkOk = false;
        let larkMsg = "";

        if (this.config.autoAlarmEnabled || forceCheck) {
          const sendRes = await sendLarkAlarm(
            candidate,
            indicators,
            this.config.webhookUrl,
          );
          larkOk = sendRes.ok;
          larkMsg = sendRes.msg || sendRes.error || (sendRes.ok ? "Success" : "Failed");
          if (larkOk) {
            console.log(`[Monitor] ✅ 飞书报警成功送达: $${candidate.symbol} (${candidate.name}) - 得分: ${indicators.totalScore}`);
          } else {
            console.warn(`[Monitor] ⚠️ 飞书报警推送失败: ${larkMsg}`);
          }
        } else {
          larkOk = true;
          larkMsg = "Simulated (Auto-alarm disabled in config)";
        }

        const record: AlarmRecord = {
          id: `${addrKey}-${now}`,
          tokenAddress: candidate.address,
          symbol: candidate.symbol,
          name: candidate.name,
          score: indicators.totalScore,
          tier: indicators.potentialTier,
          timestamp: new Date().toISOString(),
          larkOk,
          larkMsg,
          priceUsd: candidate.priceUsd,
          mcapUsd: candidate.mcapUsd,
          liquidityUsd: candidate.liquidityUsd,
          signals: indicators.signals,
          risks: indicators.risks,
        };

        this.alertedTokens.set(addrKey, {
          symbol: candidate.symbol,
          score: indicators.totalScore,
          alertedAt: record.timestamp,
        });

        this.alarmHistory.unshift(record);
        if (this.alarmHistory.length > 50) {
          this.alarmHistory = this.alarmHistory.slice(0, 50);
        }

        // Record for 1h / 24h win-rate backtesting
        backtestEngine.recordAlert({
          tokenAddress: candidate.address,
          symbol: candidate.symbol,
          name: candidate.name,
          chain: "Robinhood Chain",
          source: "robinhood-scanner",
          score: indicators.totalScore,
          tier: indicators.potentialTier,
          priceUsd: candidate.priceUsd ?? null,
          mcapUsd: candidate.mcapUsd ?? null,
          liquidityUsd: candidate.liquidityUsd ?? null,
        });

        // Trigger Automated Trading Module
        tradeService.handleTokenAlert({
          tokenAddress: candidate.address,
          symbol: candidate.symbol,
          name: candidate.name,
          chain: "Robinhood Chain",
          source: "robinhood-scanner",
          score: indicators.totalScore,
          priceUsd: candidate.priceUsd ?? null,
          timestamp: record.timestamp,
        }).catch((err) => {
          console.warn("[Monitor] 自动买入执行异常:", err?.message || err);
        });

        // Trigger Automated V3 LP Market Maker Engine
        lpService.handleTokenAlert({
          tokenAddress: candidate.address,
          symbol: candidate.symbol,
          name: candidate.name,
          chain: "Robinhood Chain",
          score: indicators.totalScore,
          priceUsd: candidate.priceUsd ?? null,
          liquidityUsd: candidate.liquidityUsd ?? null,
          pairAddress: candidate.pairToken || undefined,
        }).catch((err) => {
          console.warn("[Monitor] 自动 LP 做市建仓异常:", err?.message || err);
        });

        newAlarms.push(record);
      }

      const potCount = candidates.filter((c) => (c.indicators?.totalScore ?? 0) >= this.config.minScoreThreshold).length;
      console.log(`[Monitor] ✨ 巡检完成: 扫描 ${candidates.length} 个代币, 发现 ${potCount} 个高潜力, 新推送 ${newAlarms.length} 条告警`);

      return {
        scannedCount: candidates.length,
        potentialCount: potCount,
        newAlarmsSent: newAlarms.length,
        alarms: newAlarms,
      };
    } catch (err: any) {
      console.warn("[Monitor] 巡检异常:", err?.message || err);
      return {
        scannedCount: 0,
        potentialCount: 0,
        newAlarmsSent: 0,
        alarms: [],
      };
    } finally {
      this.isScanInProgress = false;
    }
  }

  /**
   * Manually trigger sending a specific candidate token to Lark webhook
   */
  public async sendManualAlarm(
    candidate: Candidate,
    indicators?: MemeIndicators,
  ): Promise<AlarmRecord> {
    const ind = indicators || candidate.indicators;
    if (!ind) {
      throw new Error("No indicators available for this token");
    }

    const sendRes = await sendLarkAlarm(
      candidate,
      ind,
      this.config.webhookUrl,
    );

    const record: AlarmRecord = {
      id: `${candidate.address.toLowerCase()}-${Date.now()}`,
      tokenAddress: candidate.address,
      symbol: candidate.symbol,
      name: candidate.name,
      score: ind.totalScore,
      tier: ind.potentialTier,
      timestamp: new Date().toISOString(),
      larkOk: sendRes.ok,
      larkMsg: sendRes.msg || sendRes.error || (sendRes.ok ? "Success" : "Failed"),
      priceUsd: candidate.priceUsd,
      mcapUsd: candidate.mcapUsd,
      liquidityUsd: candidate.liquidityUsd,
      signals: ind.signals,
      risks: ind.risks,
    };

    this.alertedTokens.set(candidate.address.toLowerCase(), {
      symbol: candidate.symbol,
      score: ind.totalScore,
      alertedAt: record.timestamp,
    });

    this.alarmHistory.unshift(record);
    if (this.alarmHistory.length > 50) {
      this.alarmHistory = this.alarmHistory.slice(0, 50);
    }

    backtestEngine.recordAlert({
      tokenAddress: candidate.address,
      symbol: candidate.symbol,
      name: candidate.name,
      chain: "Robinhood Chain",
      source: "robinhood-scanner",
      score: ind.totalScore,
      tier: ind.potentialTier,
      priceUsd: candidate.priceUsd ?? null,
      mcapUsd: candidate.priceUsd ?? null,
      liquidityUsd: candidate.liquidityUsd ?? null,
    });

    return record;
  }
}

export const monitorService = PotentialMemeMonitor.getInstance();
