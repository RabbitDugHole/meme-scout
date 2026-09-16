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
import { USDG, UNISWAP_V3_ROBINHOOD } from "./constants";

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
        isReadyForLive: false,
        lastCheckedAt: new Date().toISOString(),
      };
      return this.cachedWalletStatus;
    }

    const addr = this.config.walletAddress as `0x${string}`;
    try {
      const ethBalRaw = await this.rhClient.getBalance({ address: addr });
      const ethFormatted = (Number(ethBalRaw) / 1e18).toFixed(4);

      let usdgFormatted = "0.00";
      try {
        const usdgBalRaw = await this.rhClient.readContract({
          address: USDG as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        });
        // USDG has 6 decimals on Robinhood Chain
        usdgFormatted = (Number(usdgBalRaw) / 1e6).toFixed(2);
      } catch (err) {
        console.warn("[LpService] 查询 USDG 余额失败:", err);
      }

      const ethNum = Number(ethFormatted);
      const usdgNum = Number(usdgFormatted);
      const isReady = ethNum >= 0.001 && usdgNum >= 10;
      let warning: string | undefined = undefined;

      if (ethNum < 0.001) {
        warning = "ETH (Gas) 余额偏低 (< 0.001 ETH)，建议充值至少 0.002 ETH 避免上链交易失败";
      } else if (usdgNum < 10) {
        warning = "USDG (本金) 余额偏低 (< 10 USDG)，建议充值至少 50 USDG 以满足单池做市要求";
      }

      this.cachedWalletStatus = {
        hasWallet: true,
        walletAddress: addr,
        ethBalance: ethFormatted,
        usdgBalance: usdgFormatted,
        isReadyForLive: isReady,
        warning,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      console.warn("[LpService] 刷新钱包余额网络错误:", err?.message || err);
      if (this.cachedWalletStatus) {
        this.cachedWalletStatus.warning = "RPC 查询余额超时，请稍后重试";
        this.cachedWalletStatus.ethBalance = this.cachedWalletStatus.ethBalance || "0.0000";
        this.cachedWalletStatus.usdgBalance = this.cachedWalletStatus.usdgBalance || "0.00";
      }
    }

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
    chain: string;
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
        // Check real on-chain balances
        try {
          const status = await this.refreshWalletBalances();
          const ethNum = Number(status.ethBalance || "0");
          const usdgNum = Number(status.usdgBalance || "0");
          if (ethNum < 0.0005) {
            const msg = `Gas ETH 不足 (${status.ethBalance} < 0.0005 ETH)，无法支付链上 Gas 费`;
            if (params.dryRun === false) throw new Error(msg);
            isDryRun = true;
            liveExecutionReason = `${msg}，自动降级为模拟测算`;
            console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
          } else if (usdgNum < capitalInvested) {
            const msg = `USDG 本金不足 ($${status.usdgBalance} < $${capitalInvested.toFixed(2)})`;
            if (params.dryRun === false) throw new Error(msg);
            isDryRun = true;
            liveExecutionReason = `${msg}，自动降级为模拟测算`;
            console.warn(`[LpService] ⚠️ ${liveExecutionReason}`);
          }
        } catch (balErr: any) {
          if (params.dryRun === false) throw balErr;
          isDryRun = true;
          liveExecutionReason = `链上余额核验超时 (${balErr?.message})，自动降级为模拟测算`;
        }
      }

      // If still intending to execute live on-chain:
      if (!isDryRun && this.rawPrivateKey) {
        try {
          const account = privateKeyToAccount(this.rawPrivateKey as `0x${string}`);
          const wallet = createWalletClient({
            account,
            chain: robinhoodChain,
            transport: rpcTransport,
          });

          const npmAddress = UNISWAP_V3_ROBINHOOD.NPM as `0x${string}`;
          const factoryAddress = UNISWAP_V3_ROBINHOOD.FACTORY as `0x${string}`;
          const usdgAddress = USDG as `0x${string}`;
          const tokenAddress = params.tokenAddress as `0x${string}`;

          // Check if pool exists on Uniswap V3 Factory
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

          // Try finding a valid V3 pool with USDG
          let activeV3Pool: `0x${string}` = "0x0000000000000000000000000000000000000000";
          let selectedFee = targetFee;

          for (const testFee of [targetFee, 10000, 3000, 500, 100]) {
            try {
              const p = await this.rhClient.readContract({
                address: factoryAddress,
                abi: factoryAbi,
                functionName: "getPool",
                args: [tokenAddress, usdgAddress, testFee],
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
            const msg = `标的 $${params.symbol} 尚未在 Uniswap V3 初始化做市池${v4Hint}。实盘做市仅支持 Uniswap V3 池，或在【模拟】标签下进行策略测算。`;
            if (params.dryRun === false) {
              throw new Error(msg);
            } else {
              isDryRun = true;
              liveExecutionReason = msg;
              console.warn(`[LpService] ⚠️ ${msg}`);
            }
          } else {
            // Read slot0 tick
            const slot0 = await this.rhClient.readContract({
              address: activeV3Pool,
              abi: poolAbi,
              functionName: "slot0",
            });
            const currentTick = Number(slot0[1]);
            const tickSpacing =
              selectedFee === 100 ? 1 : selectedFee === 500 ? 10 : selectedFee === 3000 ? 60 : 200;

            // Sort tokens
            const isToken0 = tokenAddress.toLowerCase() < usdgAddress.toLowerCase();
            const token0 = isToken0 ? tokenAddress : usdgAddress;
            const token1 = isToken0 ? usdgAddress : tokenAddress;

            // Approve USDG if needed
            const capitalWei = BigInt(Math.floor(capitalInvested * 1e6));
            const currentAllowance = await this.rhClient.readContract({
              address: usdgAddress,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [account.address, npmAddress],
            });

            if (currentAllowance < capitalWei) {
              console.log(`[LpService] 🔑 授权 USDG 给 Uniswap V3 PositionManager...`);
              const approveHash = await wallet.writeContract({
                address: usdgAddress,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [npmAddress, 2n ** 256n - 1n],
              });
              await this.rhClient.waitForTransactionReceipt({ hash: approveHash });
              console.log(`[LpService] ✅ USDG 授权成功: ${approveHash}`);
            }

            // Single-sided USDG range order (below current price)
            let tickLower: number;
            let tickUpper: number;
            let amount0Desired: bigint;
            let amount1Desired: bigint;

            if (token1.toLowerCase() === usdgAddress.toLowerCase()) {
              // token1 is USDG: tickUpper <= currentTick
              tickLower = Math.floor((currentTick - 1000) / tickSpacing) * tickSpacing;
              tickUpper = Math.floor((currentTick - 200) / tickSpacing) * tickSpacing;
              amount0Desired = 0n;
              amount1Desired = capitalWei;
            } else {
              // token0 is USDG: tickLower >= currentTick
              tickLower = Math.ceil((currentTick + 200) / tickSpacing) * tickSpacing;
              tickUpper = Math.ceil((currentTick + 1000) / tickSpacing) * tickSpacing;
              amount0Desired = capitalWei;
              amount1Desired = 0n;
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

            console.log(`[LpService] 🚀 正在向 Uniswap V3 NPM 发起上链铸造 LP 头寸: $${params.symbol}...`);
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
            const receipt = await this.rhClient.waitForTransactionReceipt({ hash: mintHash });
            if (receipt.status === "success") {
              onChainTxHash = mintHash;
              // Extract tokenId from Transfer event logs
              const transferLog = receipt.logs.find(
                (l) =>
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
          if (params.dryRun === false) {
            // User explicitly requested real on-chain execution, throw the failure so UI surfaces it!
            throw new Error(`真实链上做市未完成: ${err.shortMessage || err.message}`);
          }
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
        ? `[真实链上] 成功创建 V3 集中做市头寸 (${stage}${isRwa ? " · 美股RWA" : ""}): 资金 $${capitalInvested.toFixed(2)} USDG, Tx: ${onChainTxHash}`
        : `创建 V4 集中做市头寸 (${stage}${isRwa ? " · 美股RWA" : ""}): 资金 $${capitalInvested.toFixed(2)} USDG, 乘数: ${capitalEfficiency.toFixed(1)}x${liveExecutionReason ? ` (${liveExecutionReason})` : ""}`,
      amountUsd: capitalInvested,
      dryRun: isDryRun,
      status: "CONFIRMED",
    };

    const position: LpPosition = {
      id: positionId,
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name || rwaMatch.stockName,
      chain: params.chain,
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
      upperPiercedTargetPriceUsd: ranges.reduce((max, r) => Math.max(max, r.maxPriceUsd), params.priceUsd),
      upperPiercedProgressPct: 0,
      status: "ACTIVE",
      txHistory: [txRecord],
    };

    this.activePositions.set(positionId, position);
    this.saveToStorage();

    console.log(
      `🌊 [LpService] 建立集中做市头寸: $${params.symbol} (${stage}, 属性: ${category}, 模式: ${isDryRun ? "模拟" : "实盘"}), 资金: $${capitalInvested.toFixed(2)} USDG, 日费率预估: ${dailyFeeRatePct.toFixed(1)}%/天`,
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
        // In Uniswap V3 math, once livePrice >= upperTick, 100% of the meme token is converted into USDG.
        // We immediately withdraw liquidity to lock in 100% principal + capital gain + accrued fees before price can retrace.
        const isUpperPierced = (pos.stage === "PUMP" || (this.config.pumpMode === "SINGLE_SIDED_RANGE_ORDER"))
          && livePrice >= maxRangePrice;

        if (isUpperPierced && (this.config.enableUpperPiercedExit !== false)) {
          await this.closePosition(
            pos.id,
            "CLOSED_TAKEPROFIT_PIERCED",
            `🎯 价格强势击穿单边做市区间上沿 $${maxRangePrice.toFixed(4)} (代币已100%限价卖出为USDG，穿上沿撤池锁定暴利与手续费 $${pos.feeEarnedUsd.toFixed(2)})`,
          );
          continue;
        }

        // B. Fast Stop Loss Check (单边快速防崩止损)
        const fastSlThreshold = this.config.fastStopLossPct ?? -8;
        const priceDropPct = ((livePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        const isFastSlBreached = priceDropPct <= fastSlThreshold;
        if (isFastSlBreached && pos.stage === "PUMP") {
          await this.closePosition(
            pos.id,
            "CLOSED_STOPLOSS",
            `🛑 触及单边做市快速止损线 (${priceDropPct.toFixed(1)}% <= ${fastSlThreshold}%)，闪电撤池规避山寨币归零风险`,
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
        const wallet = createWalletClient({
          account,
          chain: robinhoodChain,
          transport: rpcTransport,
        });
        const npmAddress = UNISWAP_V3_ROBINHOOD.NPM as `0x${string}`;
        const tokenIdBig = BigInt(pos.tokenId);

        const onChainPos = await this.rhClient.readContract({
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
          await this.rhClient.waitForTransactionReceipt({ hash: decHash });
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
        await this.rhClient.waitForTransactionReceipt({ hash: colHash });
        console.log(`[LpService] ✅ 成功提取本金与手续费至钱包: ${colHash}`);
        onChainCloseTx = colHash;

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
