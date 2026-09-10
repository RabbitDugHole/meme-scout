import { extractRwaStock } from "./stocks";
import type { V4MarketSummary, V4PoolItem, LpCategory } from "./types";

interface BarkerSnapshotResponse {
  asOf?: string;
  chain?: {
    uid?: string;
    id?: number;
    name?: string;
  };
  poolCount?: number;
  activePoolCount?: number;
  market24h?: {
    volUsd?: number;
    feeUsd?: number;
    swaps?: number;
  };
  radar?: Array<{
    poolId: string;
    pairLabel: string;
    baseLogo?: string;
    quoteLogo?: string;
    feePpm: number;
    currency0: string;
    currency1: string;
    tickSpacing: number;
    hooks?: string;
    quoteSide: number;
    quoteKind?: string;
    baseKind?: string;
    quoteAddress: string;
    baseAddress: string;
    quoteSymbol: string;
    baseSymbol: string;
    quoteDecimals?: number;
    baseDecimals?: number;
    vol1hUsd?: number;
    vol24hUsd?: number;
    fee24hUsd?: number;
    tvlBandUsd?: number;
    feeApr24h?: number;
    efficiency24h?: number;
    activeLiquidity?: string;
    windows?: {
      "30m"?: { feeUsd: number; volUsd: number; swaps: number; feeApr: number; efficiency: number };
      "2h"?: { feeUsd: number; volUsd: number; swaps: number; feeApr: number; efficiency: number };
      "6h"?: { feeUsd: number; volUsd: number; swaps: number; feeApr: number; efficiency: number };
      "24h"?: { feeUsd: number; volUsd: number; swaps: number; feeApr: number; efficiency: number };
    };
    market?: {
      priceUsd?: number;
      fdvUsd?: number;
      marketCapUsd?: number;
      liquidityUsd?: number;
      changeH1?: number;
      changeH24?: number;
      pairCreatedAt?: string;
    };
  }>;
}

let cachedSummary: V4MarketSummary | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds cache

export class BarkerService {
  private static instance: BarkerService | null = null;

  public static getInstance(): BarkerService {
    if (!BarkerService.instance) {
      BarkerService.instance = new BarkerService();
    }
    return BarkerService.instance;
  }

  /**
   * Fetch and index Robinhood Chain Uniswap V4 pools from Barker Money API.
   */
  public async getMarketSummary(forceRefresh: boolean = false): Promise<V4MarketSummary> {
    const now = Date.now();
    if (!forceRefresh && cachedSummary && now - lastFetchTime < CACHE_TTL_MS) {
      return cachedSummary;
    }

    try {
      const res = await fetch("https://app.barker.money/api/lp-watch/snapshot?chain=robinhood-chain", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Referer: "https://app.barker.money/raid/robinhood",
          Origin: "https://app.barker.money",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new Error(`Barker API returned status ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as BarkerSnapshotResponse;
      const rawRadar = Array.isArray(data.radar) ? data.radar : [];

      const parsedPools: V4PoolItem[] = [];
      let total24hVol = 0;
      let total24hFee = 0;

      for (const item of rawRadar) {
        const pairLabel = item.pairLabel || `${item.baseSymbol || "UNKNOWN"}/${item.quoteSymbol || "USDG"}`;
        const feeTierPct = Number((item.feePpm / 10000).toFixed(2));
        const feeTierBps = item.feePpm || 10000;

        const isDynamicHook = !!item.hooks && item.hooks !== "0x0000000000000000000000000000000000000000";

        // RWA Recognition
        const rwaCheck = extractRwaStock(pairLabel);
        let category: LpCategory = "MEME";
        if (rwaCheck.isRwa) {
          category = "RWA";
        } else if (
          pairLabel.includes("ETH") ||
          pairLabel.includes("WETH") ||
          pairLabel.includes("USDG") ||
          pairLabel.includes("USDC")
        ) {
          category = item.baseKind === "bluechip" ? "BLUECHIP" : "MEME";
        }

        const activeBandLiq = Math.max(1, item.tvlBandUsd || 1000);
        const totalLiq = Math.max(activeBandLiq, item.market?.liquidityUsd || activeBandLiq);

        const vol2h = item.windows?.["2h"]?.volUsd ?? (item.vol1hUsd ? item.vol1hUsd * 2 : 0);
        const fee2h = item.windows?.["2h"]?.feeUsd ?? (item.vol1hUsd ? item.vol1hUsd * 2 * (feeTierPct / 100) : 0);
        const vol24h = item.vol24hUsd ?? (vol2h * 12);
        const fee24h = item.fee24hUsd ?? (fee2h * 12);

        total24hVol += vol24h;
        total24hFee += fee24h;

        // Daily fee rate calculation: (2H Fee * 12) / Active Band Liquidity
        let dailyFeeRatePct = 0;
        if (item.windows?.["2h"]?.feeApr) {
          dailyFeeRatePct = item.windows["2h"].feeApr / 3.65;
        } else if (activeBandLiq > 0) {
          dailyFeeRatePct = ((fee2h * 12) / activeBandLiq) * 100;
        }

        // Cap extreme statistical anomalies
        dailyFeeRatePct = Math.min(2500, Math.max(0, dailyFeeRatePct));
        const annualizedAprPct = dailyFeeRatePct * 365;

        // Concentration capital efficiency multiplier
        const capitalEfficiency = item.windows?.["2h"]?.efficiency || item.efficiency24h || 7.5;

        // New pool detection (<24h)
        const pairCreatedAt = item.market?.pairCreatedAt;
        let isNewPool = false;
        if (pairCreatedAt) {
          const createdMs = new Date(pairCreatedAt).getTime();
          isNewPool = now - createdMs < 24 * 3600 * 1000;
        }

        // Calculate health score (0-100)
        let healthScore = 50;
        if (vol2h > 50000) healthScore += 15;
        if (activeBandLiq > 5000 && activeBandLiq < 100000) healthScore += 15;
        if (dailyFeeRatePct > 50) healthScore += 15;
        if (rwaCheck.isRwa) healthScore += 10; // RWA gets quality boost
        if (isDynamicHook) healthScore += 5;
        healthScore = Math.min(100, Math.max(10, healthScore));

        parsedPools.push({
          poolId: item.poolId,
          pairAddress: item.poolId,
          token0Symbol: item.baseSymbol || "TOKEN0",
          token0Address: item.baseAddress || item.currency1,
          token1Symbol: item.quoteSymbol || "USDG",
          token1Address: item.quoteAddress || item.currency0,
          pairName: pairLabel,
          category,
          isRwa: rwaCheck.isRwa,
          stockSymbol: rwaCheck.stockSymbol,
          feeTierPct,
          feeTierBps,
          isDynamicHook,
          hookDescription: isDynamicHook ? `Hook: ${item.hooks?.slice(0, 10)}...` : undefined,
          currentPriceUsd: item.market?.priceUsd || 0,
          priceChange1hPct: item.market?.changeH1 || 0,
          activeBandLiquidityUsd: Math.round(activeBandLiq),
          totalLiquidityUsd: Math.round(totalLiq),
          volume2hUsd: Math.round(vol2h),
          volume24hUsd: Math.round(vol24h),
          fee2hUsd: Math.round(fee2h),
          fee24hUsd: Math.round(fee24h),
          dailyFeeRatePct: Number(dailyFeeRatePct.toFixed(1)),
          annualizedAprPct: Math.round(annualizedAprPct),
          capitalEfficiency: Number(capitalEfficiency.toFixed(1)),
          healthScore,
          createdAt: pairCreatedAt,
          isNewPool,
          barkerUrl: "https://app.barker.money/raid/robinhood",
          explorerUrl: `https://explorer.mainnet.chain.robinhood.com/address/${item.baseAddress || item.poolId}`,
        });
      }

      // Sort pools by dailyFeeRatePct descending
      parsedPools.sort((a, b) => b.dailyFeeRatePct - a.dailyFeeRatePct);

      const topYieldPools = parsedPools.slice(0, 50);
      const rwaPools = parsedPools.filter((p) => p.isRwa);
      const memePools = parsedPools.filter((p) => p.category === "MEME");
      const newPools = parsedPools.filter((p) => p.isNewPool);

      const avgDailyFee =
        parsedPools.length > 0
          ? parsedPools.reduce((acc, p) => acc + p.dailyFeeRatePct, 0) / parsedPools.length
          : 0;

      cachedSummary = {
        indexedPoolsCount: parsedPools.length,
        total24hVolumeUsd: Math.round(total24hVol),
        total24hFeeUsd: Math.round(total24hFee),
        avgDailyFeeRatePct: Number(avgDailyFee.toFixed(1)),
        topYieldPools,
        rwaPools,
        memePools,
        newPools,
        updatedAt: new Date().toISOString(),
      };

      lastFetchTime = now;
      console.log(
        `📡 [BarkerService] 成功同步 ${parsedPools.length} 个 Robinhood Uniswap V4 池 (RWA 美股池: ${rwaPools.length} 个, 新池: ${newPools.length} 个)`,
      );
      return cachedSummary;
    } catch (err: any) {
      console.warn("[BarkerService] 获取 Barker V4 市场快照失败:", err?.message || err);
      if (cachedSummary) return cachedSummary;

      // Fallback initial summary if network unreachable
      return {
        indexedPoolsCount: 0,
        total24hVolumeUsd: 0,
        total24hFeeUsd: 0,
        avgDailyFeeRatePct: 0,
        topYieldPools: [],
        rwaPools: [],
        memePools: [],
        newPools: [],
        updatedAt: new Date().toISOString(),
      };
    }
  }
}

export const barkerService = BarkerService.getInstance();
