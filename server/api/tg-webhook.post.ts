import { defineEventHandler, readBody, getQuery } from "h3";
import { tgMonitorService } from "../../src/lib/scout/tg-monitor.server";

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    let body: any = null;
    try {
      body = await readBody(event);
    } catch {
      // Body might be raw text or empty
    }

    // Support multiple webhook payload formats:
    // 1. Litehook / Telethon JSON: { text: "...", channel: "bobo9527", message_id: 123 }
    // 2. Telegram Official Webhook: { channel_post: { text: "...", chat: { username: "bobo8567" } } }
    // 3. Simple text or string body: "0x... $MEME"
    // 4. Query params: ?text=...&channel=...

    let text = "";
    let channel = (query.channel as string) || "";
    let postId = (query.postId as string) || (query.message_id as string) || "";
    let timestamp = (query.timestamp as string) || undefined;

    if (typeof body === "string") {
      text = body;
    } else if (body && typeof body === "object") {
      // Telegram bot update format
      const tgMsg = body.channel_post || body.message || body.edited_channel_post;
      if (tgMsg) {
        text = tgMsg.text || tgMsg.caption || "";
        channel = channel || tgMsg.chat?.username || tgMsg.chat?.title || "";
        postId = postId || (tgMsg.message_id ? String(tgMsg.message_id) : "");
        if (tgMsg.date) {
          timestamp = new Date(tgMsg.date * 1000).toISOString();
        }
      } else {
        // Litehook or custom webhook format
        text = body.text || body.message || body.content || body.caption || body.rawText || "";
        channel = channel || body.channel || body.peer || body.channelUsername || body.chat || "";
        postId = postId || (body.message_id ? String(body.message_id) : "") || (body.id ? String(body.id) : "");
        if (body.timestamp || body.date) {
          timestamp = typeof body.date === "number" ? new Date(body.date * 1000).toISOString() : (body.timestamp || body.date);
        }
      }
    }

    if (!text && query.text) {
      text = String(query.text);
    }

    if (!text || text.trim().length === 0) {
      return {
        ok: false,
        error: "缺少消息文本 (请在 POST body 或 query 中提供 text / message 字段)",
        hint: "支持 litehook、Telethon、Telegram Bot Webhook 或自定义 JSON 推送",
        samplePayload: {
          channel: "bobo9527",
          text: "• 代币: GDPair (GDP)\n• CA: 0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e\n• 平台: Barker\n• 链: Robinhood Chain\n• 市值: $18.08K",
        },
      };
    }

    const result = await tgMonitorService.ingestRawMessage({
      text,
      channel,
      postId: postId ? `${channel || "webhook"}/${postId}` : undefined,
      timestamp,
    });

    return {
      ok: result.success,
      message: result.message,
      parsed: result.parsed
        ? {
            symbol: result.parsed.symbol,
            address: result.parsed.address,
            chain: result.parsed.chain,
            channel: result.parsed.channel,
            pushIndex: result.parsed.pushIndex,
            intervalMin: result.parsed.intervalMin,
            volume5mUsd: result.parsed.volume5mUsd,
            top10Pct: result.parsed.top10Pct,
            phishPct: result.parsed.phishPct,
            bundlePct: result.parsed.bundlePct,
            fomo: result.parsed.fomo,
          }
        : undefined,
      evaluation: result.evaluation
        ? {
            totalScore: result.evaluation.totalScore,
            potentialTier: result.evaluation.potentialTier,
            passedFilter: result.evaluation.passedFilter,
            filterReason: result.evaluation.filterReason,
          }
        : undefined,
    };
  } catch (err: any) {
    console.error("[tg-webhook] 处理 webhook 发生异常:", err);
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
});
