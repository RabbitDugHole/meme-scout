import type { Candidate } from "./types";
import type { DexPair } from "./dexscreener";

export type PotentialTier = "S" | "A" | "B" | "C" | "RUG";

export type MemeIndicators = {
  // Financial & Liquidity
  liquidityMcapRatio: number | null; // Liq / MCap ratio (healthy: 15% - 50%)
  volLiqRatio1h: number | null; // 1h Volume / Liq (velocity of capital)
  volume24h: number | null;
  volumeM5: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;
  priceChangeH24: number | null;
  
  // Transaction & Buying Momentum
  buyCount1h: number;
  sellCount1h: number;
  buyRatio1h: number | null; // buys / (buys + sells)
  netBuyersEstimate: "strong_buy" | "balanced" | "sell_pressure" | "unknown";

  // Holders & Concentration
  holders: number | null;
  top10Ratio: number | null; // Top 10 holders excluding LP/locker
  holderHealth: "decentralized" | "moderate" | "whale_risk" | "unknown";

  // Safety & Contract
  isLpLocked: boolean;
  isMintDisabled: boolean;
  isPauseDisabled: boolean;
  isVerified: boolean;
  deployerClean: boolean;

  // Smart Money & Ecosystem
  smartBuyersCount: number;
  isStockPaired: boolean;
  hasSocials: boolean;

  // Dimension Scores
  safetyScore: number; // 0 - 25
  distributionScore: number; // 0 - 20
  liquidityScore: number; // 0 - 20
  momentumScore: number; // 0 - 25
  narrativeScore: number; // 0 - 10
  totalScore: number; // 0 - 100

  potentialTier: PotentialTier;
  signals: string[];
  risks: string[];
  isPotentialAlarm: boolean;
};

/**
 * Calculate multi-dimensional meme indicators and composite potential score (0-100).
 */
export function evaluateMemeToken(
  candidate: Candidate,
  dexPair?: DexPair | null,
): MemeIndicators {
  const mcap = candidate.mcapUsd ?? (dexPair?.marketCap ?? dexPair?.fdv ?? null);
  const liq = candidate.liquidityUsd ?? (dexPair?.liquidity?.usd ?? null);
  const vol1h = candidate.volumeH1 ?? (dexPair?.volume?.h1 ?? null);
  const volume24h = dexPair?.volume?.h24 ?? null;
  const volM5 = dexPair?.volume?.m5 ?? null;
  const pcM5 = dexPair?.priceChange?.m5 ?? null;
  const pcH1 = candidate.priceChangeH1 ?? (dexPair?.priceChange?.h1 ?? null);
  const pcH24 = dexPair?.priceChange?.h24 ?? null;

  // Txns
  const buys = dexPair?.txns?.h1?.buys ?? 0;
  const sells = dexPair?.txns?.h1?.sells ?? 0;
  const totalTxns = buys + sells;
  const buyRatio = totalTxns > 0 ? buys / totalTxns : null;

  // Ratios
  const liquidityMcapRatio = liq != null && mcap != null && mcap > 0 ? liq / mcap : null;
  const volLiqRatio1h = vol1h != null && liq != null && liq > 0 ? vol1h / liq : null;

  // Safety flags
  const isLpLocked = Boolean(candidate.lpLocked);
  const isMintDisabled = candidate.mintOrPause === false;
  const isPauseDisabled = candidate.mintOrPause === false;
  const isVerified = Boolean(candidate.verified);
  const deployerClean = candidate.deployerLaunchCount == null || candidate.deployerLaunchCount < 3;

  // Holders
  const holders = candidate.holders ?? null;
  const top10 = candidate.top10ExLp ?? null;

  let holderHealth: MemeIndicators["holderHealth"] = "unknown";
  if (top10 != null) {
    if (top10 <= 0.35) holderHealth = "decentralized";
    else if (top10 <= 0.55) holderHealth = "moderate";
    else holderHealth = "whale_risk";
  }

  // Momentum
  let netBuyersEstimate: MemeIndicators["netBuyersEstimate"] = "unknown";
  if (buyRatio != null) {
    if (buyRatio >= 0.6) netBuyersEstimate = "strong_buy";
    else if (buyRatio >= 0.45) netBuyersEstimate = "balanced";
    else netBuyersEstimate = "sell_pressure";
  }

  const smartBuyersCount = candidate.smartBuyers2h.length;
  const isStockPaired = Boolean(candidate.stockPair);
  const hasSocials = Boolean(candidate.tweetUrl || dexPair?.url);

  // --- Dimension Scoring (0 - 100) ---
  const signals: string[] = [];
  const risks: string[] = [];

  // 1. Safety Score (Max 25 pts)
  let safetyScore = 0;
  if (isLpLocked) {
    safetyScore += 10;
    signals.push("LP 已锁仓/销毁");
  } else {
    risks.push("LP 未锁仓，防撤池风险");
  }

  if (isVerified) {
    safetyScore += 5;
    signals.push("合约已开源认证");
  } else {
    risks.push("合约未开源");
  }

  if (isMintDisabled) {
    safetyScore += 5;
    signals.push("无增发/暂停后门");
  } else if (candidate.mintOrPause === true) {
    risks.push("注意：包含增发或暂停函数");
  }

  if (deployerClean) {
    safetyScore += 5;
  } else {
    risks.push("部署者近期连发多个代币，警惕连环盘");
  }

  // 2. Holder Distribution Score (Max 20 pts)
  let distributionScore = 0;
  if (top10 != null) {
    if (top10 <= 0.30) {
      distributionScore += 10;
      signals.push(`前十持仓仅 ${(top10 * 100).toFixed(1)}% (极分散)`);
    } else if (top10 <= 0.45) {
      distributionScore += 7;
      signals.push(`前十持仓 ${(top10 * 100).toFixed(1)}% (适中)`);
    } else if (top10 <= 0.60) {
      distributionScore += 3;
    } else {
      risks.push(`前十筹码集中度 ${(top10 * 100).toFixed(1)}% 偏高`);
    }
  }

  if (holders != null) {
    if (holders >= 250) {
      distributionScore += 10;
      signals.push(`持有人 ${holders} 人 (筹码广泛)`);
    } else if (holders >= 100) {
      distributionScore += 7;
      signals.push(`持有人 ${holders} 人`);
    } else if (holders >= 50) {
      distributionScore += 3;
    } else {
      risks.push(`持有人仅 ${holders} 人，未达基础散户规模`);
    }
  }

  // 3. Liquidity & Valuation Score (Max 20 pts)
  let liquidityScore = 0;
  if (liq != null) {
    if (liq >= 50_000) {
      liquidityScore += 10;
      signals.push(`流动性 $${(liq / 1000).toFixed(1)}k 充裕`);
    } else if (liq >= 30_000) {
      liquidityScore += 7;
      signals.push(`流动性 $${(liq / 1000).toFixed(1)}k`);
    } else if (liq >= 10_000) {
      liquidityScore += 4;
    } else {
      risks.push(`流动性偏低 ($${liq.toFixed(0)})`);
    }
  }

  if (liquidityMcapRatio != null) {
    if (liquidityMcapRatio >= 0.18 && liquidityMcapRatio <= 0.55) {
      liquidityScore += 5;
      signals.push(`资金池比例 ${(liquidityMcapRatio * 100).toFixed(1)}% 健康`);
    } else if (liquidityMcapRatio < 0.10) {
      risks.push(`流动性/市值比仅 ${(liquidityMcapRatio * 100).toFixed(1)}%，滑点大易崩塌`);
    }
  }

  if (mcap != null) {
    if (mcap >= 15_000 && mcap <= 350_000) {
      liquidityScore += 5;
      signals.push("市值处于黄金爆发期 ($15k-$350k)");
    } else if (mcap <= 1_500_000) {
      liquidityScore += 3;
    }
  }

  // 4. Momentum & Trading Flow Score (Max 25 pts)
  let momentumScore = 0;
  if (smartBuyersCount >= 2) {
    momentumScore += 12;
    signals.push(`2h 内 ${smartBuyersCount} 笔 ≥$200 聪明钱大买`);
  } else if (smartBuyersCount === 1) {
    momentumScore += 6;
    signals.push("2h 内有 1 笔 ≥$200 聪明钱介入");
  }

  if (buyRatio != null) {
    if (buyRatio >= 0.65) {
      momentumScore += 8;
      signals.push(`1h 买单占比 ${(buyRatio * 100).toFixed(1)}% (多头主导)`);
    } else if (buyRatio >= 0.50) {
      momentumScore += 5;
    } else {
      risks.push(`1h 卖盘偏多 (买单仅 ${(buyRatio * 100).toFixed(1)}%)`);
    }
  }

  if (volLiqRatio1h != null && volLiqRatio1h >= 0.3) {
    momentumScore += 5;
    signals.push(`1h 换手率 ${(volLiqRatio1h * 100).toFixed(0)}% (热度极高)`);
  }

  // 5. Narrative & Ecosystem Score (Max 10 pts)
  let narrativeScore = 0;
  if (isStockPaired) {
    narrativeScore += 5;
    signals.push(`Robinhood 股票代币配对 (${candidate.stockPair?.symbol})`);
  }
  if (hasSocials) {
    narrativeScore += 5;
    signals.push("社区社交信息已配置");
  }

  const totalScore = Math.min(
    100,
    safetyScore + distributionScore + liquidityScore + momentumScore + narrativeScore,
  );

  // Tier Determination
  let potentialTier: PotentialTier = "C";
  if (totalScore >= 80) potentialTier = "S";
  else if (totalScore >= 65) potentialTier = "A";
  else if (totalScore >= 50) potentialTier = "B";
  else potentialTier = "C";

  if (!isLpLocked || candidate.mintOrPause === true) {
    if (potentialTier === "S" || potentialTier === "A") potentialTier = "B";
  }

  // Criteria for triggering automated alarms
  const isPotentialAlarm =
    (candidate.verdict === "ALERT" || totalScore >= 65) &&
    isLpLocked &&
    (candidate.liquidityUsd ?? 0) >= 30_000;

  return {
    liquidityMcapRatio,
    volLiqRatio1h,
    volume24h,
    volumeM5: volM5,
    priceChangeM5: pcM5,
    priceChangeH1: pcH1,
    priceChangeH24: pcH24,
    buyCount1h: buys,
    sellCount1h: sells,
    buyRatio1h: buyRatio,
    netBuyersEstimate,
    holders,
    top10Ratio: top10,
    holderHealth,
    isLpLocked,
    isMintDisabled,
    isPauseDisabled,
    isVerified,
    deployerClean,
    smartBuyersCount,
    isStockPaired,
    hasSocials,
    safetyScore,
    distributionScore,
    liquidityScore,
    momentumScore,
    narrativeScore,
    totalScore,
    potentialTier,
    signals,
    risks,
    isPotentialAlarm,
  };
}
