import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
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
} from "./types";
import {
  sendLarkLpOpenAlert,
  sendLarkLpCollectAlert,
  sendLarkComprehensiveLpReport,
  DEFAULT_LARK_WEBHOOK_URL,
} from "./lark";
import { fetchTokenPoolInfo } from "./dexscreener";

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

    withdrawPrincipalFeeRatio: 0.35,
    volumeDropExitThresholdPct: 50,
    stopLossPriceDropPct: -25,
    maxHoldMinutes: 720,

    larkNotification: true,
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
    walletAddress: undefined,
    hasRhKey: false,
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
    const pk = process.env.RH_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
    if (pk) {
      try {
        const formattedKey = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`);
        const account = privateKeyToAccount(formattedKey);
        this.config.walletAddress = account.address;
        this.config.hasRhKey = true;
        console.log(`[LpService] 🔑 做市钱包初始化成功: ${account.address}`);
      } catch (err) {
        console.warn("[LpService] 钱包私钥解析失败:", err);
      }
    }
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
            this.activePositions.set(pos.id, pos);
          }
        }
        if (Array.isArray(data.closed)) {
          this.closedPositions = data.closed.slice(0, 100);
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

  public getState(): LpState {
    const active = Array.from(this.activePositions.values()).sort(
      (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime(),
    );

    let totalFeeEarnedUsd = 0;
    let totalRealizedPnlUsd = 0;
    let winCount = 0;
    let lossCount = 0;

    for (const pos of this.closedPositions) {
      totalFeeEarnedUsd += pos.feeEarnedUsd || 0;
      totalRealizedPnlUsd += pos.netPnlUsd || 0;
      if ((pos.netPnlUsd || 0) >= 0) {
        winCount++;
      } else {
        lossCount++;
      }
    }

    // Add unharvested fee from active positions
    for (const pos of active) {
      totalFeeEarnedUsd += pos.feeEarnedUsd || 0;
    }

    const totalClosed = winCount + lossCount;
    const winRatePct = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;

    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      walletAddress: this.config.walletAddress,
      activePositions: active,
      closedPositions: this.closedPositions,
      totalFeeEarnedUsd,
      totalRealizedPnlUsd,
      winCount,
      lossCount,
      winRatePct,
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
    return Math.round(tick / spacing) * spacing;
  }

  public static tickToPrice(tick: number): number {
    return Math.pow(1.0001, tick);
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

    // Score filter
    if (params.score < this.config.minScoreThreshold) {
      return null;
    }

    // Fetch pair info & check Volume/Liquidity ratio
    const poolInfo = await fetchTokenPoolInfo(params.chain, params.tokenAddress);
    const liquidity = poolInfo?.liquidityUsd || params.liquidityUsd || 0;
    const volume5m = poolInfo?.volume5m || params.volume5m || (poolInfo?.volumeH1 ? poolInfo.volumeH1 / 12 : 0);
    const currentPrice = poolInfo?.priceUsd || params.priceUsd || 0;

    if (currentPrice <= 0 || liquidity <= 0) {
      return null;
    }

    const volToLiqRatio = volume5m / liquidity;
    if (volToLiqRatio < this.config.minVolumeToLiquidityRatio) {
      // Does not meet high-frequency friction criteria
      return null;
    }

    // Determine stage
    const priceChange5m = poolInfo?.priceChangeM5 || 0;
    const stage: LpStage = priceChange5m > 10 || volToLiqRatio >= 2.0 ? "PUMP" : "SIDEWAYS";

    return this.openLpPosition({
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name || poolInfo?.name,
      chain: params.chain,
      pairAddress: poolInfo?.pairAddress || params.pairAddress,
      priceUsd: currentPrice,
      liquidityUsd: liquidity,
      volume5m,
      stage,
    });
  }

  public async openLpPosition(params: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain: string;
    pairAddress?: string;
    priceUsd: number;
    liquidityUsd: number;
    volume5m: number;
    stage: LpStage;
    customCapitalUsd?: number;
  }): Promise<LpPosition> {
    const capitalInvested = params.customCapitalUsd || this.config.capitalPerPoolUsd;
    const tickSpacing = 200; // 1% pool spacing
    const ranges = this.calculateRanges(params.priceUsd, params.stage, capitalInvested, tickSpacing);

    const positionId = `lp-${Date.now()}-${params.symbol.toLowerCase()}`;
    const txId = `tx-${Date.now()}-open`;

    const txRecord: LpTxRecord = {
      id: txId,
      type: "MINT_LP",
      timestamp: new Date().toISOString(),
      details: `创建 V3 非对称 LP 头寸 (${params.stage === "PUMP" ? "拉升期偏上方" : "横盘期Spot"}) 资金: $${capitalInvested.toFixed(2)} USDG`,
      amountUsd: capitalInvested,
      dryRun: this.config.dryRun,
      status: "CONFIRMED",
    };

    const position: LpPosition = {
      id: positionId,
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name,
      chain: params.chain,
      pairAddress: params.pairAddress,
      feeTier: this.config.preferredFeeTier,
      stage: params.stage,
      entryTime: new Date().toISOString(),
      entryPriceUsd: params.priceUsd,
      initialUsdInvested: capitalInvested,
      currentPriceUsd: params.priceUsd,
      volume5mAtEntry: params.volume5m,
      liquidityAtEntry: params.liquidityUsd,
      latestVolume5m: params.volume5m,
      volumeDropPct: 0,
      ranges,
      feeEarnedUsd: 0,
      principalWithdrawnUsd: 0,
      impermanentLossUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      status: "ACTIVE",
      txHistory: [txRecord],
    };

    this.activePositions.set(positionId, position);
    this.saveToStorage();

    console.log(
      `🌊 [LpService] 成功建立 ${params.stage} 做市头寸: $${params.symbol} ($${capitalInvested.toFixed(2)} USDG), 5m量能: $${params.volume5m.toLocaleString()}, 深度: $${params.liquidityUsd.toLocaleString()}`,
    );

    if (this.config.larkNotification) {
      sendLarkLpOpenAlert({
        position,
        dryRun: this.config.dryRun,
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
        const poolInfo = await fetchTokenPoolInfo(pos.chain, pos.tokenAddress);
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

        // Simulate Fee Accrual (time step ~30 seconds)
        // Fee = Volume_slice * feeTier * (activeCapital / ActiveLiquidity) * concentrationMultiplier
        if (activeCapitalAllocated > 0) {
          const sliceVolume = liveVol5m / 10; // ~30s slice of 5m volume
          const poolLiq = Math.max(1000, pos.liquidityAtEntry);
          const feeTierRate = pos.feeTier / 1_000_000; // 0.01 for 1%
          const capitalMultiplier = 15; // V3 concentrated capital efficiency multiplier
          const incrementalFee = sliceVolume * feeTierRate * (activeCapitalAllocated / poolLiq) * capitalMultiplier;
          pos.feeEarnedUsd += Math.max(0, incrementalFee);
        }

        // Calculate Impermanent Loss
        // When price drops relative to entry:
        const priceRatio = livePrice / Math.max(0.0000001, pos.entryPriceUsd);
        if (priceRatio < 1.0) {
          // Downside IL: concentrated downside exposure
          const dropRatio = 1 - priceRatio;
          pos.impermanentLossUsd = pos.initialUsdInvested * Math.min(1, dropRatio * 1.2);
        } else {
          // Upside: price surged above range, tokens sold to USDG
          const pumpRatio = priceRatio - 1;
          pos.impermanentLossUsd = pos.initialUsdInvested * Math.min(0.3, pumpRatio * 0.1);
        }

        // Calculate Net PnL
        pos.netPnlUsd = pos.feeEarnedUsd - pos.impermanentLossUsd;
        pos.netPnlPct = (pos.netPnlUsd / pos.initialUsdInvested) * 100;

        // 1. Check Principal Recovery Condition (保本提润)
        const principalTarget = pos.initialUsdInvested * this.config.withdrawPrincipalFeeRatio;
        if (
          pos.feeEarnedUsd >= principalTarget &&
          pos.status === "ACTIVE" &&
          pos.principalWithdrawnUsd === 0
        ) {
          const withdrawAmount = pos.initialUsdInvested * 0.5; // Withdraw 50% initial capital
          pos.principalWithdrawnUsd += withdrawAmount;
          pos.status = "PRINCIPAL_SECURED";

          pos.txHistory.push({
            id: `tx-${Date.now()}-withdraw`,
            type: "WITHDRAW_PRINCIPAL",
            timestamp: new Date().toISOString(),
            details: `手续费收入已达 $${pos.feeEarnedUsd.toFixed(2)}，成功提回本金 $${withdrawAmount.toFixed(2)} USDG，头寸进入零风险收租状态`,
            amountUsd: withdrawAmount,
            dryRun: this.config.dryRun,
            status: "CONFIRMED",
          });

          console.log(
            `💰 [LpService] $${pos.symbol} 触发保本提润: 已提回 $${withdrawAmount.toFixed(2)} USDG`,
          );

          if (this.config.larkNotification) {
            sendLarkLpCollectAlert({
              position: pos,
              harvestedFeeUsd: withdrawAmount,
              dryRun: this.config.dryRun,
              webhookUrl: this.config.webhookUrl,
            }).catch((err) => console.warn("[LpService] Lark 提润告警失败:", err));
          }
        }

        // 2. Check Emergency Flash Exit Conditions
        // A. Volume Crash (>50% drop)
        const isVolumeCrashed = pos.volumeDropPct >= this.config.volumeDropExitThresholdPct;

        // B. Price fell below the lowest buffer range
        const lowestRange = pos.ranges.reduce((min, r) => Math.min(min, r.minPriceUsd), Infinity);
        const isPriceBreakoutDown = livePrice < lowestRange;

        // C. Hold Timeout
        const entryMs = new Date(pos.entryTime).getTime();
        const holdMinutes = (nowMs - entryMs) / 60000;
        const isTimeout = holdMinutes >= this.config.maxHoldMinutes;

        if (isVolumeCrashed) {
          await this.closePosition(pos.id, "CLOSED_VOL_DROP", "5分钟交易量断崖下跌 >50% (流动摩擦枯竭)");
        } else if (isPriceBreakoutDown) {
          await this.closePosition(pos.id, "CLOSED_STOPLOSS", "价格击穿最下沿防护区间 (触发紧急熔断 Flash Exit)");
        } else if (isTimeout) {
          await this.closePosition(pos.id, "CLOSED_TIMEOUT", `持仓时间已达 ${this.config.maxHoldMinutes} 分钟上限`);
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
      dryRun: this.config.dryRun,
      status: "CONFIRMED",
    };
    pos.txHistory.push(exitTx);

    // Archive
    this.activePositions.delete(positionId);
    this.closedPositions.unshift(pos);
    this.saveToStorage();

    console.log(
      `🏁 [LpService] 结项归档: $${pos.symbol}, 净盈亏: $${pos.netPnlUsd.toFixed(2)} (${pos.netPnlPct.toFixed(1)}%), 原因: ${reason}`,
    );

    if (this.config.larkNotification) {
      const state = this.getState();
      sendLarkComprehensiveLpReport({
        closedPosition: pos,
        allClosedPositions: this.closedPositions,
        activeCount: this.activePositions.size,
        totalRealizedPnlUsd: state.totalRealizedPnlUsd,
        totalFeeEarnedUsd: state.totalFeeEarnedUsd,
        winCount: state.winCount,
        lossCount: state.lossCount,
        winRatePct: state.winRatePct,
        dryRun: this.config.dryRun,
        webhookUrl: this.config.webhookUrl,
      }).catch((err) => console.warn("[LpService] 发送全量结项战报失败:", err));
    }

    return pos;
  }

  public async closeAllPositions(): Promise<number> {
    const ids = Array.from(this.activePositions.keys());
    for (const id of ids) {
      await this.closePosition(id, "CLOSED_MANUAL", "管理员一键撤池清仓");
    }
    return ids.length;
  }
}

export const lpService = LpService.getInstance();
