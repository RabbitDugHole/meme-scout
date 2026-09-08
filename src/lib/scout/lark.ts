import type { Candidate, TgTokenEvaluation } from "./types";
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
📋【合约地址 CA - 独立代码块 / 点击快速复制】:
\`\`\`bash
${candidate.address}
\`\`\`
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
 * Format Lark interactive card payload.
 * CRITICAL REQUIREMENT: Title must strictly begin with prefix: **
 * The markdown code block renders a native 1-click [📋 复制] button in Lark.
 */
export function formatMemeAlarmCard(
  candidate: Candidate,
  indicators: MemeIndicators,
): Record<string, any> {
  const tierEmoji = {
    S: "🌟 S-Tier 极高潜力",
    A: "🚀 A-Tier 强劲动力",
    B: "⚡ B-Tier 早期观察",
    C: "⚠️ C-Tier 谨慎观望",
    RUG: "⛔ 高危代币",
  }[indicators.potentialTier];

  const posTier = candidate.tier
    ? `Tier ${candidate.tier} ($${candidate.tier === 1 ? 10 : candidate.tier === 2 ? 30 : 60} 仓位建议)`
    : "暂无标准建议 (轻仓观察)";

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

  const actions: Array<{
    tag: string;
    text: { tag: string; content: string };
    type: string;
    url: string;
  }> = [
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📈 DexScreener",
      },
      type: "primary",
      url:
        candidate.dexUrl ??
        `https://dexscreener.com/robinhood/${candidate.address}`,
    },
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🔍 区块浏览器",
      },
      type: "default",
      url: candidate.explorerUrl,
    },
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🚀 Pons 发射台",
      },
      type: "default",
      url: candidate.ponsUrl,
    },
  ];

  if (candidate.tweetUrl) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🐦 官方推特/X",
      },
      type: "default",
      url: candidate.tweetUrl,
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: `** 🚨【RH 潜力 Meme 告警】$${candidate.symbol} (${candidate.name}) - ${indicators.totalScore}分`,
      },
      template: indicators.totalScore >= 80 ? "carmine" : "orange",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**🎯 潜力评级**: ${tierEmoji} (综合得分: **${indicators.totalScore}**/100)\n**💼 策略仓位**: ${posTier}`,
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**📋 合约地址 CA (独立代码块 / 点击快速复制):**",
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `\`\`\`bash\n${candidate.address}\n\`\`\``,
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**💰 核心盘口数据:**\n• 现价: **${priceStr}** (1h 涨跌: **${pcH1Str}**)\n• 市值 (MCap): **${mcapStr}** | 流动性 (LP): **${liqStr}**\n• 资金池占比: ${indicators.liquidityMcapRatio ? (indicators.liquidityMcapRatio * 100).toFixed(1) + "%" : "未知"} | 1h 换手率: ${indicators.volLiqRatio1h ? (indicators.volLiqRatio1h * 100).toFixed(0) + "%" : "未知"}\n• 1h 交易量: ${vol1hStr} | 1h 买卖单: **${buyRatioStr}**\n\n**🛡️ 链上安全与持仓:**\n• LP 锁定: ${indicators.isLpLocked ? "100% 已锁定/销毁 🔒" : "⚠️ 未锁定"}\n• 持币人数: ${indicators.holders ?? "未知"} 人 | 前十大持仓 (除LP): ${top10Str}\n• 增发/暂停后门: ${indicators.isMintDisabled ? "无后门 (安全)" : "⚠️ 需留意权限"}\n• 聪明钱动向: 2h 内 **${indicators.smartBuyersCount}** 笔 ≥$200 买入\n\n**✨ 关键亮点:**\n${signalsList}\n\n**⚠️ 风险提示:**\n${risksList}`,
        },
      },
      {
        tag: "action",
        actions,
      },
      {
        tag: "hr",
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content:
              "⚡ RH Chain 早期代币波动剧烈，机器人仅做客观数据监测与雷达预警，不构成任何投资建议。",
          },
        ],
      },
    ],
  };
}

/**
 * Send alert message to Lark Bot webhook.
 * Prefers Interactive Card (with native copy button), fallbacks to text if needed.
 */
export async function sendLarkAlarm(
  candidate: Candidate,
  indicators: MemeIndicators,
  webhookUrl: string = DEFAULT_LARK_WEBHOOK_URL,
): Promise<LarkSendResult> {
  const timestamp = new Date().toISOString();
  const card = formatMemeAlarmCard(candidate, indicators);
  const textFallback = formatMemeAlarmText(candidate, indicators);

  try {
    // 1. Try sending interactive card first (provides 1-click copy button)
    const cardRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        card,
      }),
    });

    const cardData = await cardRes.json().catch(() => ({}));
    if (cardRes.ok && (cardData.code === 0 || cardData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    // 2. Fallback to standard text message if interactive card fails
    console.warn("[Lark] Interactive card send failed, trying text fallback:", cardData);
    const textRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text: textFallback,
        },
      }),
    });

    const textData = await textRes.json().catch(() => ({}));
    if (textRes.ok && (textData.code === 0 || textData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    return {
      ok: false,
      code: textData.code ?? textData.StatusCode ?? textRes.status,
      msg: textData.msg ?? textData.StatusMessage ?? textRes.statusText,
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
  const testAddress = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";

  try {
    // 1. Interactive card test
    const cardRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          header: {
            title: {
              tag: "plain_text",
              content: "** 🔔【Robinhood Chain Meme Scout】告警与快捷复制测试",
            },
            template: "blue",
          },
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `• **监控网络**: Robinhood Chain (ChainId 4663)\n• **告警规则**: 综合评分 ≥ 80 分 (S-Tier) 且 LP 锁定\n• **测试时间**: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n• **状态**: 自动化监控就绪`,
              },
            },
            {
              tag: "hr",
            },
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: "**📋 测试代币合约 (独立代码块 / 点击快速复制):**",
              },
            },
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `\`\`\`bash\n${testAddress}\n\`\`\``,
              },
            },
            {
              tag: "note",
              elements: [
                {
                  tag: "plain_text",
                  content: "提示: 飞书/Lark 支持在代码框右上角点击一键复制纯合约地址。",
                },
              ],
            },
          ],
        },
      }),
    });

    const cardData = await cardRes.json().catch(() => ({}));
    if (cardRes.ok && (cardData.code === 0 || cardData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    // 2. Fallback text test
    const textRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text: `** 🔔【Robinhood Chain Meme Scout】Lark 告警机器人连通性测试成功！\n• 监控规则: 综合评分 ≥ 80 分 (S-Tier)\n• 测试地址:\n\`\`\`text\n${testAddress}\n\`\`\`\n• 时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        },
      }),
    });

    const textData = await textRes.json().catch(() => ({}));
    if (textRes.ok && (textData.code === 0 || textData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    return {
      ok: false,
      code: textData.code ?? textData.StatusCode ?? textRes.status,
      msg: textData.msg ?? textData.StatusMessage ?? textRes.statusText,
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
 * Format Lark alarm message text for Telegram-sourced meme tokens.
 * CRITICAL REQUIREMENT: Must strictly begin with prefix: **
 */
export function formatTgMemeAlarmText(evaluation: TgTokenEvaluation): string {
  const { token, liveData, totalScore, potentialTier, signals, risks } = evaluation;

  const priceStr =
    liveData?.priceUsd != null
      ? liveData.priceUsd < 0.0001
        ? `$${liveData.priceUsd.toExponential(3)}`
        : `$${liveData.priceUsd.toFixed(6)}`
      : "待更新";

  const mcapStr =
    liveData?.mcapUsd != null
      ? `$${Math.round(liveData.mcapUsd).toLocaleString()}`
      : token.tgMcap || "未知";

  const liqStr =
    liveData?.liquidityUsd != null
      ? `$${Math.round(liveData.liquidityUsd).toLocaleString()}`
      : "未知";

  const pcH1Str =
    liveData?.priceChangeH1 != null
      ? `${liveData.priceChangeH1 >= 0 ? "+" : ""}${liveData.priceChangeH1.toFixed(1)}%`
      : "未知";

  const signalsList =
    signals.length > 0
      ? signals.map((s) => `  ✓ ${s}`).join("\n")
      : "  - 暂无显著正面信号";

  const risksList =
    risks.length > 0
      ? risks.map((r) => `  ! ${r}`).join("\n")
      : "  ✓ 未检出明显硬性漏洞";

  return `** 🚨【TG 热门 Meme 二次研判告警】🚨

💎 代币标的: $${token.symbol} (链: ${token.chain})
🎯 研判评级: 【${potentialTier}-Tier】(综合得分: ${totalScore}/100)
📡 情报来源: Telegram【@${token.channel}】(${token.url})
━━━━━━━━━━━━━━━━━━━
📋【合约地址 CA - 独立代码块 / 点击快速复制】:
\`\`\`bash
${token.address}
\`\`\`
${token.address}

━━━━━━━━━━━━━━━━━━━
💰 DEX 实时盘口数据:
• 现价: ${priceStr} (1h 涨跌: ${pcH1Str})
• 实时流动性 (LP): ${liqStr} | 实时市值: ${mcapStr}
• 1h 交易量: ${liveData?.volumeH1 != null ? `$${Math.round(liveData.volumeH1).toLocaleString()}` : "未知"}

📢 TG 原始情报参考:
• 聪明钱: ${token.smartMoneyCount ?? "未知"} 个同买 | KOL: ${token.kolCount ?? "未知"} 个
• 原文报告市值: ${token.tgMcap || "未知"} | 净流入: ${token.tgInflow || "未知"}
• 安全提示: ${token.tgSafety || "未标注"}

✨ 研判亮点:
${signalsList}

⚠️ 风险提示:
${risksList}

🌐 查阅: ${liveData?.dexUrl ?? `https://dexscreener.com/search?q=${token.address}`}
⚡ 提示: TG 热门代币波动剧烈，机器人仅做客观数据监测与雷达预警，不构成任何投资建议。`;
}

/**
 * Format Lark interactive card payload for Telegram-sourced meme tokens.
 * CRITICAL REQUIREMENT: Title must strictly begin with prefix: **
 */
export function formatTgMemeAlarmCard(
  evaluation: TgTokenEvaluation,
): Record<string, any> {
  const { token, liveData, totalScore, potentialTier, signals, risks } = evaluation;

  const tierEmoji = {
    S: "🌟 S-Tier 极高潜力",
    A: "🚀 A-Tier 强劲动力",
    B: "⚡ B-Tier 早期观察",
    C: "⚠️ C-Tier 谨慎观望",
    RUG: "⛔ 高危代币",
  }[potentialTier as "S" | "A" | "B" | "C" | "RUG"] || "⚡ 潜力代币";

  const priceStr =
    liveData?.priceUsd != null
      ? liveData.priceUsd < 0.0001
        ? `$${liveData.priceUsd.toExponential(3)}`
        : `$${liveData.priceUsd.toFixed(6)}`
      : "待更新";

  const mcapStr =
    liveData?.mcapUsd != null
      ? `$${Math.round(liveData.mcapUsd).toLocaleString()}`
      : token.tgMcap || "未知";

  const liqStr =
    liveData?.liquidityUsd != null
      ? `$${Math.round(liveData.liquidityUsd).toLocaleString()}`
      : "未知";

  const vol1hStr =
    liveData?.volumeH1 != null
      ? `$${Math.round(liveData.volumeH1).toLocaleString()}`
      : "未知";

  const pcH1Str =
    liveData?.priceChangeH1 != null
      ? `${liveData.priceChangeH1 >= 0 ? "+" : ""}${liveData.priceChangeH1.toFixed(1)}%`
      : "未知";

  const buysH1 = liveData?.buysH1 ?? 0;
  const sellsH1 = liveData?.sellsH1 ?? 0;
  const totalTxns = buysH1 + sellsH1;
  const buyRatioStr =
    totalTxns > 0
      ? `${((buysH1 / totalTxns) * 100).toFixed(1)}% (${buysH1}买 / ${sellsH1}卖)`
      : "暂无数据";

  const signalsList =
    signals.length > 0
      ? signals.map((s) => `  ✓ ${s}`).join("\n")
      : "  - 暂无显著正面信号";

  const risksList =
    risks.length > 0
      ? risks.map((r) => `  ! ${r}`).join("\n")
      : "  ✓ 未检出明显硬性漏洞";

  const actions: Array<{
    tag: string;
    text: { tag: string; content: string };
    type: string;
    url: string;
  }> = [];

  if (liveData?.dexUrl) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📈 DexScreener",
      },
      type: "primary",
      url: liveData.dexUrl,
    });
  } else {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📈 DexScreener",
      },
      type: "primary",
      url: `https://dexscreener.com/search?q=${token.address}`,
    });
  }

  const isBsc =
    token.chain.toLowerCase().includes("bsc") ||
    token.chain.toLowerCase().includes("bnb");
  const isSol = token.chain.toLowerCase().includes("solana");
  const isRh = token.chain.toLowerCase().includes("robinhood");

  if (isRh) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🔍 RH 浏览器",
      },
      type: "default",
      url: `https://robinhoodchain.blockscout.com/token/${token.address}`,
    });
  } else if (isBsc) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🦅 GMGN 盘口",
      },
      type: "default",
      url: `https://gmgn.ai/bsc/token/${token.address}`,
    });
  } else if (isSol) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🦅 GMGN 盘口",
      },
      type: "default",
      url: `https://gmgn.ai/sol/token/${token.address}`,
    });
  }

  actions.push({
    tag: "button",
    text: {
      tag: "plain_text",
      content: "✈️ TG 原始消息",
    },
    type: "default",
    url: token.url,
  });

  if (token.tweetUrl) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "🐦 叙事推特/X",
      },
      type: "default",
      url: token.tweetUrl,
    });
  }

  const smartLine =
    token.smartMoneyCount != null
      ? `• 聪明钱动向: **${token.smartMoneyCount}** 个同买 | **${token.kolCount ?? 0}** 个 KOL | **${token.fomoCount ?? 0}** 个 FOMO`
      : "";

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: `** 🚨【TG 热门 Meme 二次研判】$${token.symbol} (${token.chain}) - ${totalScore}分`,
      },
      template: totalScore >= 80 ? "carmine" : "orange",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `📡 **情报源**: Telegram【@${token.channel}】\n🎯 **研判评级**: ${tierEmoji} (综合得分: **${totalScore}**/100)\n⛓️ **所属公链**: **${token.chain}**`,
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**📋 合约地址 CA (独立代码块 / 点击快速复制):**",
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `\`\`\`bash\n${token.address}\n\`\`\``,
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💰 **DEX 实时盘口数据:**\n• 现价: **${priceStr}** (1h 涨跌: **${pcH1Str}**)\n• 实时流动性 (LP): **${liqStr}** | 市值 (MCap): **${mcapStr}**\n• 1h 交易量: ${vol1hStr} | 1h 买卖单: **${buyRatioStr}**\n\n📢 **TG 原始情报记录:**\n${smartLine}\n• 原文报告市值: ${token.tgMcap || "未知"} | 净流入: ${token.tgInflow || "未知"}\n• 报告持有者: ${token.tgHolders ?? "未知"} 人 | 开盘时长: ${token.tgDuration || "未知"}\n• 渠道安全评估: ${token.tgSafety || "未标注"}\n\n✨ **系统研判亮点:**\n${signalsList}\n\n⚠️ **风险提示:**\n${risksList}`,
        },
      },
      {
        tag: "action",
        actions,
      },
      {
        tag: "hr",
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content:
              "⚡ 提示: TG 热门频道消息已由 Meme Scout 经过实时池子深度与盘口动量二次研判，请严控风险！",
          },
        ],
      },
    ],
  };
}

/**
 * Send TG-sourced meme token alarm to Lark Bot webhook.
 */
export async function sendLarkTgAlarm(
  evaluation: TgTokenEvaluation,
  webhookUrl: string = DEFAULT_LARK_WEBHOOK_URL,
): Promise<LarkSendResult> {
  const timestamp = new Date().toISOString();
  const card = formatTgMemeAlarmCard(evaluation);
  const textFallback = formatTgMemeAlarmText(evaluation);

  try {
    // 1. Try sending interactive card first
    const cardRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        card,
      }),
    });

    const cardData = await cardRes.json().catch(() => ({}));
    if (cardRes.ok && (cardData.code === 0 || cardData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    // 2. Fallback to text message
    console.warn("[Lark] TG interactive card failed, trying text fallback:", cardData);
    const textRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: {
          text: textFallback,
        },
      }),
    });

    const textData = await textRes.json().catch(() => ({}));
    if (textRes.ok && (textData.code === 0 || textData.StatusCode === 0)) {
      return {
        ok: true,
        code: 0,
        msg: "success",
        timestamp,
      };
    }

    return {
      ok: false,
      code: textData.code ?? textData.StatusCode ?? textRes.status,
      msg: textData.msg ?? textData.StatusMessage ?? textRes.statusText,
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

