import type { HotTokenItem, LpCategory, LpStage } from "./types";
import { USDG, WETH, UNISWAP_V3_ROBINHOOD } from "./constants";

export const CURATED_HOT_TOKENS: Array<{
  symbol: string;
  name: string;
  tokenAddress: string;
  pairAddress: string;
  quoteSymbol: string;
  quoteAddress: string;
  feeTier: number;
  stage: LpStage;
  category: LpCategory;
  isRwa: boolean;
  stockSymbol?: string;
}> = [
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    tokenAddress: WETH,
    pairAddress: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a", // 500 pool
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500, // 0.05%
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    pairAddress: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", // AAPL/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "AAPL",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    tokenAddress: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    pairAddress: "0xc4f0172D6ac8DD294Dd1137D047d5E1893760236", // TSLA/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "TSLA",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    pairAddress: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", // NVDA/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "NVDA",
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    tokenAddress: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    pairAddress: "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167", // SPY/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "SPY",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    tokenAddress: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    pairAddress: "0x38fA8bf13A6b2Ac49bE77BABB22C1837d1e505F9", // MSFT/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "MSFT",
  },
  {
    symbol: "COIN",
    name: "Coinbase Global Inc.",
    tokenAddress: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
    pairAddress: "0x3a6eC0aa6C702323414d449B5F60f4B742A82dED", // COIN/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "COIN",
  },
];

export class HotTokensService {
  private static instance: HotTokensService | null = null;
  private cachedTokens: HotTokenItem[] = [];
  private lastFetchTime: number = 0;
  private isScanning: boolean = false;

  public static getInstance(): HotTokensService {
    if (!HotTokensService.instance) {
      HotTokensService.instance = new HotTokensService();
    }
    return HotTokensService.instance;
  }

  public async getHotTokens(forceRefresh: boolean = false): Promise<HotTokenItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedTokens.length > 0 && now - this.lastFetchTime < 30_000) {
      return this.cachedTokens;
    }

    // Lazy load lpService to prevent circular dependency
    const { lpService } = await import("./lp.server");
    const activePositions = lpService.getState().activePositions;

    const items: HotTokenItem[] = [];

    for (const def of CURATED_HOT_TOKENS) {
      const activePos = activePositions.find(
        (p) => p.tokenAddress.toLowerCase() === def.tokenAddress.toLowerCase(),
      );

      let priceUsd = 0;
      let liquidityUsd = 0;
      let volume24hUsd = 0;
      let volume5mUsd = 0;

      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${def.tokenAddress}`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
            signal: AbortSignal.timeout(6000),
          },
        );

        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as any;
          const pairs = Array.isArray(data.pairs) ? data.pairs : [];
          // Filter pairs on Robinhood chain
          const rhPairs = pairs.filter((p: any) => p.chainId === "robinhood");
          const targetPair =
            rhPairs.find(
              (p: any) =>
                p.pairAddress?.toLowerCase() === def.pairAddress.toLowerCase() ||
                p.quoteToken?.symbol?.toUpperCase() === def.quoteSymbol.toUpperCase(),
            ) ||
            rhPairs[0] ||
            pairs[0];

          if (targetPair) {
            priceUsd = Number(targetPair.priceUsd) || 0;
            liquidityUsd = Number(targetPair.liquidity?.usd) || 0;
            volume24hUsd = Number(targetPair.volume?.h24) || 0;
            volume5mUsd =
              Number(targetPair.volume?.m5) ||
              (Number(targetPair.volume?.h1) ? Number(targetPair.volume.h1) / 12 : 0);
          }
        }
      } catch (err: any) {
        console.warn(`[HotTokensService] 获取标的 $${def.symbol} 盘口行情失败:`, err?.message);
      }

      // Default fallback prices if DexScreener is rate-limited or pair is fresh
      if (priceUsd <= 0) {
        if (def.symbol === "WETH") priceUsd = 2400;
        else if (def.symbol === "AAPL") priceUsd = 331;
        else if (def.symbol === "TSLA") priceUsd = 357;
        else if (def.symbol === "NVDA") priceUsd = 120;
        else if (def.symbol === "SPY") priceUsd = 580;
        else if (def.symbol === "MSFT") priceUsd = 430;
        else if (def.symbol === "COIN") priceUsd = 220;
      }

      // Fee yield estimation (Daily Fee Rate % = (24h Vol * FeeTier) / Pool Active Liquidity)
      const feeRateBps = def.feeTier / 1000000; // e.g. 500 / 1e6 = 0.0005 (0.05%)
      const estimatedFee24h = volume24hUsd * feeRateBps;
      const estDailyFeeRatePct =
        liquidityUsd > 0 ? (estimatedFee24h / Math.max(liquidityUsd * 0.3, 1000)) * 100 : 15;

      let statusDesc = "流动性良好，随时可做市";
      if (activePos) {
        statusDesc = `🟢 已在做市中 (头寸: $${activePos.initialUsdInvested.toFixed(0)} USDG, 收益: $${activePos.netPnlUsd.toFixed(2)})`;
      } else if (volume24hUsd > 1_000_000) {
        statusDesc = `🔥 24h 交易量超百万 ($${(volume24hUsd / 1e6).toFixed(1)}M)，摩擦手续费收益丰厚`;
      } else if (def.isRwa) {
        statusDesc = `📈 美股 RWA 标的，波动稳健，适合 ±10% 窄幅网格`;
      }

      items.push({
        symbol: def.symbol,
        name: def.name,
        tokenAddress: def.tokenAddress,
        pairAddress: def.pairAddress,
        quoteSymbol: def.quoteSymbol,
        quoteAddress: def.quoteAddress,
        feeTier: def.feeTier,
        priceUsd,
        liquidityUsd,
        volume24hUsd,
        volume5mUsd,
        estDailyFeeRatePct: Math.min(500, Math.round(estDailyFeeRatePct * 10) / 10),
        stage: def.stage,
        category: def.category,
        isRwa: def.isRwa,
        stockSymbol: def.stockSymbol,
        hasActivePosition: Boolean(activePos),
        statusDesc,
      });
    }

    this.cachedTokens = items;
    this.lastFetchTime = now;
    return items;
  }

  public async evaluateHotTokensAutoLp(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const { lpService } = await import("./lp.server");
      const state = lpService.getState();
      const config = state.config;

      // Only run auto-LP if autoLpEnabled and enableHotTokensLp are true
      if (!config.autoLpEnabled || config.enableHotTokensLp === false) {
        return;
      }

      const activeCount = state.activePositions.length;
      if (activeCount >= config.maxActivePools) {
        return;
      }

      const hotTokens = await this.getHotTokens();
      // Filter candidates without active positions
      const candidates = hotTokens.filter((t) => !t.hasActivePosition && t.priceUsd > 0);
      if (candidates.length === 0) return;

      // Sort by 24h volume descending
      candidates.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      const topPick = candidates[0];

      if (topPick) {
        console.log(
          `🔥 [HotTokensService] 自动选定高流动性热门标的 $${topPick.symbol} 发起 L3 非对称做市 (24h量: $${topPick.volume24hUsd.toFixed(0)}, 模式: ${config.dryRun ? "模拟" : "实盘"})...`,
        );

        const capital = config.hotTokensCapitalUsd || (topPick.isRwa ? config.rwaCapitalUsd : config.capitalPerPoolUsd);

        await lpService.openLpPosition({
          tokenAddress: topPick.tokenAddress,
          symbol: topPick.symbol,
          name: topPick.name,
          chain: "Robinhood Chain",
          pairAddress: topPick.pairAddress,
          feeTier: topPick.feeTier,
          priceUsd: topPick.priceUsd,
          liquidityUsd: topPick.liquidityUsd,
          volume5m: topPick.volume5mUsd,
          stage: topPick.stage,
          category: topPick.category,
          isRwa: topPick.isRwa,
          stockSymbol: topPick.stockSymbol,
          customCapitalUsd: capital,
          dryRun: config.dryRun,
        });
      }
    } catch (err: any) {
      console.warn("[HotTokensService] 自动高流动性做市评估异常:", err?.message || err);
    } finally {
      this.isScanning = false;
    }
  }
}

export const hotTokensService = HotTokensService.getInstance();
