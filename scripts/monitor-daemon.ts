/**
 * Robinhood Chain Potential Meme Token Monitor Daemon
 * Continuous real-time scanning with Lark Bot Webhook alerts.
 */

import { runScan } from "../src/lib/scout/scan.server";
import { evaluateMemeToken } from "../src/lib/scout/indicators";
import { DEFAULT_LARK_WEBHOOK_URL, formatMemeAlarmText, sendLarkAlarm } from "../src/lib/scout/lark";

const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || DEFAULT_LARK_WEBHOOK_URL;
const CHECK_INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000);
const MIN_SCORE = Number(process.env.MIN_SCORE || 65);
const MIN_LIQ_USD = Number(process.env.MIN_LIQ || 30_000);
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

const alertedTokens = new Map<string, { time: number; score: number; symbol: string }>();

console.log("\n========================================================");
console.log("🚀 [Robinhood Chain] Potential Meme Token Monitor Daemon");
console.log("========================================================");
console.log(`• Network: Robinhood Chain (ChainId 4663)`);
console.log(`• Interval: ${CHECK_INTERVAL_MS / 1000}s`);
console.log(`• Threshold: Score ≥ ${MIN_SCORE} (A/S-Tier) & Liq ≥ $${MIN_LIQ_USD}`);
console.log(`• Webhook: ${LARK_WEBHOOK_URL.slice(0, 45)}...`);
console.log(`• Prefix: ** (Strict requirement verified)`);
console.log("========================================================\n");

async function runScanCycle() {
  const nowStr = new Date().toLocaleTimeString("zh-CN");
  process.stdout.write(`[${nowStr}] 正在扫描 Robinhood 链上最新代币与池子... `);

  try {
    const result = await runScan(true);
    const candidates = result.candidates || [];
    process.stdout.write(`完成 (共检出 ${candidates.length} 个代币)\n`);

    let newAlarms = 0;
    for (const c of candidates) {
      const ind = c.indicators || evaluateMemeToken(c, null);
      const isPotential =
        (ind.isPotentialAlarm || ind.totalScore >= MIN_SCORE || c.verdict === "ALERT") &&
        ind.isLpLocked &&
        (c.liquidityUsd || 0) >= MIN_LIQ_USD;

      if (!isPotential) continue;

      const key = c.address.toLowerCase();
      const prev = alertedTokens.get(key);
      const now = Date.now();

      if (prev && now - prev.time < COOLDOWN_MS && ind.totalScore - prev.score < 15) {
        continue; // In cooldown
      }

      console.log(`\n🔥 发现高潜力代币! $${c.symbol} (${c.name}) - 得分: ${ind.totalScore} [${ind.potentialTier}-Tier]`);
      const sendRes = await sendLarkAlarm(c, ind, LARK_WEBHOOK_URL);

      if (sendRes.ok) {
        console.log(`✅ [飞书推送成功] 已通知群聊: $${c.symbol}`);
      } else {
        console.warn(`⚠️ [飞书推送警告] ${sendRes.msg || sendRes.error}`);
      }

      alertedTokens.set(key, { time: now, score: ind.totalScore, symbol: c.symbol });
      newAlarms++;
    }

    if (newAlarms > 0) {
      console.log(`✨ 本轮共触发 ${newAlarms} 条新高潜力代币告警\n`);
    }
  } catch (err: any) {
    process.stdout.write(`异常: ${err?.message || String(err)}\n`);
  }
}

// Initial run
runScanCycle().catch(console.error);

// Loop
setInterval(() => {
  runScanCycle().catch(console.error);
}, CHECK_INTERVAL_MS);
