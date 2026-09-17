import { barkerService } from "./barker.server";
import { lpService } from "./lp.server";
import { sendLarkLpOpportunityAlert } from "./lark";
import type { V4MarketSummary, V4PoolItem, LpStage } from "./types";

export class V4PoolRadarService {
  private static instance: V4PoolRadarService | null = null;

  private isRunning: boolean = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;

  // Track alerted pools to enforce cooldown
  private alertedPools: Map<string, number> = new Map();
  // Track known pool IDs to detect new pool launches
  private knownPoolIds: Set<string> = new Set();
  private hasInitializedKnownPools: boolean = false;

  public constructor() {
    this.start();
  }

  public static getInstance(): V4PoolRadarService {
    if (!V4PoolRadarService.instance) {
      V4PoolRadarService.instance = new V4PoolRadarService();
    }
    return V4PoolRadarService.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.scanTimer) clearInterval(this.scanTimer);
    // Run scan every 60 seconds
    this.scanTimer = setInterval(() => {
      this.scanForOpportunities().catch((err) => {
        console.warn("[V4PoolRadar] 机会扫描轮询异常:", err?.message || err);
      });
    }, 60_000);
    this.scanTimer.unref();

    // Initial delayed scan after 5 seconds
    const timeout = setTimeout(() => {
      this.scanForOpportunities().catch(() => {});
    }, 5_000);
    timeout.unref();

    console.log("⚡ [V4PoolRadar] Robinhood V4 做市机会雷达已启动");
  }

  public stop(): void {
    this.isRunning = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /**
   * Scan V4 market snapshot for new pool launches and high-yield opportunities.
   */
  public async scanForOpportunities(): Promise<{
    opportunitiesCount: number;
    newPoolsCount: number;
    summary: V4MarketSummary;
  }> {
    if (this.isScanning) {
      const summary = await barkerService.getMarketSummary();
      return { opportunitiesCount: 0, newPoolsCount: 0, summary };
    }
    this.isScanning = true;

    try {
      const summary = await barkerService.getMarketSummary(true);
      const lpConfig = lpService.getState().config;
      const now = Date.now();

      let opportunitiesCount = 0;
      let newPoolsCount = 0;

      // Clean up old cooldowns (> 2 hours)
      for (const [id, time] of this.alertedPools.entries()) {
        if (now - time > 2 * 3600 * 1000) {
          this.alertedPools.delete(id);
        }
      }

      // Check each pool in topYieldPools
      for (const pool of summary.topYieldPools) {
        // Detect newly launched pool
        if (!this.knownPoolIds.has(pool.poolId)) {
          this.knownPoolIds.add(pool.poolId);
          if (this.hasInitializedKnownPools) {
            newPoolsCount++;
            console.log(`✨ [V4PoolRadar] 发现新上线 V4 池: ${pool.pairName} (${pool.feeTierPct}% 费率)`);
          }
        }

        // Check if opportunity matches user criteria
        const minFeeRate = Math.min(lpConfig.minOpportunityFeeRatePct || 15, 20);
        const minVolume2h = Math.min(lpConfig.minOpportunityVolume2hUsd || 10000, 3000);
        const maxActiveLiq = Math.max(lpConfig.maxOpportunityActiveLiqUsd || 80000, 100000);

        const isYieldHigh = pool.dailyFeeRatePct >= minFeeRate;
        const isVolumeSufficient = pool.volume2hUsd >= minVolume2h;
        const isDepthFavorable = pool.activeBandLiquidityUsd <= maxActiveLiq;

        if (isYieldHigh && isVolumeSufficient && isDepthFavorable) {
          opportunitiesCount++;

          const lastAlert = this.alertedPools.get(pool.poolId) || 0;
          const cooldownMs = (lpConfig.opportunityAlertCooldownMin || 60) * 60_000;

          if (now - lastAlert >= cooldownMs) {
            this.alertedPools.set(pool.poolId, now);
            console.log(
              `🔥 [V4PoolRadar] 捕获高收益做市机会: ${pool.pairName} | 日费率: +${pool.dailyFeeRatePct.toFixed(1)}%/天 | 2H成交: $${pool.volume2hUsd.toLocaleString()}`,
            );

            if (lpConfig.larkNotification && (lpConfig.larkLpOpportunityEnabled !== false)) {
              sendLarkLpOpportunityAlert({
                pool,
                webhookUrl: lpConfig.webhookUrl,
              }).catch((err) => console.warn("[V4PoolRadar] Lark 机会推送失败:", err));
            }

            // If autoLp is enabled and it is an RWA stock pool or high yield / health pool
            if (lpConfig.autoLpEnabled && (pool.healthScore >= 70 || pool.dailyFeeRatePct >= minFeeRate || pool.isRwa)) {
              const activeCount = lpService.getState().activePositions.length;
              if (activeCount < lpConfig.maxActivePools) {
                const stage: LpStage = pool.isRwa
                  ? "RWA_STABLE"
                  : (pool.dailyFeeRatePct >= 20 || pool.volume2hUsd >= 20000 ? "PUMP" : "SIDEWAYS");

                lpService.openLpPosition({
                  tokenAddress: pool.token0Address,
                  symbol: pool.token0Symbol,
                  name: pool.pairName,
                  chain: "Robinhood Chain",
                  pairAddress: pool.pairAddress,
                  feeTier: pool.feeTierBps,
                  priceUsd: pool.currentPriceUsd,
                  liquidityUsd: pool.totalLiquidityUsd,
                  volume5m: pool.volume2hUsd / 24, // 2H volume mapped to 5m equivalent
                  stage,
                  isRwa: pool.isRwa,
                  stockSymbol: pool.stockSymbol,
                  category: pool.category,
                  activeBandLiquidityUsd: pool.activeBandLiquidityUsd,
                }).catch((err) => console.warn("[V4PoolRadar] 自动建仓失败:", err));
              }
            }
          }
        }
      }

      this.hasInitializedKnownPools = true;
      return { opportunitiesCount, newPoolsCount, summary };
    } finally {
      this.isScanning = false;
    }
  }
}

export const v4PoolRadarService = V4PoolRadarService.getInstance();
