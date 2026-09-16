import type { HotTokenItem, LpCategory, LpStage } from "./types";
import { USDG, WETH } from "./constants";
import { barkerService } from "./barker.server";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const CURATED_HOT_TOKENS: Array<{
  symbol: string;
  name: string;
  chain: string; // "robinhood" | "bsc" | "arbitrum"
  protocol: string; // "uniswap_v3" | "pancake_v3" | "uniswap_v4_barker"
  protocolLabel: string;
  tokenAddress: string;
  pairAddress: string;
  quoteSymbol: string;
  quoteAddress: string;
  feeTier: number;
  stage: LpStage;
  category: LpCategory;
  isRwa: boolean;
  stockSymbol?: string;
  barkerUrl?: string;
  dexUrl?: string;
}> = [
  // ----------------------------------------------------
  // 1. Robinhood Chain - Bluechip & RWA (Uniswap V3)
  // ----------------------------------------------------
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: WETH,
    pairAddress: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a", // 500 pool
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500, // 0.05%
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    pairAddress: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", // AAPL/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "AAPL",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    pairAddress: "0xc4f0172D6ac8DD294Dd1137D047d5E1893760236", // TSLA/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "TSLA",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    pairAddress: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", // NVDA/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "NVDA",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    pairAddress: "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167", // SPY/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "SPY",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    pairAddress: "0x38fA8bf13A6b2Ac49bE77BABB22C1837d1e505F9", // MSFT/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "MSFT",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  {
    symbol: "COIN",
    name: "Coinbase Global Inc.",
    chain: "robinhood",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
    pairAddress: "0x3a6eC0aa6C702323414d449B5F60f4B742A82dED", // COIN/USDG 500
    quoteSymbol: "USDG",
    quoteAddress: USDG,
    feeTier: 500,
    stage: "RWA_STABLE",
    category: "RWA",
    isRwa: true,
    stockSymbol: "COIN",
    dexUrl: "https://explorer.mainnet.chain.robinhood.com",
  },
  // ----------------------------------------------------
  // 2. Robinhood Chain - Hot Meme (Uniswap V4 / Barker)
  // ----------------------------------------------------
  {
    symbol: "OKEY",
    name: "Okey Meme (Barker V4)",
    chain: "robinhood",
    protocol: "uniswap_v4_barker",
    protocolLabel: "Uniswap V4 (Barker)",
    tokenAddress: "0x15f7267eb4945db190d79b008d519b7808fa75e5",
    pairAddress: "0xddda7faa1d95015e5a2656911fc612140a7b453e9a4f4d2f0eb76ff6222b0c1e",
    quoteSymbol: "WETH",
    quoteAddress: WETH,
    feeTier: 10000,
    stage: "PUMP",
    category: "MEME",
    isRwa: false,
    barkerUrl: "https://app.barker.money/raid/robinhood",
    dexUrl: "https://app.barker.money/raid/robinhood",
  },
  // ----------------------------------------------------
  // 3. BSC - Binance Smart Chain (PancakeSwap V3)
  // ----------------------------------------------------
  {
    symbol: "WBNB",
    name: "Wrapped BNB",
    chain: "bsc",
    protocol: "pancake_v3",
    protocolLabel: "PancakeSwap V3",
    tokenAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    pairAddress: "0x36696169C63e42cd08ce11f5deeBbCeBae652050", // WBNB/USDT 500
    quoteSymbol: "USDT",
    quoteAddress: "0x55d398326f99059fF775485246999027B3197955",
    feeTier: 500, // 0.05%
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://pancakeswap.finance/info/v3/pairs/0x36696169c63e42cd08ce11f5deebbcebae652050",
  },
  {
    symbol: "CAKE",
    name: "PancakeSwap Token",
    chain: "bsc",
    protocol: "pancake_v3",
    protocolLabel: "PancakeSwap V3",
    tokenAddress: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    pairAddress: "0xAfB2Da14056725E3BA3a30dD846B6BBbd7886c56",
    quoteSymbol: "USDT",
    quoteAddress: "0x55d398326f99059fF775485246999027B3197955",
    feeTier: 2500, // 0.25%
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://pancakeswap.finance",
  },
  {
    symbol: "BTCB",
    name: "Binance Bitcoin",
    chain: "bsc",
    protocol: "pancake_v3",
    protocolLabel: "PancakeSwap V3",
    tokenAddress: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    pairAddress: "0x46cf1cf8c73079b1479ab4553856816e71821099",
    quoteSymbol: "USDT",
    quoteAddress: "0x55d398326f99059fF775485246999027B3197955",
    feeTier: 500,
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://pancakeswap.finance",
  },
  // ----------------------------------------------------
  // 4. Arbitrum One ("arc" / "arb" - Uniswap V3)
  // ----------------------------------------------------
  {
    symbol: "WETH_ARB",
    name: "Arbitrum WETH",
    chain: "arbitrum",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    pairAddress: "0xC6962004f452bE9203591991D15f6b388e09E8D0", // WETH/USDC 500
    quoteSymbol: "USDC",
    quoteAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    feeTier: 500,
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://app.uniswap.org/explore/pools/arbitrum/0xC6962004f452bE9203591991D15f6b388e09E8D0",
  },
  {
    symbol: "ARB",
    name: "Arbitrum Token",
    chain: "arbitrum",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    pairAddress: "0xC6F780497A95e246EB9449f5e4770916DCd6396A",
    quoteSymbol: "USDC",
    quoteAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    feeTier: 500,
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://app.uniswap.org/explore/pools/arbitrum/0xC6F780497A95e246EB9449f5e4770916DCd6396A",
  },
  {
    symbol: "GMX",
    name: "GMX",
    chain: "arbitrum",
    protocol: "uniswap_v3",
    protocolLabel: "Uniswap V3",
    tokenAddress: "0xfc5A1A6EB0ba367c0E00d024e2B04938FB7798bb",
    pairAddress: "0x80A9ae39310abf666A87C743d6ebBD0E8C42158E",
    quoteSymbol: "WETH",
    quoteAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    feeTier: 3000,
    stage: "SIDEWAYS",
    category: "BLUECHIP",
    isRwa: false,
    dexUrl: "https://app.uniswap.org",
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

  public async getHotTokens(forceRefresh: boolean = false, chainFilter?: string): Promise<HotTokenItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedTokens.length > 0 && now - this.lastFetchTime < 30_000) {
      if (chainFilter && chainFilter !== "all") {
        return this.cachedTokens.filter((t) => t.chain.toLowerCase() === chainFilter.toLowerCase());
      }
      return this.cachedTokens;
    }

    // Lazy load lpService to prevent circular dependency
    const { lpService } = await import("./lp.server");
    const activePositions = lpService.getState().activePositions;

    let barkerPools: any[] = [];
    try {
      const summary = await barkerService.getMarketSummary();
      barkerPools = [...(summary.topYieldPools || []), ...(summary.memePools || [])];
    } catch {}

    const items: HotTokenItem[] = [];

    for (const def of CURATED_HOT_TOKENS) {
      const activePos = activePositions.find(
        (p) => p.tokenAddress.toLowerCase() === def.tokenAddress.toLowerCase(),
      );

      let priceUsd = 0;
      let liquidityUsd = 0;
      let volume24hUsd = 0;
      let volume5mUsd = 0;

      // 1. Check Barker Uniswap V4 data first for Robinhood V4 Meme tokens
      if (def.protocol === "uniswap_v4_barker") {
        const bp = barkerPools.find(
          (p) =>
            p.token0Address?.toLowerCase() === def.tokenAddress.toLowerCase() ||
            p.token1Address?.toLowerCase() === def.tokenAddress.toLowerCase() ||
            p.token0Symbol?.toUpperCase() === def.symbol.toUpperCase() ||
            p.token1Symbol?.toUpperCase() === def.symbol.toUpperCase(),
        );
        if (bp) {
          priceUsd = bp.currentPriceUsd || 0;
          liquidityUsd = bp.totalLiquidityUsd || 0;
          volume24hUsd = bp.volume24hUsd || 0;
          volume5mUsd = bp.volume2hUsd ? bp.volume2hUsd / 24 : 0;
        }
      }

      // 2. Query DexScreener if not yet populated
      if (priceUsd <= 0) {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${def.tokenAddress}`,
            {
              headers: {
                "User-Agent": BROWSER_UA,
              },
              signal: AbortSignal.timeout(6000),
            },
          );

          if (res.ok) {
            const data = (await res.json().catch(() => ({}))) as any;
            const pairs = Array.isArray(data.pairs) ? data.pairs : [];
            const chainPairs = pairs.filter(
              (p: any) => p.chainId?.toLowerCase() === def.chain.toLowerCase(),
            );

            const targetPair =
              chainPairs.find(
                (p: any) =>
                  p.pairAddress?.toLowerCase() === def.pairAddress.toLowerCase() ||
                  p.quoteToken?.symbol?.toUpperCase() === def.quoteSymbol.toUpperCase(),
              ) ||
              chainPairs[0] ||
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
      }

      // Default fallback prices if APIs rate-limited
      if (priceUsd <= 0) {
        if (def.symbol === "WETH" || def.symbol === "WETH_ARB") priceUsd = 2400;
        else if (def.symbol === "AAPL") priceUsd = 331;
        else if (def.symbol === "TSLA") priceUsd = 357;
        else if (def.symbol === "NVDA") priceUsd = 120;
        else if (def.symbol === "SPY") priceUsd = 580;
        else if (def.symbol === "MSFT") priceUsd = 430;
        else if (def.symbol === "COIN") priceUsd = 220;
        else if (def.symbol === "OKEY") priceUsd = 0.00011;
        else if (def.symbol === "WBNB") priceUsd = 705;
        else if (def.symbol === "CAKE") priceUsd = 2.16;
        else if (def.symbol === "BTCB") priceUsd = 62000;
        else if (def.symbol === "ARB") priceUsd = 0.155;
        else if (def.symbol === "GMX") priceUsd = 24.5;
      }

      // Fee yield estimation (Daily Fee Rate % = (24h Vol * FeeTier) / Pool Active Liquidity)
      const feeRateBps = def.feeTier / 1000000; // e.g. 500 / 1e6 = 0.0005 (0.05%)
      const estimatedFee24h = volume24hUsd * feeRateBps;
      const estDailyFeeRatePct =
        liquidityUsd > 0 ? (estimatedFee24h / Math.max(liquidityUsd * 0.3, 1000)) * 100 : 15;

      let statusDesc = "流动性良好，随时可做市";
      if (activePos) {
        statusDesc = `🟢 已在做市中 (头寸: $${activePos.initialUsdInvested.toFixed(0)}, 收益: $${activePos.netPnlUsd.toFixed(2)})`;
      } else if (def.protocol === "uniswap_v4_barker") {
        statusDesc = `🔥 Robinhood Meme 热门代币 (Uniswap V4 Barker 协议，支持模拟测算与跳转做市)`;
      } else if (def.chain === "bsc") {
        statusDesc = `🥞 BSC PancakeSwap V3 热门做市标的 (24h交易量: $${(volume24hUsd / 1e6).toFixed(1)}M)`;
      } else if (def.chain === "arbitrum") {
        statusDesc = `⚡ Arbitrum Uniswap V3 高频做市标的 (24h交易量: $${(volume24hUsd / 1e6).toFixed(1)}M)`;
      } else if (def.isRwa) {
        statusDesc = `📈 美股 RWA 标的，波动稳健，适合 ±10% 窄幅网格`;
      } else if (volume24hUsd > 1_000_000) {
        statusDesc = `🔥 24h 交易量超百万 ($${(volume24hUsd / 1e6).toFixed(1)}M)，摩擦手续费收益丰厚`;
      }

      items.push({
        symbol: def.symbol,
        name: def.name,
        chain: def.chain,
        protocol: def.protocol,
        protocolLabel: def.protocolLabel,
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
        barkerUrl: def.barkerUrl,
        dexUrl: def.dexUrl,
        hasActivePosition: Boolean(activePos),
        statusDesc,
      });
    }

    this.cachedTokens = items;
    this.lastFetchTime = now;

    if (chainFilter && chainFilter !== "all") {
      return items.filter((t) => t.chain.toLowerCase() === chainFilter.toLowerCase());
    }
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
          `🔥 [HotTokensService] 自动选定高流动性热门标的 $${topPick.symbol} (${topPick.chain}, ${topPick.protocolLabel}) 发起 L3 非对称做市 (24h量: $${topPick.volume24hUsd.toFixed(0)}, 模式: ${config.dryRun ? "模拟" : "实盘"})...`,
        );

        const capital =
          config.hotTokensCapitalUsd ||
          (topPick.isRwa ? config.rwaCapitalUsd : config.capitalPerPoolUsd);

        await lpService.openLpPosition({
          tokenAddress: topPick.tokenAddress,
          symbol: topPick.symbol,
          name: topPick.name,
          chain: topPick.chain,
          protocol: topPick.protocol,
          barkerUrl: topPick.barkerUrl,
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
