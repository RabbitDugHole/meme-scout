import assert from "node:assert/strict";
import test from "node:test";
import { formatTgMemeAlarmText } from "./lark.ts";
import { cleanChannelUsername, parseTelegramWebHtml } from "./tg-monitor.server.ts";
import type { TgTokenEvaluation } from "./types.ts";

test("cleanChannelUsername should normalize URLs and usernames", () => {
  assert.equal(cleanChannelUsername("lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("@lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/s/lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/lanniaohui?param=1"), "lanniaohui");
});

test("parseTelegramWebHtml should correctly parse post data from HTML", () => {
  const sampleHtml = `
    <div class="tgme_widget_message_wrap js-widget_message_wrap" id="widget_message_15468">
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="lanniaohui/15468">
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🔥 $PEPE (Pepe The Frog)<br>
          ⛓️ 链: Robinhood<br>
          💰 市值: $120.5K<br>
          ⏱️ 创建时长: 35分钟<br>
          📊 净流入: +$32.5K<br>
          👥 持有者: 350<br>
          📄 合约: 0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e<br>
          🛡️ 安全: S级, LP已锁销, 老鼠仓/捆绑0%<br>
          💡 3个聪明钱已介入，1个KOL跟买<br>
          📖 叙事: <a href="https://x.com/pepe_coin/status/123456789">推特叙事</a>
        </div>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <a class="tgme_widget_message_date" href="https://t.me/lanniaohui/15468">
            <time datetime="2026-09-08T15:30:00+00:00" class="time">15:30</time>
          </a>
        </div>
      </div>
    </div>
  `;

  const results = parseTelegramWebHtml(sampleHtml, "lanniaohui");
  assert.equal(results.length, 1);
  const item = results[0];
  assert.equal(item.postId, "lanniaohui/15468");
  assert.equal(item.symbol, "PEPE");
  assert.equal(item.chain, "Robinhood");
  assert.equal(item.address, "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e");
  assert.equal(item.tgHolders, 350);
  assert.equal(item.smartMoneyCount, 3);
  assert.equal(item.kolCount, 1);
  assert.equal(item.tweetUrl, "https://x.com/pepe_coin/status/123456789");
});

test("formatTgMemeAlarmText should strictly start with ** and contain bash CA block", () => {
  const mockEval: TgTokenEvaluation = {
    token: {
      postId: "lanniaohui/15468",
      channel: "lanniaohui",
      url: "https://t.me/lanniaohui/15468",
      symbol: "TEST",
      chain: "Robinhood",
      address: "0x1234567890123456789012345678901234567890",
      tgMcap: "$150K",
      tgInflow: "+$40K",
      tgHolders: 420,
      tgDuration: "25分钟",
      smartMoneyCount: 5,
      kolCount: 2,
      tgSafety: "S级 LP已锁",
      tweetUrl: "https://x.com/test",
      timestamp: new Date().toISOString(),
      rawText: "Mock TG Text",
    },
    liveData: {
      priceUsd: 0.0012,
      mcapUsd: 120000,
      liquidityUsd: 35000,
      volumeH1: 28000,
      priceChangeH1: 25.5,
      buysH1: 45,
      sellsH1: 15,
      dexUrl: "https://dexscreener.com/test",
      pairAddress: "0xabc",
      hasTwitter: true,
      hasWebsite: true,
    },
    totalScore: 88,
    potentialTier: "S",
    signals: ["LP 已锁销", "5 个聪明钱介入", "1h 买盘占比 75%"],
    risks: [],
    passedFilter: true,
    filterReason: "",
  };

  const text = formatTgMemeAlarmText(mockEval);

  // 1. Must start with **
  assert.ok(text.startsWith("**"), "Alarm text must strictly start with **");

  // 2. Must contain the contract address in a bash code block
  assert.ok(
    text.includes("```bash\n0x1234567890123456789012345678901234567890\n```"),
    "Must format contract address in standalone bash code block",
  );

  // 3. Must contain channel info and score
  assert.ok(text.includes("@lanniaohui"), "Must mention channel");
  assert.ok(text.includes("88/100"), "Must include score");
});
