import type { MemeIndicators } from "./indicators";

export type Light = "PASS" | "FAIL" | "UNKNOWN";
export type Verdict = "ALERT" | "LATE" | "SKIP";
export type Tier = 1 | 2 | 3 | null;
export type Stage = "bonding" | "graduated" | "unknown";

export type HardKey =
  | "lp_gt_50k"
  | "holders_gt_100"
  | "top10_lt_60"
  | "lp_locked"
  | "smart_money_2plus";

export type SoftKey =
  | "unverified_or_mint"
  | "serial_deployer"
  | "late_layer";

export type Lights = Record<HardKey, Light>;
export type SoftLights = Record<SoftKey, Light>;

export type SmartBuyer = {
  address: string;
  usd: number;
  at: string;
};

export type StockPair = {
  symbol: string;
  name: string;
  contract: string;
} | null;

export type Candidate = {
  address: string;
  name: string;
  symbol: string;
  stage: Stage;
  ageMs: number | null;
  launchedAt: string | null;
  graduatedAt: string | null;
  deployer: string | null;
  pairToken: string | null;
  pairSymbol: string | null;
  stockPair: StockPair;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  holders: number | null;
  top10ExLp: number | null;
  lpLocked: boolean | null;
  lockReason: string | null;
  smartBuyers2h: SmartBuyer[];
  verified: boolean | null;
  mintOrPause: boolean | null;
  deployerLaunchCount: number | null;
  dexscreenerTrending: boolean;
  dexUrl: string | null;
  explorerUrl: string;
  ponsUrl: string;
  tweetUrl: string | null;
  tweetIsOriginal: boolean;
  narrative: string | null;
  quoteSymbol: string | null;
  volumeH1: number | null;
  priceChangeH1: number | null;
  lights: Lights;
  soft: SoftLights;
  verdict: Verdict;
  tier: Tier;
  hardPassed: number;
  reasons: string[];
  indicators?: MemeIndicators;
};

export type ScanMeta = {
  scannedAt: string;
  logPages: number;
  events: number;
  launched: number;
  graduated: number;
  hydrated: number;
  dexOk: boolean;
  error: string | null;
  nextScanHintMin: number;
};

export type ScanResult = {
  meta: ScanMeta;
  candidates: Candidate[];
  alerts: Candidate[];
  late: Candidate[];
  skipped: Candidate[];
};

export type InspectInput = { address: string };

export type NarrativeScore = {
  ok: boolean;
  scoreDelta: number;
  label: string;
  summary: string;
  pairing: string;
  error?: string;
};

export type PriceQuote = {
  address: string;
  priceUsd: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
};

export type StockAsset = {
  symbol: string;
  name: string;
  contract: string;
  logoUrl: string | null;
  status: string;
};

export type AlarmRecord = {
  id: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  score: number;
  tier: string;
  timestamp: string;
  larkOk: boolean;
  larkMsg?: string;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  liquidityUsd?: number | null;
  signals?: string[];
  risks?: string[];
};

export type MonitorConfig = {
  webhookUrl: string;
  minScoreThreshold: number;
  minLiquidityUsd: number;
  cooldownMinutes: number;
  intervalSeconds: number;
  autoAlarmEnabled: boolean;
};

export type MonitorState = {
  isRunning: boolean;
  config: MonitorConfig;
  lastScanTime: string | null;
  nextScanTime: string | null;
  alertedCount: number;
  history: AlarmRecord[];
};

export type TgChannelConfig = {
  username: string; // e.g. "lanniaohui"
  name?: string;     // e.g. "Bluebird 监控频道🕊️"
  enabled: boolean;
};

export type TgMessageParsed = {
  postId: string; // e.g. "lanniaohui/15468"
  channel: string;
  url: string;
  symbol: string;
  name?: string;
  chain: string; // e.g. "Robinhood Chain", "BSC", "Solana", etc.
  address: string;
  tgMcap?: string;
  tgInflow?: string;
  tgHolders?: number;
  tgDuration?: string;
  smartMoneyCount?: number;
  kolCount?: number;
  fomoCount?: number;
  tgSafety?: string;
  narrative?: string;
  tweetUrl?: string;
  timestamp: string;
  rawText: string;
};

export type TgTokenEvaluation = {
  token: TgMessageParsed;
  liveData: {
    priceUsd?: number | null;
    mcapUsd?: number | null;
    liquidityUsd?: number | null;
    volumeH1?: number | null;
    priceChangeH1?: number | null;
    buysH1?: number;
    sellsH1?: number;
    dexUrl?: string;
    pairAddress?: string;
    hasTwitter?: boolean;
    hasWebsite?: boolean;
  } | null;
  totalScore: number;
  potentialTier: string;
  signals: string[];
  risks: string[];
  passedFilter: boolean;
  filterReason?: string;
};

export type TgAlarmRecord = {
  id: string;
  postId: string;
  channel: string;
  channelUrl: string;
  tokenAddress: string;
  symbol: string;
  chain: string;
  score: number;
  tier: string;
  timestamp: string;
  larkOk: boolean;
  larkMsg?: string;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  liquidityUsd?: number | null;
  volumeH1?: number | null;
  priceChangeH1?: number | null;
  smartMoneyCount?: number;
  kolCount?: number;
  signals: string[];
  risks: string[];
  dexUrl?: string;
  tweetUrl?: string;
};

export type TgMonitorConfig = {
  channels: TgChannelConfig[];
  enabled: boolean;
  pollIntervalSeconds: number; // default: 30
  minScoreThreshold: number;   // default: 80
  minLiquidityUsd: number;     // default: 20000
  cooldownMinutes: number;     // default: 120
  autoAlarmEnabled: boolean;
  webhookUrl: string;
};

export type TgMonitorState = {
  isRunning: boolean;
  config: TgMonitorConfig;
  lastPollTime: string | null;
  nextPollTime: string | null;
  parsedMessagesCount: number;
  evaluatedTokensCount: number;
  alertedCount: number;
  recentEvaluations: TgTokenEvaluation[];
  history: TgAlarmRecord[];
};

export type TrackedAlertToken = {
  id: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  chain: string;
  source: "robinhood-scanner" | "telegram-channel";
  channel?: string;
  score: number;
  tier: string;
  alertTimestamp: string;
  alertPriceUsd: number | null;
  alertMcapUsd?: number | null;
  alertLiquidityUsd?: number | null;

  // Real-time tracking
  latestPriceUsd: number | null;
  latestCheckTime?: string;
  highestPriceUsd: number | null;
  highestGainPct: number | null; // e.g. +150.5%
  lowestPriceUsd: number | null;
  lowestChangePct: number | null; // e.g. -25.0%

  // Checkpoints
  review1hDone?: boolean;
  price1hUsd?: number | null;
  change1hPct?: number | null;

  review24hDone?: boolean;
  price24hUsd?: number | null;
  change24hPct?: number | null;
};

export type BacktestReportItem = {
  tokenAddress: string;
  symbol: string;
  chain: string;
  source: string;
  score: number;
  alertTimestamp: string;
  alertPriceUsd: number | null;
  reviewTimestamp: string;
  reviewPriceUsd: number | null;
  priceChangePct: number | null;
  highestPriceUsd: number | null;
  highestGainPct: number | null;
  verdict:
    | "PUMP_3X"
    | "PUMP_2X"
    | "PROFIT_TAKE"
    | "MODEST_GAIN"
    | "PULLBACK"
    | "DUMP_LOSS";
  statusText: string;
};

export type BacktestSummary = {
  interval: "1h" | "24h";
  totalTokens: number;
  positiveTokens: number;
  takeProfitTokens: number; // >= +30%
  doubledTokens: number; // >= +100%
  lossTokens: number; // < 0%
  winRatePct: number; // takeProfit / total * 100
  netPositiveRatePct: number; // positive / total * 100
  avgChangePct: number;
  maxGainPct: number;
  mvpSymbol?: string;
  mvpGainPct?: number;
};

export type BacktestReport = {
  id: string;
  interval: "1h" | "24h";
  timestamp: string;
  summary: BacktestSummary;
  items: BacktestReportItem[];
  larkOk: boolean;
  larkMsg?: string;
};

export type BacktestConfig = {
  enabled: boolean;
  hourlyCheckEnabled: boolean;
  dailyCheckEnabled: boolean;
  priceTrackIntervalMinutes: number; // default: 5
  takeProfitThresholdPct: number; // default: 30 (>= +30% is a win)
  autoLarkPush: boolean;
  webhookUrl: string;
};

export type BacktestState = {
  isRunning: boolean;
  config: BacktestConfig;
  trackedTokensCount: number;
  lastHourlyCheckTime: string | null;
  lastDailyCheckTime: string | null;
  lastPriceTrackTime: string | null;
  recentReports: BacktestReport[];
  trackedTokens: TrackedAlertToken[];
};

export type TradeConfig = {
  dryRun: boolean; // default true for safety
  autoBuyEnabled: boolean;
  buyAmountBscBnb: number; // default: 0.05 BNB (~$30)
  buyAmountRhEth: number; // default: 0.005 ETH (~$15)
  maxPriceDeviationPct: number; // default: 10% max price deviation at execution
  executionTimeoutSeconds: number; // default: 60s max signal age
  slippagePct: number; // default: 8% (for meme tokens)
  gasMultiplier: number; // default: 1.2
  tp1Pct: number; // default: +50%
  tp1SellRatioPct: number; // default: 50%
  tp2Pct: number; // default: +100%
  tp2SellRatioPct: number; // default: 25%
  tp3TrailingStopPct: number; // default: 25% drawdown from peak ATH
  stopLossPct: number; // default: -18%
  maxHoldTimeMinutes: number; // default: 360 (6 hours)
  emergencyLiquidityDrainPct: number; // default: 35%
  larkTradeNotification: boolean;
  webhookUrl?: string;
  walletAddress?: string;
  hasBscKey: boolean;
  hasRhKey: boolean;
};

export type TradeTxRecord = {
  id: string;
  type:
    | "BUY"
    | "SELL_TP1"
    | "SELL_TP2"
    | "SELL_SL"
    | "SELL_TIMEOUT"
    | "SELL_TRAILING"
    | "SELL_MANUAL";
  timestamp: string;
  txHash?: string;
  amountIn: string;
  amountOut: string;
  priceUsd: number;
  priceNative: number;
  pnlUsd?: number;
  pnlPct?: number;
  dryRun: boolean;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  error?: string;
};

export type TradePosition = {
  id: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  chain: "bsc" | "robinhood" | string;
  source: string;
  entryTime: string;
  entryPriceUsd: number;
  entryPriceNative: number;
  entryAmountTokens: string; // Token units formatted
  initialTokens: string;
  remainingTokens: string;
  entryCostNative: number;
  entryCostUsd: number;
  highestPriceUsd: number;
  highestGainPct: number;
  currentPriceUsd: number;
  currentGainPct: number;
  status:
    | "OPEN"
    | "PARTIAL_TP1"
    | "PARTIAL_TP2"
    | "CLOSED_TP"
    | "CLOSED_SL"
    | "CLOSED_TIMEOUT"
    | "CLOSED_MANUAL";
  tp1Done: boolean;
  tp2Done: boolean;
  txHistory: TradeTxRecord[];
  realizedPnlUsd: number;
  realizedPnlNative: number;
  closeTime?: string;
};

export type TradeState = {
  isRunning: boolean;
  config: TradeConfig;
  walletAddress?: string;
  bscBnbBalance: number;
  rhEthBalance: number;
  activePositions: TradePosition[];
  closedPositions: TradePosition[];
  totalRealizedPnlUsd: number;
  winTradeCount: number;
  lossTradeCount: number;
  winRatePct: number;
};

// ==========================================
// V4 Concentrated & Asymmetric LP Market Maker Types
// ==========================================

export type LpStage = "PUMP" | "SIDEWAYS" | "DUMP" | "RWA_STABLE";

export type LpCategory = "RWA" | "MEME" | "BLUECHIP";

export type LpRangeSegment = {
  segmentName: string; // e.g. "Core Fee Zone (40%)", "Chase Upper (35%)", "Buffer Lower (25%)"
  minPriceUsd: number;
  maxPriceUsd: number;
  lowerTick: number;
  upperTick: number;
  capitalSharePct: number; // e.g. 40
  capitalAllocatedUsd: number;
  tokenId?: string; // On-chain Uniswap V3/V4 NFT tokenId if live
  inRange: boolean;
};

export type LpConfig = {
  dryRun: boolean; // default: true
  autoLpEnabled: boolean; // default: true
  capitalPerPoolUsd: number; // default: 50 USDG per pool
  maxActivePools: number; // default: 5
  maxPoolSharePct: number; // default: 20% of pool active liquidity
  minVolumeToLiquidityRatio: number; // default: 1.5 (e.g. 5m volume > 1.5x liquidity)
  preferredFeeTier: number; // default: 10000 (1%)
  maxTopHoldersPct: number; // default: 35%
  minScoreThreshold: number; // default: 80
  
  // Asymmetric Range Settings (Pump Stage)
  pumpCoreSharePct: number; // default: 40%
  pumpCoreUpPct: number; // default: 30% (+30% from entry)
  pumpChaseSharePct: number; // default: 35%
  pumpChaseUpPct: number; // default: 100% (+30% to +100%)
  pumpBufferSharePct: number; // default: 25%
  pumpBufferDownPct: number; // default: -50% (-50% to 0%)

  // Spot Concentrated Settings (Sideways Stage)
  sidewaysCoreSharePct: number; // default: 70%
  sidewaysCoreWidthPct: number; // default: 15% (±15%)
  sidewaysDefendSharePct: number; // default: 30% (15% above + 15% below)

  // RWA Tokenized Equities Settings
  rwaBandWidthPct: number; // default: 10% (±10% narrower for stocks)
  rwaCapitalUsd: number; // default: 100 USDG for RWA

  // Dynamic Rebalancing & IL Stop Loss
  enableAutoRebalance: boolean; // default: true
  rebalanceDriftThresholdPct: number; // default: 12% (drift > 12% triggers rebalance)
  maxRebalancesPerPosition: number; // default: 3
  netPnlStopLossPct: number; // default: -8% (if net pnl < -8%, auto exit)

  // Risk & Profit Management
  withdrawPrincipalFeeRatio: number; // default: 0.35 (Withdraw principal when fee >= 35%)
  volumeDropExitThresholdPct: number; // default: 50% (Exit when 5m volume drops >50%)
  stopLossPriceDropPct: number; // default: -25% (Exit if price drops below lowest buffer)
  maxHoldMinutes: number; // default: 720 (12 hours)
  
  // High Yield LP Opportunity Scanner Settings
  minOpportunityFeeRatePct: number; // default: 80% daily fee rate
  minOpportunityVolume2hUsd: number; // default: 10000 USD
  maxOpportunityActiveLiqUsd: number; // default: 80000 USD
  opportunityAlertCooldownMin: number; // default: 60 minutes
  
  larkNotification: boolean;
  webhookUrl?: string;
  walletAddress?: string;
  hasRhKey: boolean;
};

export type LpTxRecord = {
  id: string;
  type:
    | "MINT_LP"
    | "COLLECT_FEE"
    | "WITHDRAW_PRINCIPAL"
    | "REBALANCE"
    | "EXIT_FLASH";
  timestamp: string;
  txHash?: string;
  details: string;
  amountUsd?: number;
  feeHarvestedUsd?: number;
  dryRun: boolean;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  error?: string;
};

export type LpPosition = {
  id: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  chain: "robinhood" | "bsc" | string;
  pairAddress?: string;
  feeTier: number; // e.g. 10000 (1%), 40000 (4%), 200000 (20%)
  stage: LpStage;
  category?: LpCategory;
  isRwa?: boolean;
  stockSymbol?: string;
  
  entryTime: string;
  entryPriceUsd: number;
  initialUsdInvested: number;
  currentPriceUsd: number;
  volume5mAtEntry: number;
  liquidityAtEntry: number;
  latestVolume5m: number;
  volumeDropPct: number;
  
  // Concentrated Liquidity Metrics
  activeBandLiquidityUsd: number; // ±15% band depth
  capitalEfficiencyRatio: number; // e.g. 7.5x ~ 15x
  dailyFeeRatePct: number; // Current calculated daily fee yield %
  holdVsLpScore: number; // Score 0-100 indicating LP advantage over pure hold
  
  ranges: LpRangeSegment[];
  
  feeEarnedUsd: number;
  principalWithdrawnUsd: number;
  impermanentLossUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  
  rebalanceCount: number;
  lastRebalanceTime?: string;
  
  status:
    | "ACTIVE"
    | "PRINCIPAL_SECURED"
    | "REBALANCING"
    | "CLOSED_PROFIT"
    | "CLOSED_STOPLOSS"
    | "CLOSED_VOL_DROP"
    | "CLOSED_TIMEOUT"
    | "CLOSED_MANUAL";
  exitReason?: string;
  closeTime?: string;
  txHistory: LpTxRecord[];
};

export type LpState = {
  isRunning: boolean;
  config: LpConfig;
  walletAddress?: string;
  activePositions: LpPosition[];
  closedPositions: LpPosition[];
  walletStatus?: LpWalletStatus;
  totalFeeEarnedUsd: number;
  totalRealizedPnlUsd: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  lastOpportunityScanTime?: string;
};

export type LpWalletStatus = {
  hasWallet: boolean;
  walletAddress?: string;
  ethBalance?: string;
  usdgBalance?: string;
  isReadyForLive: boolean;
  warning?: string;
  lastCheckedAt?: string;
};

// ==========================================
// Robinhood Uniswap V4 Pool & Barker Index Types
// ==========================================

export type V4PoolItem = {
  poolId: string;
  pairAddress: string;
  token0Symbol: string;
  token0Address: string;
  token1Symbol: string;
  token1Address: string;
  pairName: string; // e.g. "CANAL/NVDA", "SHROOM/USDG"
  category: LpCategory;
  isRwa: boolean;
  stockSymbol?: string;
  feeTierPct: number; // e.g. 1.0, 4.0, 20.0
  feeTierBps: number; // e.g. 10000, 40000
  isDynamicHook?: boolean;
  hookDescription?: string;
  
  currentPriceUsd: number;
  priceChange1hPct: number;
  
  activeBandLiquidityUsd: number; // ±15% active band depth
  totalLiquidityUsd: number; // Total pool TVL
  volume2hUsd: number;
  volume24hUsd: number;
  fee2hUsd: number;
  fee24hUsd: number;
  
  dailyFeeRatePct: number; // Calculated daily fee rate (2H fees * 12 / activeBandLiq)
  annualizedAprPct: number; // dailyFeeRatePct * 365
  capitalEfficiency: number; // concentration multiplier
  healthScore: number; // 0-100 overall score considering volume, depth, fee, IL risk
  
  createdAt?: string;
  isNewPool?: boolean; // Pool created within last 24 hours
  barkerUrl?: string;
  explorerUrl?: string;
};

export type V4MarketSummary = {
  indexedPoolsCount: number;
  total24hVolumeUsd: number;
  total24hFeeUsd: number;
  avgDailyFeeRatePct: number;
  topYieldPools: V4PoolItem[];
  rwaPools: V4PoolItem[];
  memePools: V4PoolItem[];
  newPools: V4PoolItem[];
  updatedAt: string;
};

