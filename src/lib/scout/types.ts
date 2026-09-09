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


