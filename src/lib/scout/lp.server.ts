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
import { USDG } from "./constants";

// Robinhood Chain definition
const robinhoodChain = defineChain({
  id: 4668,
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

const DATA_DIR = path.resolve(process.cwd(), "data");
const LP_CONFIG_FILE = path.resolve(DATA_DIR, "lp-config.json");
const LP_POSITIONS_FILE = path.resolve(DATA_DIR, "lp-positions.json");
const LP_WALLET_FILE = path.resolve(DATA_DIR, "lp-wallet.json");

// Uniswap V3 / Pons NonfungiblePositionManager ABI interface snippet
const POSITION_MANAGER_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
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

  private config: LpConfig = {
    dryRun: true,
    autoLpEnabled: true,
    capitalPerPoolUsd: 50,
    maxActivePools: 5,
    maxPoolSharePct: 20,
    minVolumeToLiquidityRatio: 1.5,
    preferredFeeTier: 10000, // 1%
    maxTopHoldersPct: 35,
    minScoreThreshold: 80,

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

    larkNotification: true,
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
    walletAddress: undefined,
    hasRhKey: false,
  };

  private cachedWalletStatus: LpWalletStatus = {
    hasWallet: false,
    isReadyForLive: false,
  };

  private activePositions: Map<string, LpPosition> = new Map();
  private closedPositions: LpPosition[] = [];

  private rhClient = createPublicClient({
    chain: robinhoodChain,
    transport: http("https://rpc.mainnet.chain.robinhood.com"),
  });

  public constructor() {
    this.initWalletConfig();
    this.loadFromStorage();
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
        this.config.walletAddress = account.address;
        this.config.hasRhKey = true;
        this.cachedWalletStatus = {
          hasWallet: true,
          walletAddress: account.address,
          ethBalance: "0.0000",
          usdgBalance: "0.00",
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
      this.cachedWalletStatus = {
        hasWallet: false,
        isReadyForLive: false,
      };
    }
  }

  public async refreshWalletBalances(): Promise<LpWalletStatus> {
    if (!this.config.walletAddress || !this.config.hasRhKey) {
      this.cachedWalletStatus = {
        hasWallet: false,
        isReadyForLive: false,
        lastCheckedAt: new Date().toISOString(),
      };
      return this.cachedWalletStatus;
    }

    const addr = this.config.walletAddress as `0x${string}`;
    try {
      const ethBalRaw = await this.rhClient.getBalance({ address: addr });
      const ethFormatted = Number(formatEther(ethBalRaw)).toFixed(4);

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

    this.config.walletAddress = undefined;
    this.config.hasRhKey = false;
    // For safety, force dryRun to true when wallet is unbound
    this.config.dryRun = true;
    this.saveToStorage();

    this.cachedWalletStatus = {
      hasWallet: false,
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
        this.config = { ...this.config, ...saved };
      }

      if (fs.existsSync(LP_POSITIONS_FILE)) {
        const raw = fs.readFileSync(LP_POSITIONS_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.active)) {
          for (const pos of data.active) {
            if (pos.dryRun === undefined) {
              pos.dryRun = true;
            }
            this.activePositions.set(pos.id, pos);
          }
        }
        if (Array.isArray(data.closed)) {
          this.closedPositions = data.closed.map((pos: LpPosition) => ({
            ...pos,
            dryRun: pos.dryRun === undefined ? true : pos.dryRun,
          })).slice(0, 100);
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
    // Inspect every 30 seconds
    this.monitorTimer = setInterval(() => {
      this.inspectPositions().catch((err) => {
        console.warn("[LpService] 做市仓位巡检异常:", err?.message || err);
      });
    }, 30_000);
    this.monitorTimer.unref();

    console.log(
      `🌊 [LpService] V3 非对称 LP 做市引擎已启动 (模式: ${this.config.dryRun ? "🛡️ 模拟做市 (Dry-Run)" : "🚀 真实链上 (Live)"}, 自动做市: ${this.config.autoLpEnabled ? "开启" : "暂停"})`,
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
    if (!rwaMatch.isRwa && volToLiqRatio < this.config.minVolumeToLiquidityRatio) {
      // Does not meet high-frequency friction criteria
      return null;
    }

    // Determine stage
    const priceChange5m = poolInfo?.priceChangeM5 || 0;
    let stage: LpStage = "SIDEWAYS";
    if (rwaMatch.isRwa) {
      stage = "RWA_STABLE";
    } else if (priceChange5m > 10 || volToLiqRatio >= 2.0) {
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
  }): Promise<LpPosition> {
    const rwaMatch = extractRwaStock(params.symbol);
    const isRwa = params.isRwa ?? rwaMatch.isRwa;
    const stockSymbol = params.stockSymbol || rwaMatch.stockSymbol;
    const category = params.category || (isRwa ? "RWA" : "MEME");
    const stage = params.stage || (isRwa ? "RWA_STABLE" : "SIDEWAYS");
    const isDryRun = params.dryRun !== undefined ? params.dryRun : this.config.dryRun;

    const capitalInvested =
      params.customCapitalUsd ||
      (isRwa ? this.config.rwaCapitalUsd : this.config.capitalPerPoolUsd);

    const feeTier = params.feeTier || this.config.preferredFeeTier;
    const tickSpacing = feeTier >= 20000 ? 500 : 200;
    const ranges = this.calculateRanges(params.priceUsd, stage, capitalInvested, tickSpacing);

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
    const txId = `tx-${Date.now()}-open`;

    const txRecord: LpTxRecord = {
      id: txId,
      type: "MINT_LP",
      timestamp: new Date().toISOString(),
      details: `创建 V4 集中做市头寸 (${stage}${isRwa ? " · 美股RWA" : ""}): 资金 $${capitalInvested.toFixed(2)} USDG, 乘数: ${capitalEfficiency.toFixed(1)}x`,
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

        // 3. Risk & Circuit Breaker Exit Conditions
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
      | "CLOSED_MANUAL",
    reason: string,
  ): Promise<LpPosition | null> {
    const pos = this.activePositions.get(positionId);
    if (!pos) return null;

    pos.status = status;
    pos.exitReason = reason;
    pos.closeTime = new Date().toISOString();

    const exitTx: LpTxRecord = {
      id: `tx-${Date.now()}-exit`,
      type: "EXIT_FLASH",
      timestamp: pos.closeTime,
      details: `撤回流动性并一键兑回 USDG: ${reason} (最终实现手续费: $${pos.feeEarnedUsd.toFixed(2)}, IL: -$${pos.impermanentLossUsd.toFixed(2)})`,
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
          headers: { "User-Agent": "Mozilla/5.0 (compatible; MemeScout/1.0)" },
          signal: AbortSignal.timeout(6000),
        },
      );
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as any;
        const pairs = Array.isArray(j.pairs) ? j.pairs : [];
        if (pairs.length > 0) {
          const p = pairs[0];
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
