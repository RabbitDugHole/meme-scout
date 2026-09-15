import { defineEventHandler, getQuery } from "h3";
import { tgMonitorService } from "../../src/lib/scout/tg-monitor.server";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const text = query.text as string | undefined;

  if (text) {
    // Allows testing via browser or curl GET
    const channel = (query.channel as string) || "tg_webhook";
    const result = await tgMonitorService.ingestRawMessage({
      text,
      channel,
      postId: query.postId ? `${channel}/${query.postId}` : undefined,
    });
    return {
      ok: result.success,
      message: result.message,
      data: result,
    };
  }

  // Health / documentation check
  return {
    status: "online",
    service: "Telegram Channel Webhook Receiver",
    endpoint: "/api/tg-webhook",
    methods: ["POST", "GET"],
    usage: {
      post: "向 /api/tg-webhook 发送 JSON 数据: { text: string, channel?: string, message_id?: number }",
      get: "向 /api/tg-webhook?text=...&channel=... 测试接收",
      compatibleSources: ["litehook", "Telethon (Python Userbot)", "Telegram Bot Webhook", "Curl / Custom Script"],
    },
    state: {
      tgMonitorRunning: tgMonitorService.getState().isRunning,
      parsedMessagesCount: tgMonitorService.getState().parsedMessagesCount,
      evaluatedTokensCount: tgMonitorService.getState().evaluatedTokensCount,
    },
  };
});
