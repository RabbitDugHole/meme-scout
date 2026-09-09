/**
 * Telegram Channel Meme Monitor Service
 * Scrapes public Telegram channels (e.g. https://t.me/s/lanniaohui),
 * extracts newly alerted meme tokens across chains (Robinhood, BSC, Solana, etc.),
 * runs live secondary screening & multi-dimensional indicator scoring via DexScreener,
 * and pushes qualified high-potential tokens to Lark Bot.
 */

import { DEFAULT_LARK_WEBHOOK_URL, sendLarkTgAlarm } from "./lark";
import { backtestEngine } from "./backtest.server";
import type {
  TgAlarmRecord,
  TgChannelConfig,
  TgMessageParsed,
  TgMonitorConfig,
  TgMonitorState,
  TgTokenEvaluation,
} from "./types";

export const DEFAULT_TG_CHANNELS: TgChannelConfig[] = [
  {
    username: "lanniaohui",
    name: "Bluebird 监控频道🕊️",
    enabled: true,
  },
];

export class TelegramChannelMonitor {
  private static instance: TelegramChannelMonitor | null = null;

  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private isPollInProgress: boolean = false;
  private lastPollTime: string | null = null;
  private nextPollTime: string | null = null;

  private config: TgMonitorConfig = {
    channels: [...DEFAULT_TG_CHANNELS],
    enabled: true,
    pollIntervalSeconds: 30, // Poll every 30s
    minScoreThreshold: 80, // Score >= 80 (S-Tier)
    minLiquidityUsd: 20000, // Live DEX liq >= $20k
    cooldownMinutes: 120, // 2h cooldown per CA
    autoAlarmEnabled: true,
    webhookUrl: DEFAULT_LARK_WEBHOOK_URL,
  };

  // Set of processed post IDs e.g. "lanniaohui/15468"
  private processedPostIds: Set<string> = new Set();

  // Map of lowercase token address to alert timestamp and score
  private alertedTokens: Map<
    string,
    { symbol: string; score: number; alertedAt: string }
  > = new Map();

  // In-memory list of recent token evaluations
  private recentEvaluations: TgTokenEvaluation[] = [];

  // In-memory history of sent Lark alarms
  private alarmHistory: TgAlarmRecord[] = [];

  private constructor() {
    this.start();
  }

  public static getInstance(): TelegramChannelMonitor {
    if (!TelegramChannelMonitor.instance) {
      TelegramChannelMonitor.instance = new TelegramChannelMonitor();
    }
    return TelegramChannelMonitor.instance;
  }

  public getState(): TgMonitorState {
    return {
      isRunning: this.isRunning,
      config: {
        ...this.config,
        channels: [...this.config.channels],
      },
      lastPollTime: this.lastPollTime,
      nextPollTime: this.nextPollTime,
      parsedMessagesCount: this.processedPostIds.size,
      evaluatedTokensCount: this.recentEvaluations.length,
      alertedCount: this.alarmHistory.length,
      recentEvaluations: [...this.recentEvaluations],
      history: [...this.alarmHistory],
    };
  }

  public updateConfig(patch: Partial<TgMonitorConfig>): TgMonitorState {
    this.config = { ...this.config, ...patch };
    if (patch.pollIntervalSeconds && this.isRunning) {
      this.stop();
      this.start();
    }
    return this.getState();
  }

  public addChannel(channelInput: string, name?: string): TgMonitorState {
    const username = cleanChannelUsername(channelInput);
    if (!username) return this.getState();

    const exists = this.config.channels.some(
      (c) => c.username.toLowerCase() === username.toLowerCase(),
    );
    if (!exists) {
      this.config.channels.push({
        username,
        name: name || `@${username}`,
        enabled: true,
      });
    }
    return this.getState();
  }

  public removeChannel(channelInput: string): TgMonitorState {
    const username = cleanChannelUsername(channelInput);
    this.config.channels = this.config.channels.filter(
      (c) => c.username.toLowerCase() !== username.toLowerCase(),
    );
    return this.getState();
  }

  public toggleChannel(channelInput: string, enabled?: boolean): TgMonitorState {
    const username = cleanChannelUsername(channelInput);
    const target = this.config.channels.find(
      (c) => c.username.toLowerCase() === username.toLowerCase(),
    );
    if (target) {
      target.enabled = enabled !== undefined ? enabled : !target.enabled;
    }
    return this.getState();
  }

  public start(): void {
    if (this.isRunning && this.timer) return;
    this.isRunning = true;
    this.scheduleNextRun();

    // Initial check after 3s
    setTimeout(() => {
      this.runPollCycle().catch((err) => {
        console.warn("[TgMonitor] Initial poll error:", err?.message || err);
      });
    }, 3000);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.nextPollTime = null;
  }

  private scheduleNextRun(): void {
    if (!this.isRunning) return;
    if (this.timer) clearTimeout(this.timer);

    const ms = this.config.pollIntervalSeconds * 1000;
    this.nextPollTime = new Date(Date.now() + ms).toISOString();

    this.timer = setTimeout(async () => {
      try {
        await this.runPollCycle();
      } catch (err: any) {
        console.warn("[TgMonitor] Polling cycle error:", err?.message || err);
      } finally {
        this.scheduleNextRun();
      }
    }, ms);
  }

  /**
   * Run a single polling cycle across all enabled channels.
   */
  public async runPollCycle(force: boolean = false): Promise<{
    polledChannels: number;
    newMessagesCount: number;
    evaluatedCount: number;
    newAlarmsCount: number;
  }> {
    if (this.isPollInProgress && !force) {
      return { polledChannels: 0, newMessagesCount: 0, evaluatedCount: 0, newAlarmsCount: 0 };
    }

    this.isPollInProgress = true;
    this.lastPollTime = new Date().toISOString();

    let newMessagesCount = 0;
    let evaluatedCount = 0;
    let newAlarmsCount = 0;

    const enabledChannels = this.config.channels.filter((c) => c.enabled);

    try {
      for (const ch of enabledChannels) {
        const posts = await fetchChannelMessages(ch.username);
        for (const post of posts) {
          if (this.processedPostIds.has(post.postId)) {
            continue;
          }
          this.processedPostIds.add(post.postId);
          newMessagesCount++;

          // Cap processed set to prevent unbounded growth
          if (this.processedPostIds.size > 2000) {
            const arr = Array.from(this.processedPostIds);
            this.processedPostIds = new Set(arr.slice(arr.length - 1500));
          }

          // Evaluate the token via DexScreener & indicator scoring
          evaluatedCount++;
          const evalResult = await this.evaluateTgToken(post);

          // Add to recent evaluations buffer
          this.recentEvaluations.unshift(evalResult);
          if (this.recentEvaluations.length > 50) {
            this.recentEvaluations = this.recentEvaluations.slice(0, 50);
          }

          // Check if it passes filter
          if (!evalResult.passedFilter) {
            continue;
          }

          // Cooldown check
          const addrKey = post.address.toLowerCase();
          const prevAlert = this.alertedTokens.get(addrKey);
          const now = Date.now();

          if (prevAlert && !force) {
            const elapsedMin = (now - new Date(prevAlert.alertedAt).getTime()) / 60000;
            const scoreDelta = evalResult.totalScore - prevAlert.score;
            if (elapsedMin < this.config.cooldownMinutes && scoreDelta < 15) {
              continue;
            }
          }

          // Trigger Lark Alarm!
          let larkOk = false;
          let larkMsg = "";

          if (this.config.autoAlarmEnabled) {
            const sendRes = await sendLarkTgAlarm(
              evalResult,
              this.config.webhookUrl,
            );
            larkOk = sendRes.ok;
            larkMsg = sendRes.msg || sendRes.error || (larkOk ? "Success" : "Failed");
            if (larkOk) {
              console.log(
                `[TgMonitor] ✅ 飞书报警推送成功: TG代币 $${post.symbol} (${post.chain}) - 得分: ${evalResult.totalScore}`,
              );
            } else {
              console.warn(`[TgMonitor] ⚠️ 飞书推送告警失败: ${larkMsg}`);
            }
          } else {
            larkOk = true;
            larkMsg = "Simulated (Auto-alarm disabled)";
          }

          const alarmRecord: TgAlarmRecord = {
            id: `${addrKey}-${now}`,
            postId: post.postId,
            channel: post.channel,
            channelUrl: post.url,
            tokenAddress: post.address,
            symbol: post.symbol,
            chain: post.chain,
            score: evalResult.totalScore,
            tier: evalResult.potentialTier,
            timestamp: new Date().toISOString(),
            larkOk,
            larkMsg,
            priceUsd: evalResult.liveData?.priceUsd,
            mcapUsd: evalResult.liveData?.mcapUsd,
            liquidityUsd: evalResult.liveData?.liquidityUsd,
            volumeH1: evalResult.liveData?.volumeH1,
            priceChangeH1: evalResult.liveData?.priceChangeH1,
            smartMoneyCount: post.smartMoneyCount,
            kolCount: post.kolCount,
            signals: evalResult.signals,
            risks: evalResult.risks,
            dexUrl: evalResult.liveData?.dexUrl,
            tweetUrl: post.tweetUrl,
          };

          this.alertedTokens.set(addrKey, {
            symbol: post.symbol,
            score: evalResult.totalScore,
            alertedAt: alarmRecord.timestamp,
          });

          this.alarmHistory.unshift(alarmRecord);
          if (this.alarmHistory.length > 50) {
            this.alarmHistory = this.alarmHistory.slice(0, 50);
          }

          // Record for 1h / 24h win-rate backtesting
          backtestEngine.recordAlert({
            tokenAddress: post.address,
            symbol: post.symbol,
            name: post.name,
            chain: post.chain,
            source: "telegram-channel",
            channel: post.channel,
            score: evalResult.totalScore,
            tier: evalResult.potentialTier,
            priceUsd: evalResult.liveData?.priceUsd ?? null,
            mcapUsd: evalResult.liveData?.mcapUsd ?? null,
            liquidityUsd: evalResult.liveData?.liquidityUsd ?? null,
          });

          newAlarmsCount++;
        }
      }

      if (newAlarmsCount > 0 || newMessagesCount > 0) {
        console.log(
          `[TgMonitor] 📡 巡检完成: 检查 ${enabledChannels.length} 个TG频道, 检出 ${newMessagesCount} 条新情报, 研判 ${evaluatedCount} 个代币, 推送 ${newAlarmsCount} 条告警`,
        );
      }
    } catch (err: any) {
      console.warn("[TgMonitor] 巡检异常:", err?.message || err);
    } finally {
      this.isPollInProgress = false;
    }

    return {
      polledChannels: enabledChannels.length,
      newMessagesCount,
      evaluatedCount,
      newAlarmsCount,
    };
  }

  /**
   * Evaluate a token from Telegram using DexScreener live DEX data and multi-dimensional scoring.
   */
  public async evaluateTgToken(token: TgMessageParsed): Promise<TgTokenEvaluation> {
    const signals: string[] = [];
    const risks: string[] = [];

    // Query live pair from DexScreener
    let liveData: TgTokenEvaluation["liveData"] = null;

    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${token.address}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MemeScout/1.0)",
          },
          signal: AbortSignal.timeout(8000),
        },
      );

      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as any;
        const pairs = Array.isArray(json.pairs) ? json.pairs : [];
        if (pairs.length > 0) {
          // Sort by liquidity USD descending
          pairs.sort(
            (a: any, b: any) =>
              (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0),
          );
          const p = pairs[0];

          liveData = {
            priceUsd: Number(p.priceUsd) || null,
            mcapUsd: Number(p.marketCap) || Number(p.fdv) || null,
            liquidityUsd: Number(p.liquidity?.usd) || null,
            volumeH1: Number(p.volume?.h1) || null,
            priceChangeH1: Number(p.priceChange?.h1) || null,
            buysH1: Number(p.txns?.h1?.buys) || 0,
            sellsH1: Number(p.txns?.h1?.sells) || 0,
            dexUrl: p.url || `https://dexscreener.com/search?q=${token.address}`,
            pairAddress: p.pairAddress,
            hasTwitter: Boolean(
              p.info?.socials?.some((s: any) => s.type === "twitter"),
            ),
            hasWebsite: Boolean(p.info?.websites?.length > 0),
          };
        }
      }
    } catch {
      // Network timeout or error
    }

    const liqUsd = liveData?.liquidityUsd ?? 0;
    const mcapUsd = liveData?.mcapUsd ?? 0;
    const pcH1 = liveData?.priceChangeH1 ?? 0;
    const buys = liveData?.buysH1 ?? 0;
    const sells = liveData?.sellsH1 ?? 0;
    const totalTxns = buys + sells;
    const buyRatio = totalTxns > 0 ? buys / totalTxns : null;

    // 1. Safety Score (Max 25 pts)
    let safetyScore = 0;
    const tgSafetyLower = (token.tgSafety || "").toLowerCase();
    const hasLockSignal =
      tgSafetyLower.includes("已锁") ||
      tgSafetyLower.includes("锁销") ||
      tgSafetyLower.includes("已放弃") ||
      tgSafetyLower.includes("s级");

    if (hasLockSignal) {
      safetyScore += 16;
      signals.push("TG 官方评级确认: LP 已锁销 / 权限已放弃");
    } else {
      safetyScore += 5;
    }

    if (tgSafetyLower.includes("s级")) {
      safetyScore += 5;
      signals.push("安全矩阵等级 S 级");
    } else if (tgSafetyLower.includes("a级")) {
      safetyScore += 3;
    }

    const bundleMatch = tgSafetyLower.match(/捆绑\s*(\d+)%/);
    if (bundleMatch && Number(bundleMatch[1]) > 40) {
      risks.push(`老鼠仓/捆绑比例偏高 (${bundleMatch[1]}%)`);
      safetyScore -= 8;
    }

    safetyScore = Math.max(0, Math.min(25, safetyScore));

    // 2. Liquidity Score (Max 20 pts)
    let liquidityScore = 0;
    if (liqUsd >= 50000) {
      liquidityScore += 15;
      signals.push(`实时池子充足 ($${Math.round(liqUsd).toLocaleString()})`);
    } else if (liqUsd >= 30000) {
      liquidityScore += 12;
      signals.push(`实时池子达标 ($${Math.round(liqUsd).toLocaleString()})`);
    } else if (liqUsd >= 15000) {
      liquidityScore += 7;
    } else if (liqUsd > 0) {
      risks.push(`流动性较浅 ($${Math.round(liqUsd).toLocaleString()})`);
      liquidityScore += 2;
    } else {
      risks.push("未能查询到有效 DEX 流动性池");
    }

    if (mcapUsd > 0 && liqUsd > 0) {
      const ratio = liqUsd / mcapUsd;
      if (ratio >= 0.12 && ratio <= 0.6) {
        liquidityScore += 5;
      }
    }
    liquidityScore = Math.max(0, Math.min(20, liquidityScore));

    // 3. Momentum & Trading Score (Max 25 pts)
    let momentumScore = 0;

    // Smart money from TG
    if (token.smartMoneyCount && token.smartMoneyCount >= 5) {
      momentumScore += 9;
      signals.push(`TG 检出 ${token.smartMoneyCount} 个聪明钱同时跟买`);
    } else if (token.smartMoneyCount && token.smartMoneyCount >= 2) {
      momentumScore += 5;
      signals.push(`TG 检出 ${token.smartMoneyCount} 个聪明钱介入`);
    }

    if (token.kolCount && token.kolCount >= 3) {
      momentumScore += 4;
      signals.push(`${token.kolCount} 位知名 KOL 买入`);
    }

    // Live 1h buy ratio
    if (buyRatio != null) {
      if (buyRatio >= 0.65) {
        momentumScore += 7;
        signals.push(`1h 买盘占比 ${(buyRatio * 100).toFixed(0)}% (多头主导)`);
      } else if (buyRatio >= 0.5) {
        momentumScore += 4;
      } else {
        risks.push(`1h 卖盘偏重 (买盘仅 ${(buyRatio * 100).toFixed(0)}%)`);
      }
    }

    // Price change checks: penalize sudden dump
    if (pcH1 < -35) {
      momentumScore -= 12;
      risks.push(`1h 价格剧烈砸盘 (${pcH1.toFixed(1)}%)`);
    } else if (pcH1 >= 10 && pcH1 <= 150) {
      momentumScore += 5;
      signals.push(`1h 稳健上行 (+${pcH1.toFixed(1)}%)`);
    }

    momentumScore = Math.max(0, Math.min(25, momentumScore));

    // 4. Distribution Score (Max 20 pts)
    let distributionScore = 0;
    const holders = token.tgHolders ?? 0;
    if (holders >= 200) {
      distributionScore += 10;
      signals.push(`持有者去中心化良好 (${holders} 人)`);
    } else if (holders >= 80) {
      distributionScore += 6;
    } else if (holders > 0) {
      distributionScore += 3;
    }

    if (token.fomoCount && token.fomoCount >= 10) {
      distributionScore += 5;
      signals.push(`散户 FOMO 买入活跃 (${token.fomoCount} 笔)`);
    }

    distributionScore = Math.max(0, Math.min(20, distributionScore));

    // 5. Narrative & Social Score (Max 10 pts)
    let narrativeScore = 0;
    if (token.tweetUrl || liveData?.hasTwitter) {
      narrativeScore += 6;
      signals.push("具有推特/X 社区叙事与传播背书");
    }
    if (liveData?.hasWebsite) {
      narrativeScore += 4;
      signals.push("已配置独立官方项目主页");
    }
    narrativeScore = Math.max(0, Math.min(10, narrativeScore));

    const totalScore = Math.min(
      100,
      safetyScore + distributionScore + liquidityScore + momentumScore + narrativeScore,
    );

    let potentialTier = "C";
    if (totalScore >= 80) potentialTier = "S";
    else if (totalScore >= 65) potentialTier = "A";
    else if (totalScore >= 50) potentialTier = "B";

    // Filtering evaluation
    let passedFilter = true;
    let filterReason = "";

    if (totalScore < this.config.minScoreThreshold) {
      passedFilter = false;
      filterReason = `综合评分未达标 (${totalScore} < ${this.config.minScoreThreshold})`;
    } else if (liqUsd < this.config.minLiquidityUsd) {
      passedFilter = false;
      filterReason = `实时流动性未达标 ($${Math.round(liqUsd).toLocaleString()} < $${Math.round(this.config.minLiquidityUsd).toLocaleString()})`;
    } else if (pcH1 < -40) {
      passedFilter = false;
      filterReason = `盘口呈崩盘态势 (1h 涨跌: ${pcH1.toFixed(1)}%)`;
    }

    return {
      token,
      liveData,
      totalScore,
      potentialTier,
      signals,
      risks,
      passedFilter,
      filterReason,
    };
  }
}

/**
 * Fetch and parse messages from a public Telegram channel preview: https://t.me/s/<channel>
 */
export async function fetchChannelMessages(
  channelInput: string,
): Promise<TgMessageParsed[]> {
  const username = cleanChannelUsername(channelInput);
  if (!username) return [];

  const url = `https://t.me/s/${username}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[TgMonitor] Failed to fetch ${url}: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    return parseTelegramWebHtml(html, username);
  } catch (err: any) {
    console.warn(`[TgMonitor] Error fetching channel ${username}:`, err?.message || err);
    return [];
  }
}

/**
 * Clean user channel input to pure username.
 */
export function cleanChannelUsername(input: string): string {
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\/t\.me\/s\//i, "");
  clean = clean.replace(/^https?:\/\/t\.me\//i, "");
  clean = clean.replace(/^@/, "");
  clean = clean.split("/")[0].split("?")[0].trim();
  return clean;
}

/**
 * Parse messages from Telegram Web preview HTML.
 */
export function parseTelegramWebHtml(
  html: string,
  channelUsername: string,
): TgMessageParsed[] {
  const results: TgMessageParsed[] = [];
  const wraps = html.split('class="tgme_widget_message_wrap');

  for (const wrap of wraps) {
    const postIdMatch = wrap.match(/data-post="([^"]+)"/);
    const textMatch = wrap.match(
      /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    const timeMatch = wrap.match(/<time [^>]*datetime="([^"]+)"/);

    if (!postIdMatch || !textMatch) continue;

    const postId = postIdMatch[1];
    const timestamp = timeMatch ? timeMatch[1] : new Date().toISOString();

    // Clean html formatting to text
    let cleanText = textMatch[1].replace(/<br\s*\/?>/gi, "\n");
    cleanText = cleanText.replace(/<[^>]+>/g, "");
    cleanText = decodeHtmlEntities(cleanText).trim();

    // 1. Contract Address (EVM or Solana)
    const evmMatch = cleanText.match(/0x[a-fA-F0-9]{40}/);
    let address = evmMatch ? evmMatch[0] : "";
    if (!address) {
      // Check for Solana base58 (32 - 44 chars)
      const solMatch = cleanText.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
      if (solMatch) address = solMatch[1];
    }
    if (!address) continue; // If no contract address found, skip

    // 2. Token Symbol
    const symbolMatch = cleanText.match(/\$([A-Za-z0-9_]{2,15})/);
    const symbol = symbolMatch ? symbolMatch[1] : "MEME";

    // 3. Chain
    const chainMatch = cleanText.match(/链[\s:：]*([^\n]+)/);
    const chain = chainMatch ? chainMatch[1].trim() : "Unknown";

    // 4. MC
    const mcapMatch = cleanText.match(/市值[\s:：]*([^\n]+)/);
    const tgMcap = mcapMatch ? mcapMatch[1].trim() : undefined;

    // 5. Inflow
    const inflowMatch = cleanText.match(/净流入[\s:：]*([^\n]+)/);
    const tgInflow = inflowMatch ? inflowMatch[1].trim() : undefined;

    // 6. Holders
    const holdersMatch = cleanText.match(/持有者[\s:：]*(\d+)/);
    const tgHolders = holdersMatch ? Number(holdersMatch[1]) : undefined;

    // 7. Duration
    const durationMatch = cleanText.match(/(?:创建|开盘)时长[\s:：]*([^\n]+)/);
    const tgDuration = durationMatch ? durationMatch[1].trim() : undefined;

    // 8. Smart money count
    const smartMatch = cleanText.match(/(\d+)\s*个聪明钱/);
    const smartMoneyCount = smartMatch ? Number(smartMatch[1]) : undefined;

    // 9. KOL count
    const kolMatch = cleanText.match(/(\d+)\s*个\s*KOL/i);
    const kolCount = kolMatch ? Number(kolMatch[1]) : undefined;

    // 10. FOMO count
    const fomoMatch = cleanText.match(/(\d+)\s*个\s*fomo/i);
    const fomoCount = fomoMatch ? Number(fomoMatch[1]) : undefined;

    // 11. Safety
    const safetyMatch = cleanText.match(/安全[\s:：]*([^\n]+)/);
    const tgSafety = safetyMatch ? safetyMatch[1].trim() : undefined;

    // 12. Tweet narrative URL
    const tweetMatch = textMatch[1].match(
      /href="((?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/[^"]+)"/,
    );
    const tweetUrl = tweetMatch ? tweetMatch[1] : undefined;

    results.push({
      postId,
      channel: channelUsername,
      url: `https://t.me/${postId}`,
      symbol,
      chain,
      address,
      tgMcap,
      tgInflow,
      tgHolders,
      tgDuration,
      smartMoneyCount,
      kolCount,
      fomoCount,
      tgSafety,
      tweetUrl,
      timestamp,
      rawText: cleanText,
    });
  }

  return results;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#036;/g, "$")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export const tgMonitorService = TelegramChannelMonitor.getInstance();
