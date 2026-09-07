import type { Candidate } from "./types";
import type { MemeIndicators } from "./indicators";

export const DEFAULT_LARK_WEBHOOK_URL =
  "https://open.larksuite.com/open-apis/bot/v2/hook/83c6bf4e-7202-4ab2-be02-4b638b51f587";

export type LarkSendResult = {
  ok: boolean;
  code?: number;
  msg?: string;
  error?: string;
  timestamp: string;
};

/**
 * Format Lark alarm message text.
 * CRITICAL REQUIREMENT: Must strictly begin with prefix: **
 */
export function formatMemeAlarmText(
  candidate: Candidate,
  indicators: MemeIndicators,
): string {
  const tierEmoji = {
    S: "🌟【S-Tier 极高潜力】",
    A: "🚀【A-Tier 强劲动力】",
    B: "⚡【B-Tier 早期观察】",
    C: "⚠️【C-Tier 谨慎观望】",
    RUG: "⛔【高危代币】",
  }[indicators.potentialTier];

  const posTier = candidate.tier
    ? `Tier ${candidate.tier} ($${candidate.tier === 1 ? 10 : candidate.tier === 2 ? 30 : 60} 仓位建议)`
    : "暂无标准建议 (观察仓)";

  const priceStr =
    candidate.priceUsd != null
      ? candidate.priceUsd < 0.0001
        ? `$${candidate.priceUsd.toExponential(3)}`
        : `$${candidate.priceUsd.toFixed(6)}`
      : "待更新";

  const mcapStr =
    candidate.mcapUsd != null
      ? `$${Math.round(candidate.mcapUsd).toLocaleString()}`
      : "未知";

  const liqStr =
    candidate.liquidityUsd != null
      ? `$${Math.round(candidate.liquidityUsd).toLocaleString()}`
      : "未知";

  const vol1hStr =
    candidate.volumeH1 != null
      ? `$${Math.round(candidate.volumeH1).toLocaleString()}`
      : "未知";

  const pcH1Str =
    candidate.priceChangeH1 != null
      ? `${candidate.priceChangeH1 >= 0 ? "+" : ""}${candidate.priceChangeH1.toFixed(1)}%`
      : "未知";

  const buyRatioStr =
    indicators.buyRatio1h != null
      ? `${(indicators.buyRatio1h * 100).toFixed(1)}% (${indicators.buyCount1h}买 / ${indicators.sellCount1h}卖)`
      : "未知";

  const top10Str =
    candidate.top10ExLp != null
      ? `${(candidate.top10ExLp * 100).toFixed(1)}%`
      : "未知";

  const signalsList =
    indicators.signals.length > 0
      ? indicators.signals.map((s) => `  ✓ ${s}`).join("\n")
      : "  - 暂无显著正面信号";

  const risksList =
    indicators.risks.length > 0
      ? indicators.risks.map((r) => `  ! ${r}`).join("\n")
      : "  ✓ 未检出明显硬性漏洞";

  // Strict prefix: **
  return `** 🚨【Robinhood Chain 潜力 Meme 币雷达告警】🚨

💎 代币标的: $${candidate.symbol} (${candidate.name})
🎯 潜力评级: ${tierEmoji} (综合得分: ${indicators.totalScore}/100)
💼 策略仓位: ${posTier}
━━━━━━━━━━━━━━━━━━━
📋【合约地址 CA - 独立单行/长按或双击一键复制】:

${candidate.address}

━━━━━━━━━━━━━━━━━━━
💰 核心盘口数据:
• 现价: ${priceStr} (1h 涨跌: ${pcH1Str})
• 市值 (MCap): ${mcapStr}
• 流动性 (LP): ${liqStr} (资金池占比: ${indicators.liquidityMcapRatio ? (indicators.liquidityMcapRatio * 100).toFixed(1) + "%" : "未知"})
• 1h 交易量: ${vol1hStr} (换手率: ${indicators.volLiqRatio1h ? (indicators.volLiqRatio1h * 100).toFixed(0) + "%" : "未知"})
• 1h 买卖单: ${buyRatioStr}

🛡️ 链上安全与持仓:
• LP 锁定状态: ${indicators.isLpLocked ? "100% 已锁定/销毁 🔒" : "⚠️ 未锁定"}
• 持币人数: ${indicators.holders ?? "未知"} 人
• 前十大持仓 (除LP): ${top10Str}
• 增发/暂停后门: ${indicators.isMintDisabled ? "无后门 (安全)" : "⚠️ 需留意权限"}
• 聪明钱介入: 2h 内 ${indicators.smartBuyersCount} 笔 ≥$200 买入代理

✨ 关键亮点:
${signalsList}

⚠️ 风险提示:
${risksList}

━━━━━━━━━━━━━━━━━━━
🌐 快捷查阅通道:
• DexScreener: ${candidate.dexUrl ?? `https://dexscreener.com/robinhood/${candidate.address}`}
• 区块浏览器: ${candidate.explorerUrl}
• Pons 发射台: ${candidate.ponsUrl}
${candidate.tweetUrl ? `• 官方推特/X: ${candidate.tweetUrl}` : ""}

⚡ 提示: RH Chain 早期代币波动剧烈，机器人只做雷达探测，绝不下单，请严控风险！`;
}

/**
 * Send alert message to Lark Bot webhook.
 */
export async function sendLarkAlarm(
  candidate: Candidate,
  indicators: MemeIndicators,
  webhookUrl: string = DEFAULT_LARK_WEBHOOK_URL,
): Promise<LarkSendResult> {
  const timestamp = new Date().toISOString();
  const text = formatMemeAlarmText(candidate, indicators);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.code === 0 || data.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    return {
      ok: false,
      code: data.code ?? data.StatusCode ?? res.status,
      msg: data.msg ?? data.StatusMessage ?? res.statusText,
      timestamp,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      timestamp,
    };
  }
}

/**
 * Send a verification test message to the Lark webhook.
 * CRITICAL REQUIREMENT: Must strictly begin with prefix: **
 */
export async function sendLarkTestMessage(
  webhookUrl: string = DEFAULT_LARK_WEBHOOK_URL,
): Promise<LarkSendResult> {
  const timestamp = new Date().toISOString();
  const text = `** 🔔【Robinhood Chain Meme Scout】Lark 告警机器人连通性测试成功！
• 监控网络: Robinhood Chain (ChainId 4663)
• 告警规则: 潜力 Meme 代币五维模型 (安全 / 流动性 / 筹码 / 动量 / 叙事)
• 测试时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
• 状态: 实时自动化监控就绪，发现高潜力币种将自动推送！`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.code === 0 || data.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    return {
      ok: false,
      code: data.code ?? data.StatusCode ?? res.status,
      msg: data.msg ?? data.StatusMessage ?? res.statusText,
      timestamp,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      timestamp,
    };
  }
}
