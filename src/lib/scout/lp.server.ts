import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  formatEther,
  defineChain,
  parseAbi,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  LpConfig,
  LpPosition,
  LpRangeSegment,
  LpStage,
  LpState,
  LpTxRecord,
  LpWalletStatus,
  V4PoolItem,
} from "./types";
import {
  sendLarkLpOpenAlert,
  sendLarkLpCollectAlert,
  sendLarkComprehensiveLpReport,
  sendLarkLpRebalanceAlert,
  sendLarkLpOpportunityAlert,
  DEFAULT_LARK_WEBHOOK_URL,
} from "./lark";
import { extractRwaStock } from "./stocks";
import {
  USDG,
  UNISWAP_V3_ROBINHOOD,
  PANCAKE_V3_BSC,
  UNISWAP_V3_ARBITRUM,
} from "./constants";
import { bsc, arbitrum } from "viem/chains";

// Robinhood Chain definition
const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://explorer.mainnet.chain.robinhood.com",
    },
  },
});

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const rpcTransport = http("https://rpc.mainnet.chain.robinhood.com", {
  fetchOptions: {
    headers: {
      "User-Agent": BROWSER_UA,
    },
  },
});

export const bscTransport = http("https://bsc-dataseed1.binance.org", {
  fetchOptions: {
    headers: {
      "User-Agent": BROWSER_UA,
    },
  },
});

export const arbTransport = http("https://arb1.arbitrum.io/rpc", {
  fetchOptions: {
    headers: {
      "User-Agent": BROWSER_UA,
    },
  },
});

const DATA_DIR = path.resolve(process.cwd(), "data");
const LP_CONFIG_FILE = path.resolve(DATA_DIR, "lp-config.json");
const LP_POSITIONS_FILE = path.resolve(DATA_DIR, "lp-positions.json");
const LP_WALLET_FILE = path.resolve(DATA_DIR, "lp-wallet.json");

// Uniswap V3 / Pons NonfungiblePositionManager ABI interface snippet
const POSITION_MANAGER_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
]);

export class LpService {
  private static instance: LpService | null = null;

  private isRunning: boolean = false;
  private monitorTimer: NodeJS.Timeout | null = null;
  private isCheckingPositions: boolean = false;
  private cachedHotTokens: import("./types").HotTokenItem[] = [];

  private config: LpConfig = {
    dryRun: true,
    autoLpEnabled: true,
    capitalPerPoolUsd: 50,
    maxActivePools: 5,
    maxPoolSharePct: 20,
    minVolumeToLiquidityRatio: 1.5,
    preferredFeeTier: 10000, // 1%
    maxTopHoldersPct: 35,
    minScoreThreshold: 75,

    pumpCoreSharePct: 40,
    pumpCoreUpPct: 30, // +30%
    pumpChaseSharePct: 35,
    pumpChaseUpPct: 100, // +100%
    pumpBufferSharePct: 25,
    pumpBufferDownPct: -50, // -50%

    sidewaysCoreSharePct: 70,
    sidewaysCoreWidthPct: 15, // ±15%
    sidewaysDefendSharePct: 30,

    // RWA Tokenized Equities Settings
    rwaBandWidthPct: 10, // ±10% for stocks
    rwaCapitalUsd: 100, // 100 USDG for RWA

    // Dynamic Rebalancing & IL Stop Loss
    enableAutoRebalance: true,
    rebalanceDriftThresholdPct: 12, // 12% drift
    maxRebalancesPerPosition: 3,
    netPnlStopLossPct: -8, // -8% net pnl stop loss

    // Risk & Profit Management
    withdrawPrincipalFeeRatio: 0.35,
    volumeDropExitThresholdPct: 50,
    stopLossPriceDropPct: -25,
    maxHoldMinutes: 720,

    // High Yield LP Opportunity Scanner Settings
    minOpportunityFeeRatePct: 80, // 80% daily fee rate
    minOpportunityVolume2hUsd: 10000,
    maxOpportunityActiveLiqUsd: 80000,
    opportunityAlertCooldownMin: 60,
    // Single-Sided Upper Range Order (单边上方限价卖出收租) Settings
    enableUpperPiercedExit: true,
    pumpMode: "SINGLE_SIDED_RANGE_ORDER",
    singleSidedUpperCorePct: 20,
    singleSidedUpperMaxPct: 45,
    fastStopLossPct: -8,

    // High-Liquidity Hot Tokens Settings
    enableHotTokensLp: true,
    hotTokensCapitalUsd: 20,

    larkNotification: true,
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
    walletAddress: undefined,
    hasRhKey: false,
  };

  private cachedWalletStatus: LpWalletStatus = {
    hasWallet: false,
    ethBalance: "0.0000",
    usdgBalance: "0.00",
    isReadyForLive: false,
  };

  private rawPrivateKey: string = "";
  private activePositions: Map<string, LpPosition> = new Map();
  private closedPositions: LpPosition[] = [];

  private rhClient = createPublicClient({
    chain: robinhoodChain,
    transport: rpcTransport,
  });

  private bscClient = createPublicClient({
    chain: bsc,
    transport: bscTransport,
  });

  private arbClient = createPublicClient({
    chain: arbitrum,
    transport: arbTransport,
  });

  public constructor() {
    this.loadFromStorage();
    this.initWalletConfig();
    this.start();
  }

  public static getInstance(): LpService {
    if (!LpService.instance) {
      LpService.instance = new LpService();
    }
    return LpService.instance;
  }

  private initWalletConfig(): void {
    let pk = "";
    if (fs.existsSync(LP_WALLET_FILE)) {
      try {
        const raw = fs.readFileSync(LP_WALLET_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.privateKey) {
          pk = parsed.privateKey;
        }
      } catch (err) {
        console.warn("[LpService] 读取钱包文件失败:", err);
      }
    }

    if (!pk) {
      pk = process.env.RH_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY || "";
    }

    if (pk) {
      try {
        const formattedKey = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`);
        const account = privateKeyToAccount(formattedKey);
        this.rawPrivateKey = formattedKey;
        this.config.walletAddress = account.address;
        this.config.hasRhKey = true;
        this.cachedWalletStatus = {
          hasWallet: true,
          walletAddress: account.address,
          ethBalance: this.cachedWalletStatus?.ethBalance || "0.0000",
          usdgBalance: this.cachedWalletStatus?.usdgBalance || "0.00",
          isReadyForLive: false,
          lastCheckedAt: new Date().toISOString(),
        };
        console.log(`[LpService] 🔑 做市钱包初始化成功: ${account.address}`);
        // Fetch balances asynchronously
        this.refreshWalletBalances().catch(() => {});
      } catch (err) {
        console.warn("[LpService] 钱包私钥解析失败:", err);
      }
    } else {
      this.rawPrivateKey = "";
      this.config.hasRhKey = false;
      this.cachedWalletStatus = {
        hasWallet: false,
        ethBalance: "0.0000",
        usdgBalance: "0.00",
        isReadyForLive: false,
        lastCheckedAt: new Date().toISOString(),
      };
    }
  }

  public async refreshWalletBalances(): Promise<LpWalletStatus> {
    if (!this.config.walletAddress || !this.config.hasRhKey || !this.rawPrivateKey) {
      this.initWalletConfig();
    }
    if (!this.config.walletAddress || !this.config.hasRhKey) {
      this.cachedWalletStatus = {
        hasWallet: false,
        walletAddress: undefined,
        ethBalance: "0.0000",
        usdgBalance: "0.00",
        bnbBalance: "0.0000",
        bscUsdtBalance: "0.00",
        arbEthBalance: "0.0000",
        arbUsdcBalance: "0.00",
        isReadyForLive: false,
        lastCheckedAt: new Date().toISOString(),
      };
      return this.cachedWalletStatus;
    }

    const addr = this.config.walletAddress as `0x${string}`;

    let ethFormatted = this.cachedWalletStatus?.ethBalance || "0.0000";
    let usdgFormatted = this.cachedWalletStatus?.usdgBalance || "0.00";
    let bnbFormatted = this.cachedWalletStatus?.bnbBalance || "0.0000";
    let bscUsdtFormatted = this.cachedWalletStatus?.bscUsdtBalance || "0.00";
    let arbEthFormatted = this.cachedWalletStatus?.arbEthBalance || "0.0000";
    let arbUsdcFormatted = this.cachedWalletStatus?.arbUsdcBalance || "0.00";

    // 1. Robinhood Balances
    const rhPromise = (async () => {
      try {
        const ethBalRaw = await this.rhClient.getBalance({ address: addr });
        ethFormatted = (Number(ethBalRaw) / 1e18).toFixed(4);

        const usdgBalRaw = await this.rhClient.readContract({
          address: USDG as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        });
        usdgFormatted = (Number(usdgBalRaw) / 1e6).toFixed(2);
      } catch (err: any) {
        console.warn("[LpService] 查询 Robinhood 余额失败:", err?.message || err);
      }
    })();

    // 2. BSC Balances (BNB & USDT)
    const bscPromise = (async () => {
      try {
        const bnbBalRaw = await this.bscClient.getBalance({ address: addr });
        bnbFormatted = (Number(bnbBalRaw) / 1e18).toFixed(4);

        const bscUsdtRaw = await this.bscClient.readContract({
          address: PANCAKE_V3_BSC.USDT as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        });
        // USDT on BSC has 18 decimals
        bscUsdtFormatted = (Number(bscUsdtRaw) / 1e18).toFixed(2);
      } catch (err: any) {
        console.warn("[LpService] 查询 BSC 余额失败:", err?.message || err);
      }
    })();

    // 3. Arbitrum Balances (ETH & USDC)
    const arbPromise = (async () => {
      try {
        const arbEthBalRaw = await this.arbClient.getBalance({ address: addr });
        arbEthFormatted = (Number(arbEthBalRaw) / 1e18).toFixed(4);

        const arbUsdcRaw = await this.arbClient.readContract({
          address: UNISWAP_V3_ARBITRUM.USDC as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        });
        // USDC on Arbitrum has 6 decimals
        arbUsdcFormatted = (Number(arbUsdcRaw) / 1e6).toFixed(2);
      } catch (err: any) {
        console.warn("[LpService] 查询 Arbitrum 余额失败:", err?.message || err);
      }
    })();

    await Promise.allSettled([rhPromise, bscPromise, arbPromise]);

    const ethNum = Number(ethFormatted);
    const usdgNum = Number(usdgFormatted);
    const bnbNum = Number(bnbFormatted);
    const bscUsdtNum = Number(bscUsdtFormatted);
    const arbEthNum = Number(arbEthFormatted);
    const arbUsdcNum = Number(arbUsdcFormatted);

    const isReady =
      (ethNum >= 0.0005 && usdgNum >= 10) ||
      (bnbNum >= 0.001 && bscUsdtNum >= 10) ||
      (arbEthNum >= 0.0005 && arbUsdcNum >= 10);

    let warning: string | undefined = undefined;
    if (ethNum < 0.0005 && bnbNum < 0.001 && arbEthNum < 0.0005) {
      warning = "Gas 余额偏低，请在相应链上充值 Gas 费以支持实盘做市";
    }

    this.cachedWalletStatus = {
      hasWallet: true,
      walletAddress: addr,
      ethBalance: ethFormatted,
      usdgBalance: usdgFormatted,
      bnbBalance: bnbFormatted,
      bscUsdtBalance: bscUsdtFormatted,
      arbEthBalance: arbEthFormatted,
      arbUsdcBalance: arbUsdcFormatted,
      isReadyForLive: isReady,
      warning,
      lastCheckedAt: new Date().toISOString(),
    };

    return this.cachedWalletStatus;
  }

  public async importWallet(rawPrivateKey: string): Promise<LpWalletStatus> {
    const cleaned = rawPrivateKey.trim();
    const formattedKey = cleaned.startsWith("0x") ? (cleaned as `0x${string}`) : (`0x${cleaned}` as `0x${string}`);

    if (formattedKey.length !== 66) {
      throw new Error("私钥格式不正确，应为 64 位十六进制字符 (可带或不带 0x 前缀)");
    }

    let account;
    try {
      account = privateKeyToAccount(formattedKey);
    } catch (err: any) {
      throw new Error(`私钥解析失败: ${err?.message || err}`);
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const walletRecord = {
      address: account.address,
      privateKey: formattedKey,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(LP_WALLET_FILE, JSON.stringify(walletRecord, null, 2), {
      mode: 0o600,
    });

    this.rawPrivateKey = formattedKey;
    this.config.walletAddress = account.address;
    this.config.hasRhKey = true;
    this.saveToStorage();

    console.log(`[LpService] 🔑 用户已成功导入 LP 做市钱包: ${account.address}`);
    return this.refreshWalletBalances();
  }

  public async disconnectWallet(): Promise<LpState> {
    try {
      if (fs.existsSync(LP_WALLET_FILE)) {
        fs.unlinkSync(LP_WALLET_FILE);
      }
    } catch (err) {
      console.warn("[LpService] 删除钱包文件失败:", err);
    }

    this.rawPrivateKey = "";
    this.config.walletAddress = undefined;
    this.config.hasRhKey = false;
    // For safety, force dryRun to true when wallet is unbound
    this.config.dryRun = true;
    this.saveToStorage();

    this.cachedWalletStatus = {
      hasWallet: false,
      ethBalance: "0.0000",
      usdgBalance: "0.00",
      isReadyForLive: false,
      lastCheckedAt: new Date().toISOString(),
    };

    console.log("[LpService] 🔒 做市钱包已解绑并安全重置为模拟模式");
    return this.getState();
  }

  public async getWalletStatus(forceRefresh: boolean = false): Promise<LpWalletStatus> {
    if (forceRefresh || !this.cachedWalletStatus.lastCheckedAt) {
      return this.refreshWalletBalances();
    }
    return this.cachedWalletStatus;
  }

  private loadFromStorage(): void {
    try {
      if (fs.existsSync(LP_CONFIG_FILE)) {
        const raw = fs.readFileSync(LP_CONFIG_FILE, "utf8");
        const saved = JSON.parse(raw);
        // Do not let saved config overwrite active wallet keys or addresses
        delete saved.walletAddress;
        delete saved.hasRhKey;
        this.config = { ...this.config, ...saved };
      }

      if (fs.existsSync(LP_POSITIONS_FILE)) {
        const raw = fs.readFileSync(LP_POSITIONS_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.active)) {
          for (const pos of data.active) {
            // Sanitize: Real on-chain positions must have a 0x txHash
            const hasRealOnChainTx = pos.txHistory?.some(
              (t: any) => t.id && t.id.startsWith("0x") && t.status === "CONFIRMED",
            );
            if (pos.dryRun === false && !hasRealOnChainTx) {
              pos.dryRun = true;
            }
            if (pos.dryRun === undefined) {
              pos.dryRun = true;
            }
            if (!pos.upperPiercedTargetPriceUsd && pos.ranges?.length > 0) {
              pos.upperPiercedTargetPriceUsd = pos.ranges.reduce(
                (max: number, r: any) => Math.max(max, r.maxPriceUsd),
                pos.entryPriceUsd,
              );
            }
            this.activePositions.set(pos.id, pos);
          }
        }
        if (Array.isArray(data.closed)) {
          this.closedPositions = data.closed.map((pos: LpPosition) => {
            const hasRealOnChainTx = pos.txHistory?.some(
              (t: any) => t.id && t.id.startsWith("0x") && t.status === "CONFIRMED",
            );
            return {
              ...pos,
              dryRun: pos.dryRun === false && !hasRealOnChainTx ? true : (pos.dryRun ?? true),
            };
          }).slice(0, 100);
        }
        console.log(
          `[LpService] 📂 已载入 ${this.activePositions.size} 个活跃做市池，${this.closedPositions.length} 条已结项记录`,
        );
      }
    } catch (err: any) {
      console.warn("[LpService] 载入存储数据异常:", err?.message || err);
    }
  }

  private saveToStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      fs.writeFileSync(LP_CONFIG_FILE, JSON.stringify(this.config, null, 2), "utf8");

      const payload = {
        active: Array.from(this.activePositions.values()),
        closed: this.closedPositions.slice(0, 100),
      };
      fs.writeFileSync(LP_POSITIONS_FILE, JSON.stringify(payload, null, 2), "utf8");
    } catch (err: any) {
      console.warn("[LpService] 持久化数据保存异常:", err?.message || err);
    }
  }

  private computeMetrics(
    activeSubset: LpPosition[],
    closedSubset: LpPosition[],
  ): import("./types").LpMetricsSummary {
    let totalFeeEarnedUsd = 0;
    let totalRealizedPnlUsd = 0;
    let totalInvestedUsd = 0;
    let winCount = 0;
    let lossCount = 0;

    for (const pos of closedSubset) {
      totalFeeEarnedUsd += pos.feeEarnedUsd || 0;
      totalRealizedPnlUsd += pos.netPnlUsd || 0;
      totalInvestedUsd += pos.initialUsdInvested || 0;
      if ((pos.netPnlUsd || 0) >= 0) {
        winCount++;
      } else {
        lossCount++;
      }
    }

    for (const pos of activeSubset) {
      totalFeeEarnedUsd += pos.feeEarnedUsd || 0;
      totalInvestedUsd += pos.initialUsdInvested || 0;
    }

    const totalClosed = winCount + lossCount;
    const winRatePct = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;

    return {
      totalFeeEarnedUsd,
      totalRealizedPnlUsd,
      totalInvestedUsd,
      activeCount: activeSubset.length,
      closedCount: closedSubset.length,
      winCount,
      lossCount,
      winRatePct,
    };
  }

  public getState(): LpState {
    const active = Array.from(this.activePositions.values()).sort(
      (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime(),
    );

    const paperActive = active.filter((p) => p.dryRun);
    const paperClosed = this.closedPositions.filter((p) => p.dryRun);
    const liveActive = active.filter((p) => !p.dryRun);
    const liveClosed = this.closedPositions.filter((p) => !p.dryRun);

    const paperStats = this.computeMetrics(paperActive, paperClosed);
    const liveStats = this.computeMetrics(liveActive, liveClosed);
    const currentModeStats = this.config.dryRun ? paperStats : liveStats;

    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      walletAddress: this.config.walletAddress,
      walletStatus: this.cachedWalletStatus,
      activePositions: active,
      closedPositions: this.closedPositions,
      paperStats,
      liveStats,
      totalFeeEarnedUsd: currentModeStats.totalFeeEarnedUsd,
      totalRealizedPnlUsd: currentModeStats.totalRealizedPnlUsd,
      winCount: currentModeStats.winCount,
      lossCount: currentModeStats.lossCount,
      winRatePct: currentModeStats.winRatePct,
      hotTokens: this.cachedHotTokens,
    };
  }

  public updateConfig(patch: Partial<LpConfig>): LpState {
    this.config = { ...this.config, ...patch };
    this.saveToStorage();
    return this.getState();
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.monitorTimer) clearInterval(this.monitorTimer);
    let cycleCount = 0;
    // Inspect every 30 seconds
    this.monitorTimer = setInterval(() => {
      cycleCount++;
      this.inspectPositions().catch((err) => {
        console.warn("[LpService] 做市仓位巡检异常:", err?.message || err);
      });

      // Every 2 minutes (4 cycles): scan hot tokens and check for auto-LP
      if (cycleCount % 4 === 0) {
        import("./hot-tokens.server")
          .then(async ({ hotTokensService }) => {
            const tokens = await hotTokensService.getHotTokens();
            this.cachedHotTokens = tokens;
            await hotTokensService.evaluateHotTokensAutoLp();
          })
          .catch((err) => console.warn("[LpService] 热门币种巡检异常:", err?.message || err));
      }
    }, 30_000);
    this.monitorTimer.unref();

    // Initial hot tokens refresh
    import("./hot-tokens.server")
      .then(async ({ hotTokensService }) => {
        this.cachedHotTokens = await hotTokensService.getHotTokens();
      })
      .catch(() => {});

    console.log(
      `🌊 [LpService] V3 非对称 LP 做市引擎已启动 (模式: ${this.config.dryRun ? "🛡️ 模拟做市 (Dry-Run)" : "🚀 真实链上 (Live)"}, 自动做市: ${this.config.autoLpEnabled ? "开启" : "暂停"}, 热门币做市: ${this.config.enableHotTokensLp !== false ? "开启" : "关闭"})`,
    );
  }

  public stop(): void {
    this.isRunning = false;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  // ==========================================
  // Math & V3 Tick Calculation
  // ==========================================

  public static priceToTick(price: number): number {
    if (price <= 0) return 0;
    return Math.floor(Math.log(price) / Math.log(1.0001));
  }

  public static alignTick(tick: number, spacing: number = 200): number {
    const val = Math.round(tick / spacing) * spacing;
    return Object.is(val, -0) ? 0 : val;
  }

  public static tickToPrice(tick: number): number {
    return Math.pow(1.0001, tick);
  }

  /**
   * Concentrated Liquidity Capital Efficiency Multiplier:
   * kappa = 1 / (1 - sqrt(minPrice / maxPrice))
   */
  public static calculateConcentrationMultiplier(minPrice: number, maxPrice: number): number {
    if (minPrice <= 0 || maxPrice <= minPrice) return 1;
    const ratio = Math.sqrt(minPrice / maxPrice);
    if (ratio >= 0.999) return 50;
    const multiplier = 1 / (1 - ratio);
    return Math.min(50, Math.max(1, Number(multiplier.toFixed(2))));
  }

  /**
   * Build asymmetric range segments based on token life cycle stage.
   */
  public calculateRanges(
    entryPrice: number,
    stage: LpStage,
    capitalTotal: number,
    tickSpacing: number = 200,
  ): LpRangeSegment[] {
    const segments: LpRangeSegment[] = [];

    if (stage === "RWA_STABLE") {
      // RWA Tokenized Equities (Stocks) - Concentrated ±10% Band
      const halfWidth = (this.config.rwaBandWidthPct || 10) / 100;
      const coreMin = entryPrice * (1 - halfWidth);
      const coreMax = entryPrice * (1 + halfWidth);
      const coreLowerTick = LpService.alignTick(LpService.priceToTick(coreMin), tickSpacing);
      const coreUpperTick = LpService.alignTick(LpService.priceToTick(coreMax), tickSpacing);

      segments.push({
        segmentName: `RWA 稳健核心带 (80%) [±${this.config.rwaBandWidthPct}%]`,
        minPriceUsd: LpService.tickToPrice(coreLowerTick),
        maxPriceUsd: LpService.tickToPrice(coreUpperTick),
        lowerTick: coreLowerTick,
        upperTick: coreUpperTick,
        capitalSharePct: 80,
        capitalAllocatedUsd: capitalTotal * 0.8,
        inRange: true,
      });

      // Lower Buffer (10%)
      const lowerMin = entryPrice * (1 - halfWidth * 1.6);
      const lowerLowerTick = LpService.alignTick(LpService.priceToTick(lowerMin), tickSpacing);
      segments.push({
        segmentName: "RWA 防守下轨 (10%)",
        minPriceUsd: LpService.tickToPrice(lowerLowerTick),
        maxPriceUsd: LpService.tickToPrice(coreLowerTick),
        lowerTick: lowerLowerTick,
        upperTick: coreLowerTick,
        capitalSharePct: 10,
        capitalAllocatedUsd: capitalTotal * 0.1,
        inRange: false,
      });

      // Upper Buffer (10%)
      const upperMax = entryPrice * (1 + halfWidth * 1.6);
      const upperUpperTick = LpService.alignTick(LpService.priceToTick(upperMax), tickSpacing);
      segments.push({
        segmentName: "RWA 获利上轨 (10%)",
        minPriceUsd: LpService.tickToPrice(coreUpperTick),
        maxPriceUsd: LpService.tickToPrice(upperUpperTick),
        lowerTick: coreUpperTick,
        upperTick: upperUpperTick,
        capitalSharePct: 10,
        capitalAllocatedUsd: capitalTotal * 0.1,
        inRange: false,
      });
      return segments;
    }

    if (stage === "PUMP") {
      const mode = this.config.pumpMode || "SINGLE_SIDED_RANGE_ORDER";

      if (mode === "SINGLE_SIDED_RANGE_ORDER") {
        // 单边上方集中流动性 Range Order: 资金完全部署于现价上方，价格上冲时以高倍率吃满手续费，穿上沿后100%兑换为USDG并撤出
        const coreUpPct = (this.config.singleSidedUpperCorePct || 20) / 100;
        const maxUpPct = (this.config.singleSidedUpperMaxPct || 45) / 100;

        // 1. 单边核心收租带 (60%) [现价 -> +20%]
        const coreUpPrice = entryPrice * (1 + coreUpPct);
        const coreLowerTick = LpService.alignTick(LpService.priceToTick(entryPrice), tickSpacing);
        const coreUpperTick = LpService.alignTick(LpService.priceToTick(coreUpPrice), tickSpacing);
        segments.push({
          segmentName: `单边上方核心收租带 (60%) [+0%~+${this.config.singleSidedUpperCorePct || 20}%]`,
          minPriceUsd: LpService.tickToPrice(coreLowerTick),
          maxPriceUsd: LpService.tickToPrice(coreUpperTick),
          lowerTick: coreLowerTick,
          upperTick: coreUpperTick,
          capitalSharePct: 60,
          capitalAllocatedUsd: capitalTotal * 0.6,
          inRange: true,
        });

        // 2. 穿上沿限价兑现带 (40%) [+20% -> +45%]
        const chaseUpPrice = entryPrice * (1 + maxUpPct);
        const chaseLowerTick = coreUpperTick;
        const chaseUpperTick = LpService.alignTick(LpService.priceToTick(chaseUpPrice), tickSpacing);
        segments.push({
          segmentName: `穿上沿限价兑现带 (40%) [+${this.config.singleSidedUpperCorePct || 20}%~+${this.config.singleSidedUpperMaxPct || 45}%]`,
          minPriceUsd: LpService.tickToPrice(chaseLowerTick),
          maxPriceUsd: LpService.tickToPrice(chaseUpperTick),
          lowerTick: chaseLowerTick,
          upperTick: chaseUpperTick,
          capitalSharePct: 40,
          capitalAllocatedUsd: capitalTotal * 0.4,
          inRange: false,
        });

        return segments;
      }

      // Legacy Asymmetric Upper Zone Mode
      // 1. Core Fee Zone (40%)
      const coreUpPrice = entryPrice * (1 + this.config.pumpCoreUpPct / 100);
      const coreLowerTick = LpService.alignTick(LpService.priceToTick(entryPrice), tickSpacing);
      const coreUpperTick = LpService.alignTick(LpService.priceToTick(coreUpPrice), tickSpacing);
      segments.push({
        segmentName: `Core Fee Zone (${this.config.pumpCoreSharePct}%)`,
        minPriceUsd: LpService.tickToPrice(coreLowerTick),
        maxPriceUsd: LpService.tickToPrice(coreUpperTick),
        lowerTick: coreLowerTick,
        upperTick: coreUpperTick,
        capitalSharePct: this.config.pumpCoreSharePct,
        capitalAllocatedUsd: capitalTotal * (this.config.pumpCoreSharePct / 100),
        inRange: true,
      });

      // 2. Chase Upper Zone (35%)
      const chaseUpPrice = entryPrice * (1 + this.config.pumpChaseUpPct / 100);
      const chaseLowerTick = coreUpperTick;
      const chaseUpperTick = LpService.alignTick(LpService.priceToTick(chaseUpPrice), tickSpacing);
      segments.push({
        segmentName: `Chase Upper (${this.config.pumpChaseSharePct}%)`,
        minPriceUsd: LpService.tickToPrice(chaseLowerTick),
        maxPriceUsd: LpService.tickToPrice(chaseUpperTick),
        lowerTick: chaseLowerTick,
        upperTick: chaseUpperTick,
        capitalSharePct: this.config.pumpChaseSharePct,
        capitalAllocatedUsd: capitalTotal * (this.config.pumpChaseSharePct / 100),
        inRange: false,
      });

      // 3. Buffer Lower Zone (25%)
      const bufferDownPrice = entryPrice * (1 + this.config.pumpBufferDownPct / 100);
      const bufferLowerTick = LpService.alignTick(LpService.priceToTick(bufferDownPrice), tickSpacing);
      const bufferUpperTick = coreLowerTick;
      segments.push({
        segmentName: `Buffer Lower (${this.config.pumpBufferSharePct}%)`,
        minPriceUsd: LpService.tickToPrice(bufferLowerTick),
        maxPriceUsd: LpService.tickToPrice(bufferUpperTick),
        lowerTick: bufferLowerTick,
        upperTick: bufferUpperTick,
        capitalSharePct: this.config.pumpBufferSharePct,
        capitalAllocatedUsd: capitalTotal * (this.config.pumpBufferSharePct / 100),
        inRange: false,
      });
    } else {
      // SIDEWAYS Stage
      const halfWidth = this.config.sidewaysCoreWidthPct / 100;
      const coreMin = entryPrice * (1 - halfWidth);
      const coreMax = entryPrice * (1 + halfWidth);
      const coreLowerTick = LpService.alignTick(LpService.priceToTick(coreMin), tickSpacing);
      const coreUpperTick = LpService.alignTick(LpService.priceToTick(coreMax), tickSpacing);

      segments.push({
        segmentName: `Core Box (${this.config.sidewaysCoreSharePct}%)`,
        minPriceUsd: LpService.tickToPrice(coreLowerTick),
        maxPriceUsd: LpService.tickToPrice(coreUpperTick),
        lowerTick: coreLowerTick,
        upperTick: coreUpperTick,
        capitalSharePct: this.config.sidewaysCoreSharePct,
        capitalAllocatedUsd: capitalTotal * (this.config.sidewaysCoreSharePct / 100),
        inRange: true,
      });

      // Lower Defend (15%)
      const lowerMin = entryPrice * (1 - halfWidth * 1.5);
      const lowerLowerTick = LpService.alignTick(LpService.priceToTick(lowerMin), tickSpacing);
      segments.push({
        segmentName: "Lower Defend (15%)",
        minPriceUsd: LpService.tickToPrice(lowerLowerTick),
        maxPriceUsd: LpService.tickToPrice(coreLowerTick),
        lowerTick: lowerLowerTick,
        upperTick: coreLowerTick,
        capitalSharePct: 15,
        capitalAllocatedUsd: capitalTotal * 0.15,
        inRange: false,
      });

      // Upper Defend (15%)
      const upperMax = entryPrice * (1 + halfWidth * 1.5);
      const upperUpperTick = LpService.alignTick(LpService.priceToTick(upperMax), tickSpacing);
      segments.push({
        segmentName: "Upper Defend (15%)",
        minPriceUsd: LpService.tickToPrice(coreUpperTick),
        maxPriceUsd: LpService.tickToPrice(upperUpperTick),
        lowerTick: coreUpperTick,
        upperTick: upperUpperTick,
        capitalSharePct: 15,
        capitalAllocatedUsd: capitalTotal * 0.15,
        inRange: false,
      });
    }

    return segments;
  }

  // ==========================================
  // Inflow Signal & Open LP Handler
  // ==========================================

  public async handleTokenAlert(params: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain: string;
    score: number;
    priceUsd: number | null;
    liquidityUsd?: number | null;
    volume5m?: number | null;
    pairAddress?: string;
  }): Promise<LpPosition | null> {
    if (!this.config.autoLpEnabled) return null;

    // Check pool limit
    if (this.activePositions.size >= this.config.maxActivePools) {
      console.log("[LpService] 活跃做市池已达上限，跳过信号");
      return null;
    }

    // Check existing active position
    const existing = Array.from(this.activePositions.values()).find(
      (p) => p.tokenAddress.toLowerCase() === params.tokenAddress.toLowerCase(),
    );
    if (existing) {
      return null;
    }

    // Check if RWA
    const rwaMatch = extractRwaStock(params.symbol);

    // Score filter (RWA relaxes score filter due to inherent fundamental credibility)
    if (!rwaMatch.isRwa && params.score < this.config.minScoreThreshold) {
      return null;
    }

    // Fetch pair info & check Volume/Liquidity ratio
    const poolInfo = await this.fetchPoolDexData(params.tokenAddress);
    const liquidity = poolInfo?.liquidityUsd || params.liquidityUsd || 0;
    const volume5m = poolInfo?.volume5m || params.volume5m || 0;
    const currentPrice = poolInfo?.priceUsd || params.priceUsd || 0;

    if (currentPrice <= 0 || liquidity <= 0) {
      return null;
    }

    const volToLiqRatio = volume5m / liquidity;
    const dailyTurnoverRatio = (volume5m * 288) / liquidity;
    // High-frequency friction criteria:
    // 1) RWA stocks are always eligible due to high capital efficiency
    // 2) Normalized 24h turnover >= minVolumeToLiquidityRatio (default: >= 1.5x pool per day)
    // 3) OR 5-min pool turnover >= 2% (0.02)
    // 4) OR 5-min volume >= $1,500
    const meetsFriction =
      rwaMatch.isRwa ||
      dailyTurnoverRatio >= this.config.minVolumeToLiquidityRatio ||
      volToLiqRatio >= 0.02 ||
      volume5m >= 1500;

    if (!meetsFriction) {
      console.log(
        `[LpService] 标的 $${params.symbol} 换手率未达到做市摩擦门槛 (5m量: $${volume5m.toFixed(0)}, 池深: $${liquidity.toFixed(0)}, 日化换手: ${dailyTurnoverRatio.toFixed(2)}x < ${this.config.minVolumeToLiquidityRatio}x)`,
      );
      return null;
    }

    // Determine stage
    const priceChange5m = poolInfo?.priceChangeM5 || 0;
    let stage: LpStage = "SIDEWAYS";
    if (rwaMatch.isRwa) {
      stage = "RWA_STABLE";
    } else if (priceChange5m > 8 || dailyTurnoverRatio >= 2.0 || volToLiqRatio >= 0.05) {
      stage = "PUMP";
    }

    return this.openLpPosition({
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name || poolInfo?.name || rwaMatch.stockName,
      chain: params.chain,
      pairAddress: poolInfo?.pairAddress || params.pairAddress,
      priceUsd: currentPrice,
      liquidityUsd: liquidity,
      volume5m,
      stage,
      isRwa: rwaMatch.isRwa,
      stockSymbol: rwaMatch.stockSymbol,
      category: rwaMatch.isRwa ? "RWA" : "MEME",
      customCapitalUsd: rwaMatch.isRwa ? this.config.rwaCapitalUsd : undefined,
    });
  }

  public async openLpPosition(params: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain?: string;
    protocol?: string;
    barkerUrl?: string;
    pairAddress?: string;
    feeTier?: number;
    priceUsd: number;
    liquidityUsd: number;
    volume5m: number;
    stage: LpStage;
    category?: import("./types").LpCategory;
    isRwa?: boolean;
    stockSymbol?: string;
    activeBandLiquidityUsd?: number;
    customCapitalUsd?: number;
    dryRun?: boolean;
    mockLive?: boolean;
  }): Promise<LpPosition> {
    const rwaMatch = extractRwaStock(params.symbol);
    const isRwa = params.isRwa ?? rwaMatch.isRwa;
    const stockSymbol = params.stockSymbol || rwaMatch.stockSymbol;
    const category = params.category || (isRwa ? "RWA" : "MEME");
    const stage = params.stage || (isRwa ? "RWA_STABLE" : "SIDEWAYS");
    const capitalInvested =
      params.customCapitalUsd ||
      (isRwa ? this.config.rwaCapitalUsd : this.config.capitalPerPoolUsd);

    // Normalize target chain
    let targetChain = (params.chain || "robinhood").toLowerCase();
    if (targetChain.includes("bsc") || targetChain.includes("binance")) {
      targetChain = "bsc";
    } else if (targetChain.includes("arb") || targetChain.includes("arc")) {
      targetChain = "arbitrum";
    } else {
      targetChain = "robinhood";
    }

    let targetProtocol = params.protocol;
    if (!targetProtocol) {
      if (targetChain === "bsc") targetProtocol = "pancake_v3";
      else if (targetChain === "arbitrum") targetProtocol = "uniswap_v3";
      else targetProtocol = "uniswap_v3";
    }

    let barkerUrl = params.barkerUrl;

    const feeTier = params.feeTier || this.config.preferredFeeTier;
    const tickSpacing = feeTier >= 20000 ? 500 : 200;
    const ranges = this.calculateRanges(params.priceUsd, stage, capitalInvested, tickSpacing);

    let isDryRun = params.dryRun !== undefined ? params.dryRun : this.config.dryRun;
    let onChainTxHash: `0x${string}` | null = null;
    let mintedTokenId: string | undefined = undefined;
    let liveExecutionReason: string | undefined = undefined;

    if (params.mockLive) {
      isDryRun = false;
      onChainTxHash = `0xmock_live_${Date.now().toString(16)}` as `0x${string}`;
    }

    // Strict Live Guards
    if (!isDryRun && !params.mockLive) {
      if (!this.config.hasRhKey || !this.config.walletAddress || !this.rawPrivateKey) {
        if (params.dryRun === false) {
          throw new Error("未绑定实盘做市私钥，请先点击【导入做市钱包】绑定私钥");
        }
        isDryRun = true;
        liveExecutionReason = "未绑定实盘私钥，自动降级为模拟测算";
        console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
      } else {
        // Check real on-chain balances per chain
        try {
          const status = await this.refreshWalletBalances();
          if (targetChain === "robinhood") {
            const ethNum = Number(status.ethBalance || "0");
            const usdgNum = Number(status.usdgBalance || "0");
            if (ethNum < 0.0005) {
              const msg = `Robinhood Gas ETH 不足 (${status.ethBalance} < 0.0005 ETH)，无法支付链上 Gas 费`;
              isDryRun = true;
              liveExecutionReason = `${msg}，自动降级为模拟测算`;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            } else if (usdgNum < capitalInvested) {
              const msg = `Robinhood USDG 本金不足 ($${status.usdgBalance} < $${capitalInvested.toFixed(2)})`;
              isDryRun = true;
              liveExecutionReason = `${msg}，自动降级为模拟测算`;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            }
          } else if (targetChain === "bsc") {
            const bnbNum = Number(status.bnbBalance || "0");
            const usdtNum = Number(status.bscUsdtBalance || "0");
            if (bnbNum < 0.001) {
              const msg = `BSC Gas BNB 不足 (${status.bnbBalance} < 0.001 BNB)，已自动转为模拟测算做市`;
              isDryRun = true;
              liveExecutionReason = msg;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            } else if (usdtNum < capitalInvested) {
              const msg = `BSC USDT 本金不足 ($${status.bscUsdtBalance} < $${capitalInvested.toFixed(2)})，已自动转为模拟测算做市`;
              isDryRun = true;
              liveExecutionReason = msg;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            }
          } else if (targetChain === "arbitrum") {
            const arbEthNum = Number(status.arbEthBalance || "0");
            const arbUsdcNum = Number(status.arbUsdcBalance || "0");
            if (arbEthNum < 0.0005) {
              const msg = `Arbitrum Gas ETH 不足 (${status.arbEthBalance} < 0.0005 ETH)，已自动转为模拟测算做市`;
              isDryRun = true;
              liveExecutionReason = msg;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            } else if (arbUsdcNum < capitalInvested) {
              const msg = `Arbitrum USDC 本金不足 ($${status.arbUsdcBalance} < $${capitalInvested.toFixed(2)})，已自动转为模拟测算做市`;
              isDryRun = true;
              liveExecutionReason = msg;
              console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
            }
          }
        } catch (balErr: any) {
          isDryRun = true;
          liveExecutionReason = `链上余额核验超时 (${balErr?.message})，自动降级为模拟测算`;
        }
      }

      // If still intending to execute live on-chain:
      if (!isDryRun && this.rawPrivateKey) {
        try {
          const account = privateKeyToAccount(this.rawPrivateKey as `0x${string}`);

          let walletChain: any = robinhoodChain;
          let walletTransport = rpcTransport;
          let activeClient: any = this.rhClient;
          let npmAddress: `0x${string}` = UNISWAP_V3_ROBINHOOD.NPM as `0x${string}`;
          let factoryAddress: `0x${string}` = UNISWAP_V3_ROBINHOOD.FACTORY as `0x${string}`;
          let quoteAddress: `0x${string}` = USDG as `0x${string}`;
          let quoteDecimals = 6;
          let routerAddress: `0x${string}` = UNISWAP_V3_ROBINHOOD.ROUTER as `0x${string}`;

          if (targetChain === "bsc") {
            walletChain = bsc;
            walletTransport = bscTransport;
            activeClient = this.bscClient;
            npmAddress = PANCAKE_V3_BSC.NPM as `0x${string}`;
            factoryAddress = PANCAKE_V3_BSC.FACTORY as `0x${string}`;
            quoteAddress = PANCAKE_V3_BSC.USDT as `0x${string}`;
            quoteDecimals = 18;
            routerAddress = PANCAKE_V3_BSC.ROUTER as `0x${string}`;
          } else if (targetChain === "arbitrum") {
            walletChain = arbitrum;
            walletTransport = arbTransport;
            activeClient = this.arbClient;
            npmAddress = UNISWAP_V3_ARBITRUM.NPM as `0x${string}`;
            factoryAddress = UNISWAP_V3_ARBITRUM.FACTORY as `0x${string}`;
            quoteAddress = UNISWAP_V3_ARBITRUM.USDC as `0x${string}`;
            quoteDecimals = 6;
            routerAddress = UNISWAP_V3_ARBITRUM.ROUTER as `0x${string}`;
          }

          const wallet: any = createWalletClient({
            account,
            chain: walletChain,
            transport: walletTransport,
          });

          const tokenAddress = params.tokenAddress as `0x${string}`;

          // Check if pool exists on Uniswap/Pancake V3 Factory
          const factoryAbi = parseAbi([
            "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
          ]);
          const poolAbi = parseAbi([
            "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
          ]);

          // Normalize fee tier for V3 (V3 only supports 100, 500, 3000, 10000)
          let targetFee = feeTier;
          if (targetFee > 10000) {
            targetFee = 10000;
          }

          // Try finding a valid V3 pool with quote token
          let activeV3Pool: `0x${string}` = "0x0000000000000000000000000000000000000000";
          let selectedFee = targetFee;

          for (const testFee of [targetFee, 10000, 3000, 500, 100]) {
            try {
              const p = await activeClient.readContract({
                address: factoryAddress,
                abi: factoryAbi,
                functionName: "getPool",
                args: [tokenAddress, quoteAddress, testFee],
              });
              if (p && p !== "0x0000000000000000000000000000000000000000") {
                activeV3Pool = p;
                selectedFee = testFee;
                break;
              }
            } catch {}
          }

          if (activeV3Pool === "0x0000000000000000000000000000000000000000") {
            const v4Hint = params.pairAddress
              ? ` (当前主要在 Uniswap V4 / Barker 协议交易，PoolId: ${params.pairAddress.slice(0, 10)}...)`
              : "";
            const msg = `标的 $${params.symbol} 尚未在 Uniswap V3 初始化做市池${v4Hint}。已自动转为模拟盘进行策略测算与非对称网格跟踪，未扣除链上资金。`;
            // Safe fallback without throwing error!
            isDryRun = true;
            targetProtocol = "uniswap_v4_barker";
            barkerUrl = params.barkerUrl || "https://app.barker.money/raid/robinhood";
            liveExecutionReason = msg;
            console.warn(`[LpService] ⚠️ ${msg}`);
          } else {
            // Read slot0 tick
            const slot0 = await activeClient.readContract({
              address: activeV3Pool,
              abi: poolAbi,
              functionName: "slot0",
            });
            const currentTick = Number(slot0[1]);
            const tickSpacing =
              selectedFee === 100 ? 1 : selectedFee === 500 ? 10 : selectedFee === 3000 ? 60 : 200;

            // Sort tokens
            const isToken0 = tokenAddress.toLowerCase() < quoteAddress.toLowerCase();
            const token0 = isToken0 ? tokenAddress : quoteAddress;
            const token1 = isToken0 ? quoteAddress : tokenAddress;

            // 1. Read target token decimals and current balance
            const tokenDecimals = await activeClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: "decimals",
            });
            const initialTargetBalance = await activeClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account.address],
            });

            // 2. Pre-purchase target token using quoteToken via SwapRouter if balance is insufficient
            const estTargetTokensNeeded = BigInt(
              Math.max(1, Math.floor((capitalInvested / Math.max(0.000001, params.priceUsd)) * 10 ** tokenDecimals))
            );
            let targetTokenAvailable = initialTargetBalance;

            const capitalWei = BigInt(Math.floor(capitalInvested * 10 ** quoteDecimals));

            if (initialTargetBalance < (estTargetTokensNeeded * 8n) / 10n) {
              const quoteSymbol = targetChain === "bsc" ? "USDT" : targetChain === "arbitrum" ? "USDC" : "USDG";
              console.log(`[LpService] 🛒 预先购买热门上升期代币 $${params.symbol}: 投入 $${capitalInvested.toFixed(2)} ${quoteSymbol}...`);

              const quoteAllowance = await activeClient.readContract({
                address: quoteAddress,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [account.address, routerAddress],
              });

              if (quoteAllowance < capitalWei) {
                console.log(`[LpService] 🔑 授权本金代币给 SwapRouter (${routerAddress})...`);
                const approveHash = await wallet.writeContract({
                  address: quoteAddress,
                  abi: ERC20_ABI,
                  functionName: "approve",
                  args: [routerAddress, 2n ** 256n - 1n],
                });
                await activeClient.waitForTransactionReceipt({ hash: approveHash });
                console.log(`[LpService] ✅ 授权 SwapRouter 成功: ${approveHash}`);
              }

              const swapHash = await wallet.writeContract({
                address: routerAddress,
                abi: SWAP_ROUTER_ABI,
                functionName: "exactInputSingle",
                args: [{
                  tokenIn: quoteAddress,
                  tokenOut: tokenAddress,
                  fee: selectedFee,
                  recipient: account.address,
                  amountIn: capitalWei,
                  amountOutMinimum: 0n,
                  sqrtPriceLimitX96: 0n,
                }],
              });
              console.log(`[LpService] ⏳ Swap 预买交易已广播: ${swapHash}，等待链上确认...`);
              await activeClient.waitForTransactionReceipt({ hash: swapHash });

              const afterSwapBalance = await activeClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [account.address],
              });
              targetTokenAvailable = afterSwapBalance > initialTargetBalance ? afterSwapBalance - initialTargetBalance : afterSwapBalance;
              console.log(`[LpService] 🎯 成功买入标的代币: ${formatUnits(targetTokenAvailable, tokenDecimals)} $${params.symbol}`);
            } else {
              targetTokenAvailable = estTargetTokensNeeded < initialTargetBalance ? estTargetTokensNeeded : initialTargetBalance;
              console.log(`[LpService] 💼 钱包已持有充足标的代币: ${formatUnits(targetTokenAvailable, tokenDecimals)} $${params.symbol}，直接挂上方单边LP`);
            }

            // 3. Calculate Upper Single-Sided Range (挂上方单边代币池，100%代币，0稳定币)
            const upperTargetPct = isRwa
              ? (this.config.rwaBandWidthPct || 10)
              : (this.config.singleSidedUpperCorePct || 20);

            const upperOffsetTicks = Math.max(
              tickSpacing * 2,
              Math.round(Math.log(1 + upperTargetPct / 100) / Math.log(1.0001)),
            );

            let tickLower: number;
            let tickUpper: number;
            let amount0Desired: bigint;
            let amount1Desired: bigint;

            if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
              // Target token is token0 (P = token1/token0 = quote/target)
              // Higher target price in USD means HIGHER tick.
              // Upper range (above current price) starts right above currentTick
              tickLower = Math.ceil((currentTick + tickSpacing) / tickSpacing) * tickSpacing;
              tickUpper = Math.ceil((tickLower + upperOffsetTicks) / tickSpacing) * tickSpacing;
              amount0Desired = targetTokenAvailable;
              amount1Desired = 0n;
            } else {
              // Target token is token1 (P = token1/token0 = target/quote)
              // Higher target price in USD means LOWER tick (fewer tokens per USDG).
              // Upper range in USD price is strictly below currentTick in tick space
              tickUpper = Math.floor((currentTick - tickSpacing) / tickSpacing) * tickSpacing;
              tickLower = Math.floor((tickUpper - upperOffsetTicks) / tickSpacing) * tickSpacing;
              amount0Desired = 0n;
              amount1Desired = targetTokenAvailable;
            }

            // 4. Approve Target Token to NonfungiblePositionManager
            const currentTokenAllowance = await activeClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [account.address, npmAddress],
            });

            if (currentTokenAllowance < targetTokenAvailable) {
              console.log(`[LpService] 🔑 授权标的代币给 PositionManager (${npmAddress})...`);
              const approveTokenHash = await wallet.writeContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [npmAddress, 2n ** 256n - 1n],
              });
              await activeClient.waitForTransactionReceipt({ hash: approveTokenHash });
              console.log(`[LpService] ✅ 标的代币授权成功: ${approveTokenHash}`);
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

            console.log(`[LpService] 🚀 正在向 ${targetChain.toUpperCase()} NPM 发起上链铸造 LP 头寸: $${params.symbol}...`);
            const mintHash = await wallet.writeContract({
              address: npmAddress,
              abi: POSITION_MANAGER_ABI,
              functionName: "mint",
              args: [
                {
                  token0,
                  token1,
                  fee: selectedFee,
                  tickLower,
                  tickUpper,
                  amount0Desired,
                  amount1Desired,
                  amount0Min: 0n,
                  amount1Min: 0n,
                  recipient: account.address,
                  deadline,
                },
              ],
            });

            console.log(`[LpService] ⏳ 交易已广播: ${mintHash}，等待链上确认...`);
            const receipt = await activeClient.waitForTransactionReceipt({ hash: mintHash });
            if (receipt.status === "success") {
              onChainTxHash = mintHash;
              // Extract tokenId from Transfer event logs
              const transferLog = receipt.logs.find(
                (l: any) =>
                  l.address.toLowerCase() === npmAddress.toLowerCase() &&
                  l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
                  l.topics.length === 4,
              );
              if (transferLog && transferLog.topics[3]) {
                mintedTokenId = BigInt(transferLog.topics[3]).toString();
              }
              console.log(`[LpService] 🎯 真实链上 LP 铸造成功! TokenId: ${mintedTokenId || "N/A"}, TxHash: ${mintHash}`);
            } else {
              throw new Error(`链上交易回滚 (Reverted): ${mintHash}`);
            }
          }
        } catch (err: any) {
          isDryRun = true;
          liveExecutionReason = `链上做市未能完成 (${err.shortMessage || err.message})，为保护资金安全已转为模拟测算`;
          console.warn(`[LpService] ⚠️ 真实上链未成功，安全降级模拟:`, err?.message || err);
        }
      }
    }

    // Active band & concentration metrics
    const coreRange = ranges[0];
    const capitalEfficiency = LpService.calculateConcentrationMultiplier(
      coreRange.minPriceUsd,
      coreRange.maxPriceUsd,
    );
    const activeBandLiq =
      params.activeBandLiquidityUsd || Math.max(1000, params.liquidityUsd * 0.25);
    const feeTierRate = feeTier / 1_000_000;
    const dailyFeeRatePct =
      activeBandLiq > 0
        ? Math.min(1000, ((params.volume5m * 12 * 24 * feeTierRate) / activeBandLiq) * 100)
        : 0;

    const positionId = `lp-${Date.now()}-${params.symbol.toLowerCase()}`;
    const txId = onChainTxHash || `tx-${Date.now()}-open`;

    const txRecord: LpTxRecord = {
      id: txId,
      type: "MINT_LP",
      timestamp: new Date().toISOString(),
      details: onChainTxHash
        ? `[真实链上] 成功在 ${targetChain.toUpperCase()} 创建 V3 集中做市头寸 (${stage}${isRwa ? " · 美股RWA" : ""}): 资金 $${capitalInvested.toFixed(2)}, Tx: ${onChainTxHash}`
        : `创建做市头寸 (${stage}${isRwa ? " · 美股RWA" : ""}, 链: ${targetChain}): 资金 $${capitalInvested.toFixed(2)}, 乘数: ${capitalEfficiency.toFixed(1)}x${liveExecutionReason ? ` (${liveExecutionReason})` : ""}`,
      amountUsd: capitalInvested,
      dryRun: isDryRun,
      status: "CONFIRMED",
    };

    const position: LpPosition = {
      id: positionId,
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name || rwaMatch.stockName,
      chain: targetChain,
      protocol: targetProtocol,
      barkerUrl,
      pairAddress: params.pairAddress,
      feeTier,
      stage,
      category,
      isRwa,
      stockSymbol,
      dryRun: isDryRun,
      tokenId: mintedTokenId,
      onChainTxHash: onChainTxHash || undefined,
      entryTime: new Date().toISOString(),
      entryPriceUsd: params.priceUsd,
      initialUsdInvested: capitalInvested,
      currentPriceUsd: params.priceUsd,
      volume5mAtEntry: params.volume5m,
      liquidityAtEntry: params.liquidityUsd,
      latestVolume5m: params.volume5m,
      volumeDropPct: 0,
      activeBandLiquidityUsd: activeBandLiq,
      capitalEfficiencyRatio: capitalEfficiency,
      dailyFeeRatePct,
      holdVsLpScore: 50,
      ranges,
      feeEarnedUsd: 0,
      principalWithdrawnUsd: 0,
      impermanentLossUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      rebalanceCount: 0,
      upperPiercedTargetPriceUsd: Math.max(
        params.priceUsd * (1 + (isRwa ? (this.config.rwaBandWidthPct || 10) : (this.config.singleSidedUpperCorePct || 20)) / 100),
        ranges.reduce((max, r) => Math.max(max, r.maxPriceUsd), params.priceUsd)
      ),
      upperPiercedProgressPct: 0,
      stopLossPriceUsd: params.priceUsd * (1 + (this.config.fastStopLossPct ?? -8) / 100),
      stopLossPct: this.config.fastStopLossPct ?? -8,
      strategyType: "UPPER_TAKE_PROFIT",
      status: "ACTIVE",
      txHistory: [txRecord],
    };

    this.activePositions.set(positionId, position);
    this.saveToStorage();

    console.log(
      `🌊 [LpService] 建立集中做市头寸: $${params.symbol} (${stage}, 链: ${targetChain}, 协议: ${targetProtocol || "V3"}, 模式: ${isDryRun ? "模拟" : "实盘"}), 资金: $${capitalInvested.toFixed(2)}, 日费率预估: ${dailyFeeRatePct.toFixed(1)}%/天`,
    );

    if (this.config.larkNotification) {
      sendLarkLpOpenAlert({
        position,
        dryRun: isDryRun,
        webhookUrl: this.config.webhookUrl,
      }).catch((err) => console.warn("[LpService] Lark 建仓告警失败:", err));
    }

    return position;
  }

  // ==========================================
  // Microscopic Position Inspection & Execution
  // ==========================================

  public async inspectPositions(): Promise<void> {
    if (this.isCheckingPositions || this.activePositions.size === 0) return;
    this.isCheckingPositions = true;

    try {
      const nowMs = Date.now();
      for (const [posId, pos] of this.activePositions.entries()) {
        const poolInfo = await this.fetchPoolDexData(pos.tokenAddress);
        const livePrice = poolInfo?.priceUsd || pos.currentPriceUsd;
        const liveVol5m = poolInfo?.volume5m || pos.latestVolume5m;

        pos.currentPriceUsd = livePrice;
        pos.latestVolume5m = liveVol5m;

        // Calculate 5m volume drop
        if (pos.volume5mAtEntry > 0) {
          pos.volumeDropPct = ((pos.volume5mAtEntry - liveVol5m) / pos.volume5mAtEntry) * 100;
        }

        // Update active in-range status of each segment
        let activeCapitalAllocated = 0;
        for (const seg of pos.ranges) {
          seg.inRange = livePrice >= seg.minPriceUsd && livePrice <= seg.maxPriceUsd;
          if (seg.inRange) {
            activeCapitalAllocated += seg.capitalAllocatedUsd;
          }
        }

        // Concentrated Fee Accrual (time step ~30 seconds)
        // Using Active In-Range Band Liquidity Model
        const activeBandLiq = Math.max(1000, pos.activeBandLiquidityUsd || pos.liquidityAtEntry * 0.25);
        const feeTierRate = pos.feeTier / 1_000_000;

        if (activeCapitalAllocated > 0) {
          const sliceVolume = liveVol5m / 10; // ~30s slice of 5m volume
          const poolFeeShare = activeCapitalAllocated / activeBandLiq;
          const incrementalFee = sliceVolume * feeTierRate * poolFeeShare;
          pos.feeEarnedUsd += Math.max(0, incrementalFee);
        }

        // Update real-time daily fee rate %
        pos.dailyFeeRatePct = Math.min(
          1200,
          ((liveVol5m * 12 * 24 * feeTierRate) / activeBandLiq) * 100,
        );

        // Concentrated Impermanent Loss Model
        const priceRatio = livePrice / Math.max(0.0000001, pos.entryPriceUsd);
        if (priceRatio < 1.0) {
          // Downside IL
          const dropRatio = 1 - priceRatio;
          const ilMultiplier = pos.isRwa ? 1.0 : 1.25;
          pos.impermanentLossUsd = pos.initialUsdInvested * Math.min(1, dropRatio * ilMultiplier);
        } else {
          // Upside: tokens gradually sold to quote token
          const pumpRatio = priceRatio - 1;
          pos.impermanentLossUsd = pos.initialUsdInvested * Math.min(0.25, pumpRatio * 0.08);
        }

        // Net PnL
        pos.netPnlUsd = pos.feeEarnedUsd - pos.impermanentLossUsd;
        pos.netPnlPct = (pos.netPnlUsd / pos.initialUsdInvested) * 100;

        // Hold vs LP Comparative Score (0-100)
        const priceChangePct = ((livePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        pos.holdVsLpScore = Math.min(
          100,
          Math.max(0, Math.round(50 + (pos.netPnlPct - priceChangePct) * 2)),
        );

        // 1. Check Principal Recovery Condition (保本提润)
        const principalTarget = pos.initialUsdInvested * this.config.withdrawPrincipalFeeRatio;
        if (
          pos.feeEarnedUsd >= principalTarget &&
          pos.status === "ACTIVE" &&
          pos.principalWithdrawnUsd === 0
        ) {
          const withdrawAmount = pos.initialUsdInvested * 0.5;
          pos.principalWithdrawnUsd += withdrawAmount;
          pos.status = "PRINCIPAL_SECURED";

          pos.txHistory.push({
            id: `tx-${Date.now()}-withdraw`,
            type: "WITHDRAW_PRINCIPAL",
            timestamp: new Date().toISOString(),
            details: `手续费已达 $${pos.feeEarnedUsd.toFixed(2)}，成功提回本金 $${withdrawAmount.toFixed(2)} USDG，头寸进入零风险收租状态`,
            amountUsd: withdrawAmount,
            dryRun: pos.dryRun,
            status: "CONFIRMED",
          });

          console.log(`💰 [LpService] $${pos.symbol} 触发保本提润: 已提回 $${withdrawAmount.toFixed(2)} USDG`);

          if (this.config.larkNotification) {
            sendLarkLpCollectAlert({
              position: pos,
              harvestedFeeUsd: withdrawAmount,
              dryRun: pos.dryRun,
              webhookUrl: this.config.webhookUrl,
            }).catch((err) => console.warn("[LpService] Lark 提润告警失败:", err));
          }
        }

        // 2. Dynamic Rebalancing Check (智能移仓自愈)
        if (
          this.config.enableAutoRebalance &&
          (pos.rebalanceCount || 0) < this.config.maxRebalancesPerPosition &&
          (pos.status === "ACTIVE" || pos.status === "PRINCIPAL_SECURED")
        ) {
          const priceDriftPct =
            Math.abs((livePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
          const priceDropPct =
            ((livePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

          // If drifted outside band and not crashing below stop loss
          if (
            priceDriftPct >= this.config.rebalanceDriftThresholdPct &&
            priceDropPct > this.config.stopLossPriceDropPct
          ) {
            await this.rebalancePosition(
              pos.id,
              `市价偏离基准已达 ${priceDriftPct.toFixed(1)}% (智能动态移仓重平衡)`,
            );
            continue;
          }
        }

        // 3. Single-Sided Range Order: Update Upper Pierced Progress
        const maxRangePrice = pos.ranges.reduce((max, r) => Math.max(max, r.maxPriceUsd), pos.entryPriceUsd);
        pos.upperPiercedTargetPriceUsd = maxRangePrice;
        const targetDelta = maxRangePrice - pos.entryPriceUsd;
        const priceGain = livePrice - pos.entryPriceUsd;
        pos.upperPiercedProgressPct = targetDelta > 0
          ? Math.min(100, Math.max(0, Math.round((priceGain / targetDelta) * 100)))
          : 0;

        // A. Upper Boundary Pierced Check (穿上沿限价卖出获利清仓)
        // In Uniswap V3 math, once livePrice >= upperTick, 100% of the meme/target token is converted into quoteToken (USDG/USDT).
        // We immediately withdraw liquidity to lock in 100% principal + capital gain + accrued fees before price can retrace.
        const upperTarget = pos.upperPiercedTargetPriceUsd || maxRangePrice;
        const isUpperPierced = livePrice >= upperTarget;

        if (isUpperPierced && (this.config.enableUpperPiercedExit !== false)) {
          await this.closePosition(
            pos.id,
            "CLOSED_TAKEPROFIT_PIERCED",
            `🎯 价格强势击穿上方单边做市区间上沿 $${upperTarget.toFixed(4)} (代币已100%全额限价卖出换回稳定币，穿上沿撤池锁定暴利与手续费 $${pos.feeEarnedUsd.toFixed(2)})`,
          );
          continue;
        }

        // B. Fast Stop Loss Check (单边快速防崩止损: 无论土狗还是美股RWA，跌破止损线坚决离场)
        const fastSlThreshold = pos.stopLossPct ?? this.config.fastStopLossPct ?? -8;
        const priceDropPct = ((livePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        const isFastSlBreached = priceDropPct <= fastSlThreshold;
        if (isFastSlBreached && (pos.stage === "PUMP" || pos.strategyType === "UPPER_TAKE_PROFIT" || this.config.pumpMode === "SINGLE_SIDED_RANGE_ORDER" || pos.isRwa)) {
          await this.closePosition(
            pos.id,
            "CLOSED_STOPLOSS",
            `🛑 触及单边做市快速止损线 (${priceDropPct.toFixed(1)}% <= ${fastSlThreshold}%)，闪电撤池并市价清仓规避深跌与归零风险`,
          );
          continue;
        }

        // 4. Risk & Circuit Breaker Exit Conditions
        // A. Net PnL Stop Loss Breached
        const isNetLossBreached = pos.netPnlPct <= this.config.netPnlStopLossPct;

        // B. Volume Crash (>50% drop)
        const isVolumeCrashed = pos.volumeDropPct >= this.config.volumeDropExitThresholdPct;

        // C. Price fell below the lowest buffer range
        const lowestRange = pos.ranges.reduce((min, r) => Math.min(min, r.minPriceUsd), Infinity);
        const isPriceBreakoutDown = livePrice < lowestRange;

        // D. Hold Timeout
        const entryMs = new Date(pos.entryTime).getTime();
        const holdMinutes = (nowMs - entryMs) / 60000;
        const maxHold = pos.isRwa ? this.config.maxHoldMinutes * 3 : this.config.maxHoldMinutes;
        const isTimeout = holdMinutes >= maxHold;

        if (isNetLossBreached) {
          await this.closePosition(
            pos.id,
            "CLOSED_STOPLOSS",
            `净亏损触及硬止损线 (${pos.netPnlPct.toFixed(1)}% <= ${this.config.netPnlStopLossPct}%), 启动熔断撤池`,
          );
        } else if (isVolumeCrashed && !pos.isRwa) {
          await this.closePosition(pos.id, "CLOSED_VOL_DROP", "5分钟交易量断崖下跌 >50% (流动摩擦枯竭)");
        } else if (isPriceBreakoutDown) {
          await this.closePosition(pos.id, "CLOSED_STOPLOSS", "价格击穿最下沿防护区间 (触发紧急熔断 Flash Exit)");
        } else if (isTimeout) {
          await this.closePosition(pos.id, "CLOSED_TIMEOUT", `持仓时间已达 ${maxHold} 分钟上限`);
        }
      }

      this.saveToStorage();
    } catch (err: any) {
      console.warn("[LpService] 巡检处理异常:", err?.message || err);
    } finally {
      this.isCheckingPositions = false;
    }
  }

  // ==========================================
  // Dynamic Rebalance Position Handler
  // ==========================================

  public async rebalancePosition(positionId: string, reason: string): Promise<LpPosition | null> {
    const pos = this.activePositions.get(positionId);
    if (!pos) return null;

    const oldPrice = pos.entryPriceUsd;
    const newPrice = pos.currentPriceUsd;
    const tickSpacing = pos.feeTier >= 20000 ? 500 : 200;
    const newRanges = this.calculateRanges(newPrice, pos.stage, pos.initialUsdInvested, tickSpacing);

    pos.entryPriceUsd = newPrice;
    pos.ranges = newRanges;
    pos.rebalanceCount = (pos.rebalanceCount || 0) + 1;
    pos.lastRebalanceTime = new Date().toISOString();

    const txRecord: LpTxRecord = {
      id: `tx-${Date.now()}-rebalance`,
      type: "REBALANCE",
      timestamp: pos.lastRebalanceTime,
      details: `${reason}: 基准价从 $${oldPrice.toFixed(4)} 移至 $${newPrice.toFixed(4)}，已锁定手续费收益 $${pos.feeEarnedUsd.toFixed(2)}`,
      amountUsd: pos.initialUsdInvested,
      feeHarvestedUsd: pos.feeEarnedUsd,
      dryRun: pos.dryRun,
      status: "CONFIRMED",
    };
    pos.txHistory.push(txRecord);
    this.saveToStorage();

    console.log(
      `🔄 [LpService] $${pos.symbol} 智能移仓完成 (第 ${pos.rebalanceCount} 次, 模式: ${pos.dryRun ? "模拟" : "实盘"}): 新中枢价 $${newPrice.toFixed(4)}`,
    );

    if (this.config.larkNotification) {
      const driftPct = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
      sendLarkLpRebalanceAlert({
        position: pos,
        oldPriceUsd: oldPrice,
        newPriceUsd: newPrice,
        driftPct,
        dryRun: pos.dryRun,
        webhookUrl: this.config.webhookUrl,
      }).catch((err) => console.warn("[LpService] Lark 移仓告警失败:", err));
    }

    return pos;
  }

  // ==========================================
  // Flash Exit & Close Position
  // ==========================================

  public async closePosition(
    positionId: string,
    status:
      | "CLOSED_PROFIT"
      | "CLOSED_STOPLOSS"
      | "CLOSED_VOL_DROP"
      | "CLOSED_TIMEOUT"
      | "CLOSED_MANUAL"
      | "CLOSED_TAKEPROFIT_PIERCED",
    reason: string,
  ): Promise<LpPosition | null> {
    const pos = this.activePositions.get(positionId);
    if (!pos) return null;

    let onChainCloseTx: string | undefined = undefined;

    // Real on-chain Uniswap V3 liquidity withdrawal & collection
    if (!pos.dryRun && pos.tokenId && this.rawPrivateKey) {
      try {
        console.log(`[LpService] 🚀 正在向 Uniswap V3 发起链上撤池提取: NFT #${pos.tokenId}...`);
        const account = privateKeyToAccount(this.rawPrivateKey as `0x${string}`);

        let walletChain: any = robinhoodChain;
        let walletTransport = rpcTransport;
        let activeClient: any = this.rhClient;
        let npmAddress: `0x${string}` = UNISWAP_V3_ROBINHOOD.NPM as `0x${string}`;

        if (pos.chain === "bsc") {
          walletChain = bsc;
          walletTransport = bscTransport;
          activeClient = this.bscClient;
          npmAddress = PANCAKE_V3_BSC.NPM as `0x${string}`;
        } else if (pos.chain === "arbitrum") {
          walletChain = arbitrum;
          walletTransport = arbTransport;
          activeClient = this.arbClient;
          npmAddress = UNISWAP_V3_ARBITRUM.NPM as `0x${string}`;
        }

        console.log(`[LpService] 🚀 正在向 ${pos.chain?.toUpperCase() || "ROBINHOOD"} NPM 发起链上撤池提取: NFT #${pos.tokenId}...`);

        const wallet: any = createWalletClient({
          account,
          chain: walletChain,
          transport: walletTransport,
        });
        const tokenIdBig = BigInt(pos.tokenId);

        const onChainPos = await activeClient.readContract({
          address: npmAddress,
          abi: POSITION_MANAGER_ABI,
          functionName: "positions",
          args: [tokenIdBig],
        });
        const currentLiquidity = onChainPos[7];

        if (currentLiquidity > 0n) {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
          const decHash = await wallet.writeContract({
            address: npmAddress,
            abi: POSITION_MANAGER_ABI,
            functionName: "decreaseLiquidity",
            args: [{
              tokenId: tokenIdBig,
              liquidity: currentLiquidity,
              amount0Min: 0n,
              amount1Min: 0n,
              deadline,
            }],
          });
          console.log(`[LpService] ⏳ decreaseLiquidity 等待链上确认: ${decHash}...`);
          await activeClient.waitForTransactionReceipt({ hash: decHash });
          console.log(`[LpService] ✅ 成功撤回链上流动性: ${decHash}`);
        }

        const maxUint128 = 2n ** 128n - 1n;
        const colHash = await wallet.writeContract({
          address: npmAddress,
          abi: POSITION_MANAGER_ABI,
          functionName: "collect",
          args: [{
            tokenId: tokenIdBig,
            recipient: account.address,
            amount0Max: maxUint128,
            amount1Max: maxUint128,
          }],
        });
        console.log(`[LpService] ⏳ collect 等待链上确认: ${colHash}...`);
        await activeClient.waitForTransactionReceipt({ hash: colHash });
        console.log(`[LpService] ✅ 成功提取本金与手续费至钱包: ${colHash}`);
        onChainCloseTx = colHash;

        // In case of stop-loss, immediately sell returned volatile target tokens back to quoteToken
        if (status === "CLOSED_STOPLOSS") {
          try {
            let routerAddress: `0x${string}` = UNISWAP_V3_ROBINHOOD.ROUTER as `0x${string}`;
            let quoteAddress: `0x${string}` = USDG as `0x${string}`;
            if (pos.chain === "bsc") {
              routerAddress = PANCAKE_V3_BSC.ROUTER as `0x${string}`;
              quoteAddress = PANCAKE_V3_BSC.USDT as `0x${string}`;
            } else if (pos.chain === "arbitrum") {
              routerAddress = UNISWAP_V3_ARBITRUM.ROUTER as `0x${string}`;
              quoteAddress = UNISWAP_V3_ARBITRUM.USDC as `0x${string}`;
            }

            const tokenAddress = pos.tokenAddress as `0x${string}`;
            const tokenBal = await activeClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account.address],
            });

            if (tokenBal > 0n) {
              console.log(`[LpService] 🛑 触发止损市价清仓: 正在将代币 $${pos.symbol} (${tokenBal.toString()}) 卖出换回稳定币...`);
              const curAllowance = await activeClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [account.address, routerAddress],
              });
              if (curAllowance < tokenBal) {
                const appHash = await wallet.writeContract({
                  address: tokenAddress,
                  abi: ERC20_ABI,
                  functionName: "approve",
                  args: [routerAddress, 2n ** 256n - 1n],
                });
                await activeClient.waitForTransactionReceipt({ hash: appHash });
              }

              const targetFee = pos.feeTier > 10000 ? 10000 : (pos.feeTier || 500);
              const sellHash = await wallet.writeContract({
                address: routerAddress,
                abi: SWAP_ROUTER_ABI,
                functionName: "exactInputSingle",
                args: [{
                  tokenIn: tokenAddress,
                  tokenOut: quoteAddress,
                  fee: targetFee,
                  recipient: account.address,
                  amountIn: tokenBal,
                  amountOutMinimum: 0n,
                  sqrtPriceLimitX96: 0n,
                }],
              });
              await activeClient.waitForTransactionReceipt({ hash: sellHash });
              console.log(`[LpService] ✅ 止损市价卖出成功: ${sellHash}`);
              onChainCloseTx = sellHash;
            }
          } catch (slErr: any) {
            console.warn(`[LpService] ⚠️ 止损市价卖出未能执行:`, slErr?.message || slErr);
          }
        }

        this.refreshWalletBalances().catch(() => {});
      } catch (err: any) {
        console.error(`[LpService] ❌ 链上撤池异常 (NFT #${pos.tokenId}):`, err?.message || err);
      }
    }

    pos.status = status;
    pos.exitReason = reason;
    pos.closeTime = new Date().toISOString();

    const exitTx: LpTxRecord = {
      id: `tx-${Date.now()}-exit`,
      type: "EXIT_FLASH",
      timestamp: pos.closeTime,
      txHash: onChainCloseTx,
      details: pos.dryRun
        ? `撤回流动性并一键兑回 USDG: ${reason} (最终实现手续费: $${pos.feeEarnedUsd.toFixed(2)}, IL: -$${pos.impermanentLossUsd.toFixed(2)})`
        : `[真实链上] 成功撤出 NFT #${pos.tokenId} 流动性并提取至钱包: ${reason} (Tx: ${onChainCloseTx || "已完成"})`,
      amountUsd: pos.initialUsdInvested + pos.netPnlUsd,
      feeHarvestedUsd: pos.feeEarnedUsd,
      dryRun: pos.dryRun,
      status: "CONFIRMED",
    };
    pos.txHistory.push(exitTx);

    // Archive
    this.activePositions.delete(positionId);
    this.closedPositions.unshift(pos);
    this.saveToStorage();

    console.log(
      `🏁 [LpService] 结项归档: $${pos.symbol} (模式: ${pos.dryRun ? "模拟" : "实盘"}), 净盈亏: $${pos.netPnlUsd.toFixed(2)} (${pos.netPnlPct.toFixed(1)}%), 原因: ${reason}`,
    );

    if (this.config.larkNotification) {
      const state = this.getState();
      const stats = pos.dryRun ? state.paperStats : state.liveStats;
      const filteredClosed = this.closedPositions.filter((p) => p.dryRun === pos.dryRun);

      sendLarkComprehensiveLpReport({
        closedPosition: pos,
        allClosedPositions: filteredClosed,
        activeCount: stats.activeCount,
        totalRealizedPnlUsd: stats.totalRealizedPnlUsd,
        totalFeeEarnedUsd: stats.totalFeeEarnedUsd,
        winCount: stats.winCount,
        lossCount: stats.lossCount,
        winRatePct: stats.winRatePct,
        dryRun: pos.dryRun,
        webhookUrl: this.config.webhookUrl,
      }).catch((err) => console.warn("[LpService] 发送全量结项战报失败:", err));
    }

    return pos;
  }

  public async closeAllPositions(scope: "paper" | "live" | "all" = "all"): Promise<number> {
    const targets = Array.from(this.activePositions.values()).filter((pos) => {
      if (scope === "paper") return pos.dryRun;
      if (scope === "live") return !pos.dryRun;
      return true;
    });

    for (const pos of targets) {
      await this.closePosition(
        pos.id,
        "CLOSED_MANUAL",
        `管理员一键撤池清仓 (${pos.dryRun ? "模拟盘" : "实盘"})`,
      );
    }
    return targets.length;
  }

  public async fetchPoolDexData(tokenAddress: string): Promise<{
    priceUsd: number | null;
    liquidityUsd: number | null;
    volume5m: number | null;
    priceChangeM5: number | null;
    pairAddress?: string;
    name?: string;
  }> {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        {
          headers: {
            "User-Agent": BROWSER_UA,
          },
          signal: AbortSignal.timeout(6000),
        },
      );
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as any;
        const pairs = Array.isArray(j.pairs) ? j.pairs : [];
        if (pairs.length > 0) {
          const rhPairs = pairs.filter((x: any) => x.chainId === "robinhood");
          const p =
            rhPairs.find((x: any) => x.quoteToken?.symbol?.toUpperCase() === "USDG") ||
            rhPairs[0] ||
            pairs[0];
          return {
            priceUsd: Number(p.priceUsd) || null,
            liquidityUsd: Number(p.liquidity?.usd) || null,
            volume5m:
              Number(p.volume?.m5) ||
              (Number(p.volume?.h1) ? Number(p.volume.h1) / 12 : null),
            priceChangeM5: Number(p.priceChange?.m5) || null,
            pairAddress: p.pairAddress,
            name: p.baseToken?.name,
          };
        }
      }
    } catch {
      // Ignored
    }
    return {
      priceUsd: null,
      liquidityUsd: null,
      volume5m: null,
      priceChangeM5: null,
    };
  }
}

export const lpService = LpService.getInstance();
