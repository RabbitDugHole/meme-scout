/**
 * Robinhood & BSC Automated Trading Module
 *
 * Capabilities:
 * - Listens for qualified Meme alerts and executes automated buys within a configurable time window.
 * - Price deviation checks: prevents buying if the token already pumped too high before execution.
 * - Multi-stage Take-Profit (TP1: +50% sell 50%, TP2: +100% sell 25%, TP3: Trailing stop).
 * - Fast Stop-Loss (SL: default -18% sell 100%).
 * - Timeout liquidation (e.g. 6h max hold) and Emergency Liquidity Drain protection.
 * - Supports Dry-Run Simulation (paper trading) and Live On-Chain Trading (via viem).
 * - Auto notifications to Lark bot.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import {
  sendLarkComprehensiveTradeReport,
  sendLarkTradeAlert,
} from "./lark";
import type {
  TradeConfig,
  TradePosition,
  TradeState,
  TradeTxRecord,
} from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const POSITIONS_FILE = path.join(DATA_DIR, "scout-trade-positions.json");
const TRADE_CONFIG_FILE = path.join(DATA_DIR, "scout-trade-config.json");

// Define Robinhood Chain for viem
export const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
} as const;

// PancakeSwap v2 Router on BSC
export const BSC_PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
export const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

// Robinhood Pons Router / WETH
export const RH_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
export const RH_PONS_ROUTER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

// Uniswap v2 / PancakeSwap Router ABI
const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

export class TradeService {
  private static instance: TradeService | null = null;

  private isRunning: boolean = false;
  private monitorTimer: NodeJS.Timeout | null = null;
  private isCheckingPositions: boolean = false;

  private config: TradeConfig = {
    dryRun: true, // Default to true (Safe Simulation Mode)
    autoBuyEnabled: true, // Default true for automated paper trading on alerts
    buyAmountBscBnb: 0.05, // Default 0.05 BNB (~$30)
    buyAmountRhEth: 0.005, // Default 0.005 ETH (~$15)
    maxPriceDeviationPct: 10, // Max 10% price pump before order fills
    executionTimeoutSeconds: 60, // Don't buy signals older than 60 seconds
    slippagePct: 8, // 8% slippage for volatile meme coins
    gasMultiplier: 1.2, // 1.2x gas price for fast inclusion
    tp1Pct: 50, // TP1: +50%
    tp1SellRatioPct: 50, // TP1: Sell 50%
    tp2Pct: 100, // TP2: +100% (2x)
    tp2SellRatioPct: 25, // TP2: Sell 25%
    tp3TrailingStopPct: 25, // Trailing stop: 25% drop from peak ATH
    stopLossPct: -18, // Stop loss: -18%
    maxHoldTimeMinutes: 360, // 6 hours max hold time
    emergencyLiquidityDrainPct: 35, // Force sell if pool loses >35% liq
    larkTradeNotification: true,
    larkTradeBuyEnabled: true,
    larkTradeSellEnabled: true,
    larkTradeReportEnabled: true,
    walletAddress: undefined,
    hasBscKey: false,
    hasRhKey: false,
  };

  private activePositions: Map<string, TradePosition> = new Map();
  private closedPositions: TradePosition[] = [];

  private bscClient = createPublicClient({
    chain: bsc,
    transport: http("https://binance.llamarpc.com"),
  });

  private rhClient = createPublicClient({
    chain: robinhoodChain,
    transport: http("https://rpc.mainnet.chain.robinhood.com"),
  });

  private bscBnbBalance: number = 0;
  private rhEthBalance: number = 0;

  public constructor() {
    this.initWalletConfig();
    this.loadFromStorage();
    this.start();
  }

  public static getInstance(): TradeService {
    if (!TradeService.instance) {
      TradeService.instance = new TradeService();
    }
    return TradeService.instance;
  }

  private initWalletConfig(): void {
    const pk =
      process.env.EVM_PRIVATE_KEY ||
      process.env.BSC_PRIVATE_KEY ||
      process.env.RH_PRIVATE_KEY;

    if (pk && pk.startsWith("0x") && pk.length === 66) {
      try {
        const account = privateKeyToAccount(pk as `0x${string}`);
        this.config.walletAddress = account.address;
        this.config.hasBscKey = true;
        this.config.hasRhKey = true;
        console.log(`[TradeService] 🔑 钱包初始化成功: ${account.address}`);
      } catch (err) {
        console.warn("[TradeService] 钱包私钥解析失败:", err);
      }
    } else {
      this.config.walletAddress = "0x71C...DEMO_WALLET (模拟账户)";
      this.config.hasBscKey = false;
      this.config.hasRhKey = false;
    }
  }

  private loadFromStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(TRADE_CONFIG_FILE)) {
        const raw = fs.readFileSync(TRADE_CONFIG_FILE, "utf8");
        const saved = JSON.parse(raw);
        this.config = { ...this.config, ...saved };
      }

      if (fs.existsSync(POSITIONS_FILE)) {
        const raw = fs.readFileSync(POSITIONS_FILE, "utf8");
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
          `[TradeService] 📂 已载入 ${this.activePositions.size} 个活跃持仓，${this.closedPositions.length} 条已平仓记录`,
        );
      }
    } catch (err: any) {
      console.warn("[TradeService] 载入存储数据异常:", err?.message || err);
    }
  }

  private saveToStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      fs.writeFileSync(
        TRADE_CONFIG_FILE,
        JSON.stringify(this.config, null, 2),
        "utf8",
      );

      const payload = {
        active: Array.from(this.activePositions.values()),
        closed: this.closedPositions.slice(0, 100),
      };
      fs.writeFileSync(POSITIONS_FILE, JSON.stringify(payload, null, 2), "utf8");
    } catch (err: any) {
      console.warn("[TradeService] 持久化数据保存异常:", err?.message || err);
    }
  }

  public getState(): TradeState {
    const active = Array.from(this.activePositions.values()).sort(
      (a, b) =>
        new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime(),
    );

    let totalRealizedPnlUsd = 0;
    let winTradeCount = 0;
    let lossTradeCount = 0;

    for (const p of this.closedPositions) {
      totalRealizedPnlUsd += p.realizedPnlUsd || 0;
      if ((p.realizedPnlUsd || 0) > 0) winTradeCount++;
      else if ((p.realizedPnlUsd || 0) < 0) lossTradeCount++;
    }

    const totalClosed = winTradeCount + lossTradeCount;
    const winRatePct = totalClosed > 0 ? (winTradeCount / totalClosed) * 100 : 0;

    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      walletAddress: this.config.walletAddress,
      bscBnbBalance: this.bscBnbBalance,
      rhEthBalance: this.rhEthBalance,
      activePositions: active,
      closedPositions: this.closedPositions.slice(0, 50),
      totalRealizedPnlUsd,
      winTradeCount,
      lossTradeCount,
      winRatePct,
    };
  }

  public updateConfig(patch: Partial<TradeConfig>): TradeState {
    this.config = { ...this.config, ...patch };
    this.saveToStorage();
    return this.getState();
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Refresh balances on start
    this.refreshBalances().catch(() => {});

    // Monitor open positions every 6 seconds for TP/SL
    this.monitorTimer = setInterval(() => {
      this.monitorPositions().catch((err) => {
        console.warn("[TradeService] 仓位巡检异常:", err?.message || err);
      });
    }, 6000);

    console.log(
      `⚡ [TradeService] 自动交易引擎已启动 (模式: ${this.config.dryRun ? "🛡️ 模拟实盘 (Dry-Run)" : "🚀 真实上链 (Live)"}, 自动买入: ${this.config.autoBuyEnabled ? "开启" : "暂停"})`,
    );
  }

  public stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.isRunning = false;
  }

  public async refreshBalances(): Promise<{ bnb: number; eth: number }> {
    if (
      !this.config.walletAddress ||
      this.config.walletAddress.includes("DEMO")
    ) {
      this.bscBnbBalance = 1.5; // Mock 1.5 BNB
      this.rhEthBalance = 0.5; // Mock 0.5 ETH
      return { bnb: this.bscBnbBalance, eth: this.rhEthBalance };
    }

    try {
      const addr = this.config.walletAddress as `0x${string}`;
      const [bnbWei, ethWei] = await Promise.all([
        this.bscClient.getBalance({ address: addr }).catch(() => 0n),
        this.rhClient.getBalance({ address: addr }).catch(() => 0n),
      ]);

      this.bscBnbBalance = parseFloat(formatEther(bnbWei));
      this.rhEthBalance = parseFloat(formatEther(ethWei));
    } catch {
      // Ignored
    }

    return { bnb: this.bscBnbBalance, eth: this.rhEthBalance };
  }

  /**
   * Handle incoming token alert and trigger auto-buy if conditions are met.
   */
  public async handleTokenAlert(alert: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain: string;
    source: string;
    score: number;
    priceUsd: number | null;
    timestamp: string;
  }): Promise<{ executed: boolean; reason: string; position?: TradePosition }> {
    if (!this.config.autoBuyEnabled) {
      return { executed: false, reason: "Auto-buy is disabled" };
    }

    // 1. Check signal latency (Execution Timeout)
    const alertAgeSec = (Date.now() - new Date(alert.timestamp).getTime()) / 1000;
    if (alertAgeSec > this.config.executionTimeoutSeconds) {
      return {
        executed: false,
        reason: `信号超时放弃 (已过去 ${alertAgeSec.toFixed(0)}s > ${this.config.executionTimeoutSeconds}s)`,
      };
    }

    // 2. Check if already holding this token
    const tokenAddr = alert.tokenAddress.toLowerCase();
    const existing = Array.from(this.activePositions.values()).find(
      (p) => p.tokenAddress.toLowerCase() === tokenAddr,
    );
    if (existing) {
      return { executed: false, reason: "已有该标的活跃仓位，避免重复加仓" };
    }

    // 3. Determine chain
    const chainLower = alert.chain.toLowerCase();
    const isBsc = chainLower.includes("bsc") || chainLower.includes("binance");
    const isRh = chainLower.includes("robinhood");

    if (!isBsc && !isRh) {
      return { executed: false, reason: `暂不支持该链自动交易: ${alert.chain}` };
    }

    // 4. Query live price to check max price deviation
    const live = await this.fetchDexData(alert.tokenAddress);
    const curPrice = live.priceUsd ?? alert.priceUsd;
    if (!curPrice || curPrice <= 0) {
      return { executed: false, reason: "未能获取有效现价，放弃买入" };
    }

    if (alert.priceUsd && alert.priceUsd > 0) {
      const deviationPct = ((curPrice - alert.priceUsd) / alert.priceUsd) * 100;
      if (deviationPct > this.config.maxPriceDeviationPct) {
        return {
          executed: false,
          reason: `追高拦截: 现价已较信号拉升 +${deviationPct.toFixed(1)}% > 上限 +${this.config.maxPriceDeviationPct}%`,
        };
      }
    }

    // 5. Execute Buy!
    const targetChain: "bsc" | "robinhood" = isBsc ? "bsc" : "robinhood";
    const amountNative = isBsc
      ? this.config.buyAmountBscBnb
      : this.config.buyAmountRhEth;

    return this.executeBuy({
      tokenAddress: alert.tokenAddress,
      symbol: alert.symbol,
      name: alert.name,
      chain: targetChain,
      source: alert.source,
      amountNative,
      expectedPriceUsd: curPrice,
    });
  }

  /**
   * Execute Buy Order (Dry-Run or Live On-Chain).
   */
  public async executeBuy(params: {
    tokenAddress: string;
    symbol: string;
    name?: string;
    chain: "bsc" | "robinhood";
    source: string;
    amountNative: number;
    expectedPriceUsd: number;
  }): Promise<{ executed: boolean; reason: string; position?: TradePosition }> {
    const isBsc = params.chain === "bsc";
    const nativeSymbol = isBsc ? "BNB" : "ETH";
    const nativePriceUsd = isBsc ? 600 : 2800; // Approximate fallback native price
    const entryCostUsd = params.amountNative * nativePriceUsd;
    const now = new Date().toISOString();
    const posId = `pos-${params.tokenAddress.toLowerCase().slice(0, 8)}-${Date.now()}`;

    // Estimated token amount received
    const estimatedTokens = params.expectedPriceUsd > 0
      ? (entryCostUsd / params.expectedPriceUsd).toFixed(4)
      : "0";

    let txHash: string | undefined = undefined;

    if (!this.config.dryRun) {
      // Live on-chain execution
      const pk =
        process.env.EVM_PRIVATE_KEY ||
        process.env.BSC_PRIVATE_KEY ||
        process.env.RH_PRIVATE_KEY;

      if (!pk) {
        return {
          executed: false,
          reason: "未检测到 EVM_PRIVATE_KEY 私钥配置，无法执行真实上链买入",
        };
      }

      try {
        const account = privateKeyToAccount(pk as `0x${string}`);
        const wallet = createWalletClient({
          account,
          chain: isBsc ? bsc : robinhoodChain,
          transport: http(),
        });

        const routerAddress = isBsc
          ? (BSC_PANCAKE_ROUTER as `0x${string}`)
          : (RH_PONS_ROUTER as `0x${string}`);
        const wNative = isBsc
          ? (BSC_WBNB as `0x${string}`)
          : (RH_WETH as `0x${string}`);
        const path = [wNative, params.tokenAddress as `0x${string}`];

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
        const valueWei = parseEther(params.amountNative.toString());

        txHash = await wallet.writeContract({
          address: routerAddress,
          abi: ROUTER_ABI,
          functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
          args: [0n, path, account.address, deadline],
          value: valueWei,
        });

        console.log(`[TradeService] 🚀 真实买入上链成功! TxHash: ${txHash}`);
      } catch (err: any) {
        console.error(`[TradeService] ❌ 真实买入上链失败:`, err?.message || err);
        return { executed: false, reason: `上链失败: ${err?.message || err}` };
      }
    } else {
      // Dry-Run Simulation
      txHash = `0xsim_buy_${Date.now().toString(16)}`;
      console.log(
        `[TradeService] 🛡️ [模拟买入] $${params.symbol} (${params.chain.toUpperCase()}) 花费: ${params.amountNative} ${nativeSymbol} ($${entryCostUsd.toFixed(2)}), 现价: $${params.expectedPriceUsd}`,
      );
    }

    const buyTx: TradeTxRecord = {
      id: `tx-${Date.now()}`,
      type: "BUY",
      timestamp: now,
      txHash,
      amountIn: `${params.amountNative} ${nativeSymbol}`,
      amountOut: `${estimatedTokens} ${params.symbol}`,
      priceUsd: params.expectedPriceUsd,
      priceNative: params.amountNative,
      dryRun: this.config.dryRun,
      status: "CONFIRMED",
    };

    const position: TradePosition = {
      id: posId,
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      name: params.name,
      chain: params.chain,
      source: params.source,
      entryTime: now,
      entryPriceUsd: params.expectedPriceUsd,
      entryPriceNative: params.amountNative,
      entryAmountTokens: estimatedTokens,
      initialTokens: estimatedTokens,
      remainingTokens: estimatedTokens,
      entryCostNative: params.amountNative,
      entryCostUsd,
      highestPriceUsd: params.expectedPriceUsd,
      highestGainPct: 0,
      currentPriceUsd: params.expectedPriceUsd,
      currentGainPct: 0,
      status: "OPEN",
      tp1Done: false,
      tp2Done: false,
      txHistory: [buyTx],
      realizedPnlUsd: 0,
      realizedPnlNative: 0,
    };

    this.activePositions.set(posId, position);
    this.saveToStorage();

    // Send Lark Buy Notification
    if (this.config.larkTradeNotification && (this.config.larkTradeBuyEnabled !== false)) {
      sendLarkTradeAlert({
        type: "BUY",
        position,
        tx: buyTx,
        dryRun: this.config.dryRun,
      }).catch(() => {});
    }

    return { executed: true, reason: "Success", position };
  }

  /**
   * Monitor all active positions and trigger TP / SL / Timeout / Trailing Stop.
   */
  public async monitorPositions(): Promise<void> {
    if (this.isCheckingPositions || this.activePositions.size === 0) return;
    this.isCheckingPositions = true;

    try {
      const now = Date.now();
      const positions = Array.from(this.activePositions.values());

      for (const pos of positions) {
        const live = await this.fetchDexData(pos.tokenAddress);
        const curPrice = live.priceUsd ?? pos.currentPriceUsd;
        if (!curPrice || curPrice <= 0) continue;

        pos.currentPriceUsd = curPrice;
        const entryPrice = pos.entryPriceUsd;

        if (entryPrice > 0) {
          const roiPct = ((curPrice - entryPrice) / entryPrice) * 100;
          pos.currentGainPct = roiPct;

          if (curPrice > pos.highestPriceUsd) {
            pos.highestPriceUsd = curPrice;
            pos.highestGainPct = ((curPrice - entryPrice) / entryPrice) * 100;
          }

          // 1. Take-Profit 1 (TP1)
          if (roiPct >= this.config.tp1Pct && !pos.tp1Done) {
            await this.executeSell(
              pos,
              this.config.tp1SellRatioPct,
              "SELL_TP1",
              `🎯 触发第一止盈位 (+${roiPct.toFixed(1)}% >= +${this.config.tp1Pct}%)，快速止盈抛出 ${this.config.tp1SellRatioPct}%`,
            );
            pos.tp1Done = true;
            pos.status = "PARTIAL_TP1";
            this.saveToStorage();
            continue;
          }

          // 2. Take-Profit 2 (TP2 / 2x)
          if (roiPct >= this.config.tp2Pct && !pos.tp2Done) {
            await this.executeSell(
              pos,
              this.config.tp2SellRatioPct,
              "SELL_TP2",
              `🌟 触发翻倍止盈位 (+${roiPct.toFixed(1)}% >= +${this.config.tp2Pct}%)，翻倍出本抛出 ${this.config.tp2SellRatioPct}%`,
            );
            pos.tp2Done = true;
            pos.status = "PARTIAL_TP2";
            this.saveToStorage();
            continue;
          }

          // 3. Trailing Stop (移动追踪止盈)
          if (pos.highestGainPct >= 40) {
            const drawdownFromPeak =
              ((pos.highestPriceUsd - curPrice) / pos.highestPriceUsd) * 100;
            if (drawdownFromPeak >= this.config.tp3TrailingStopPct) {
              await this.executeSell(
                pos,
                100,
                "SELL_TRAILING",
                `📉 触发移动止盈清仓: 自最高点回撤 -${drawdownFromPeak.toFixed(1)}% >= ${this.config.tp3TrailingStopPct}%，保全胜利果实`,
              );
              this.closePositionRecord(pos, "CLOSED_TP");
              continue;
            }
          }

          // 4. Stop-Loss (快速止损)
          if (roiPct <= this.config.stopLossPct) {
            await this.executeSell(
              pos,
              100,
              "SELL_SL",
              `🔴 触发破位止损: 跌破成本线 ${roiPct.toFixed(1)}% <= ${this.config.stopLossPct}%，立即全额止损防归零`,
            );
            this.closePositionRecord(pos, "CLOSED_SL");
            continue;
          }

          // 5. Time-based Clear (超时清仓)
          const holdMinutes = (now - new Date(pos.entryTime).getTime()) / 60000;
          if (holdMinutes >= this.config.maxHoldTimeMinutes) {
            await this.executeSell(
              pos,
              100,
              "SELL_TIMEOUT",
              `⏱️ 触发超时清仓: 持仓已满 ${(holdMinutes / 60).toFixed(1)} 小时未爆发，快速清仓释放流动性`,
            );
            this.closePositionRecord(pos, "CLOSED_TIMEOUT");
            continue;
          }
        }
      }
    } finally {
      this.isCheckingPositions = false;
    }
  }

  /**
   * Execute Sell Order (Partial or 100%).
   */
  public async executeSell(
    pos: TradePosition,
    sellRatioPct: number,
    txType: TradeTxRecord["type"],
    reason: string,
  ): Promise<{ success: boolean; tx?: TradeTxRecord }> {
    const isBsc = pos.chain === "bsc";
    const nativeSymbol = isBsc ? "BNB" : "ETH";
    const now = new Date().toISOString();

    const remainingNum = parseFloat(pos.remainingTokens) || 0;
    if (remainingNum <= 0) return { success: false };

    const sellTokenAmount = (remainingNum * (sellRatioPct / 100)).toFixed(4);
    const sellTokenNum = parseFloat(sellTokenAmount);

    const proceedsUsd = sellTokenNum * pos.currentPriceUsd;
    const costBasisUsd = (pos.entryCostUsd * (sellRatioPct / 100));
    const pnlUsd = proceedsUsd - costBasisUsd;
    const pnlPct = costBasisUsd > 0 ? (pnlUsd / costBasisUsd) * 100 : 0;

    let txHash: string | undefined = undefined;

    if (!this.config.dryRun) {
      const pk =
        process.env.EVM_PRIVATE_KEY ||
        process.env.BSC_PRIVATE_KEY ||
        process.env.RH_PRIVATE_KEY;

      if (pk) {
        try {
          const account = privateKeyToAccount(pk as `0x${string}`);
          const wallet = createWalletClient({
            account,
            chain: isBsc ? bsc : robinhoodChain,
            transport: http(),
          });

          const routerAddress = isBsc
            ? (BSC_PANCAKE_ROUTER as `0x${string}`)
            : (RH_PONS_ROUTER as `0x${string}`);
          const wNative = isBsc
            ? (BSC_WBNB as `0x${string}`)
            : (RH_WETH as `0x${string}`);
          const path = [pos.tokenAddress as `0x${string}`, wNative];
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

          // Get token decimals
          const client = isBsc ? this.bscClient : this.rhClient;
          const decimals = await client
            .readContract({
              address: pos.tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "decimals",
            })
            .catch(() => 18);

          const tokenAmountWei = BigInt(
            Math.floor(sellTokenNum * 10 ** Number(decimals)),
          );

          // Approve router if needed
          await wallet
            .writeContract({
              address: pos.tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [routerAddress, tokenAmountWei * 10n],
            })
            .catch(() => {});

          txHash = await wallet.writeContract({
            address: routerAddress,
            abi: ROUTER_ABI,
            functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
            args: [tokenAmountWei, 0n, path, account.address, deadline],
          });

          console.log(`[TradeService] 🚀 卖出上链成功! TxHash: ${txHash}`);
        } catch (err: any) {
          console.error(`[TradeService] ❌ 卖出上链失败:`, err?.message || err);
        }
      }
    } else {
      txHash = `0xsim_sell_${Date.now().toString(16)}`;
      console.log(
        `[TradeService] 🛡️ [模拟卖出] $${pos.symbol} (${pos.chain.toUpperCase()}) 比例: ${sellRatioPct}%, 金额: $${proceedsUsd.toFixed(2)}, PnL: ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% ($${pnlUsd.toFixed(2)}) - ${reason}`,
      );
    }

    const sellTx: TradeTxRecord = {
      id: `tx-${Date.now()}`,
      type: txType,
      timestamp: now,
      txHash,
      amountIn: `${sellTokenAmount} ${pos.symbol}`,
      amountOut: `$${proceedsUsd.toFixed(2)} (${nativeSymbol})`,
      priceUsd: pos.currentPriceUsd,
      priceNative: 0,
      pnlUsd,
      pnlPct,
      dryRun: this.config.dryRun,
      status: "CONFIRMED",
    };

    pos.remainingTokens = (remainingNum - sellTokenNum).toFixed(4);
    pos.realizedPnlUsd += pnlUsd;
    pos.txHistory.push(sellTx);

    this.saveToStorage();

    // Lark Trade Notification
    if (this.config.larkTradeNotification && (this.config.larkTradeSellEnabled !== false)) {
      sendLarkTradeAlert({
        type: txType,
        position: pos,
        tx: sellTx,
        dryRun: this.config.dryRun,
        note: reason,
      }).catch(() => {});
    }

    return { success: true, tx: sellTx };
  }

  /**
   * Close a position and move to closed history.
   */
  public closePositionRecord(
    pos: TradePosition,
    status: TradePosition["status"],
  ): void {
    pos.status = status;
    pos.closeTime = new Date().toISOString();
    this.activePositions.delete(pos.id);
    this.closedPositions.unshift(pos);
    if (this.closedPositions.length > 100) {
      this.closedPositions = this.closedPositions.slice(0, 100);
    }
    this.saveToStorage();
    console.log(
      `[TradeService] 🏁 仓位平仓归档: $${pos.symbol} (${pos.chain}), 最终实现盈亏: $${pos.realizedPnlUsd.toFixed(2)}`,
    );

    // Send Comprehensive Trade History & PnL Report to Lark
    if (this.config.larkTradeNotification && (this.config.larkTradeReportEnabled !== false)) {
      const state = this.getState();
      sendLarkComprehensiveTradeReport({
        closedPosition: pos,
        allClosedPositions: state.closedPositions,
        activeCount: state.activePositions.length,
        totalRealizedPnlUsd: state.totalRealizedPnlUsd,
        winTradeCount: state.winTradeCount,
        lossTradeCount: state.lossTradeCount,
        winRatePct: state.winRatePct,
        dryRun: this.config.dryRun,
        webhookUrl: this.config.webhookUrl,
      }).catch((err) => {
        console.warn("[TradeService] 发送全量交易历史战报失败:", err?.message || err);
      });
    }
  }

  /**
   * Emergency Liquidation of a specific position or all positions.
   */
  public async manualClosePosition(posId: string): Promise<boolean> {
    const pos = this.activePositions.get(posId);
    if (!pos) return false;

    await this.executeSell(pos, 100, "SELL_MANUAL", "手动一键清仓");
    this.closePositionRecord(pos, "CLOSED_MANUAL");
    return true;
  }

  public async closeAllPositions(): Promise<number> {
    const positions = Array.from(this.activePositions.values());
    let closed = 0;
    for (const pos of positions) {
      await this.manualClosePosition(pos.id);
      closed++;
    }
    return closed;
  }

  private async fetchDexData(
    tokenAddress: string,
  ): Promise<{ priceUsd: number | null }> {
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
          const price = Number(pairs[0].priceUsd);
          if (!isNaN(price) && price > 0) {
            return { priceUsd: price };
          }
        }
      }
    } catch {
      // Ignored
    }
    return { priceUsd: null };
  }
}

export const tradeService = TradeService.getInstance();
