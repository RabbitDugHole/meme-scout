import assert from "node:assert/strict";
import test from "node:test";
import { formatTgMemeAlarmText } from "./lark.ts";
import { cleanChannelUsername, parseTelegramWebHtml, parseTelegramPostText, tgMonitorService, DEFAULT_TG_CHANNELS } from "./tg-monitor.server.ts";
import { tradeService } from "./trade.server.ts";
import { lpService } from "./lp.server.ts";
import { backtestEngine } from "./backtest.server.ts";
import type { TgTokenEvaluation } from "./types.ts";

test("cleanChannelUsername should normalize URLs and usernames", () => {
  assert.equal(cleanChannelUsername("lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("@lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/s/lanniaohui"), "lanniaohui");
  assert.equal(cleanChannelUsername("https://t.me/lanniaohui?param=1"), "lanniaohui");
});

test("default TG channels include ARC bobo9632 and webhook-only bobo9527", () => {
  const usernames = DEFAULT_TG_CHANNELS.map((c) => c.username);
  assert.ok(usernames.includes("bobo9632"));
  const bsc = DEFAULT_TG_CHANNELS.find((c) => c.username === "bobo9527");
  assert.equal(bsc?.webhookOnly, true);
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

test("parseTelegramWebHtml should correctly parse bobo8567 Robinhood channel format", () => {
  const sampleBoboHtml = `
    <div class="tgme_widget_message_wrap js-widget_message_wrap" id="widget_message_6745">
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="bobo8567/6745">
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          🔥 【第 1 次推送】 🔥<br>
          • 代币: GDPair (GDP)<br>
          • 平台: 🚀 Pons<br>
          • CA: 0x7d2c34f8be61ae93cce3d408007f73fb3a4e7cfb<br>
          • 战壕存活: 1分钟前<br>
          • 5分钟交易量: $18.08K<br>
          ————————————————————<br>
          💰 起推市值: $74.28K<br>
          • 第 1 次首推<br>
          ————————————————————<br>
          👥 筹码透析:<br>
          • Top 10 持仓占比: 34.8% (🟢 分散度健康)<br>
          • 钓鱼钱包: 0.2%<br>
          • 老鼠仓偷跑比例: 0%<br>
          • 蜜罐风险: 🟢 正常 | 税率: 0%<br>
          • 开发者持仓: 0%
        </div>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <time datetime="2026-09-15T03:00:00+00:00" class="time">03:00</time>
        </div>
      </div>
    </div>
  `;

  const results = parseTelegramWebHtml(sampleBoboHtml, "bobo8567");
  assert.equal(results.length, 1);
  const item = results[0];
  assert.equal(item.postId, "bobo8567/6745");
  assert.equal(item.symbol, "GDP");
  assert.equal(item.name, "GDPair");
  assert.equal(item.chain, "Robinhood Chain");
  assert.equal(item.address, "0x7d2c34f8be61ae93cce3d408007f73fb3a4e7cfb");
  assert.equal(item.volume5mUsd, 18080);
  assert.equal(item.top10Pct, 34.8);
  assert.equal(item.pushIndex, 1);
  assert.equal(item.phishPct, 0.2);
  assert.equal(item.bundlePct, 0);
  assert.ok(item.tgSafety?.includes("正常"), "tgSafety should detect honeypot normal");
});

test("parseTelegramPostText should parse raw text from litehook or bot push for bobo9527 BSC channel", () => {
  const rawText = `
🔥 【BSC 聪明钱跟买】 🔥
• 代币: BabyDoge (BABYDOGE)
• 链: BSC
• CA: 0xc748673057861a797275CD8A068AbB452456a329
• 5分钟交易量: $50.5K
• 市值: $1.2M
• 3个聪明钱已买入，2个KOL跟进
• Top 10 持仓占比: 28.5%
• 安全: 蜜罐风险: 🟢 正常 | 税率: 0%
  `.trim();

  const parsed = parseTelegramPostText(rawText, "bobo9527", "bobo9527/99881");
  assert.ok(parsed, "Parsed result must not be null");
  assert.equal(parsed.symbol, "BABYDOGE");
  assert.equal(parsed.address, "0xc748673057861a797275CD8A068AbB452456a329");
  assert.equal(parsed.chain, "BSC");
  assert.equal(parsed.volume5mUsd, 50500);
  assert.equal(parsed.smartMoneyCount, 3);
  assert.equal(parsed.kolCount, 2);
  assert.equal(parsed.top10Pct, 28.5);
  assert.equal(parsed.channel, "bobo9527");
});

test("parseTelegramPostText maps bobo9632 Argus cards off Robinhood and reads FOMO ladder fields", () => {
  const rawText = `
🔥 【第三次推送】 🔥
• 代币: Scout (SCOUT)
• 平台: Argus
• CA: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
• 5分钟交易量: $40.2K
• 跟推间隔: 12.5 分钟
• Top 10 持仓占比: 28.1%
• 钓鱼钱包: 1.1%
• 老鼠仓偷跑比例: 2%
  `.trim();

  const parsed = parseTelegramPostText(rawText, "bobo9632", "bobo9632/12");
  assert.ok(parsed);
  assert.equal(parsed.chain, "Argus");
  assert.equal(parsed.pushIndex, 3);
  assert.equal(parsed.intervalMin, 12.5);
  assert.equal(parsed.volume5mUsd, 40200);
  assert.equal(parsed.top10Pct, 28.1);
  assert.equal(parsed.phishPct, 1.1);
  assert.equal(parsed.bundlePct, 2);
  assert.equal(parsed.address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("tgMonitorService.ingestRawMessage should successfully process webhook message", async () => {
  const rawText = `
🔥 【Robinhood 早期异动】 🔥
• 代币: TestRocket (ROCKET)
• 平台: Barker
• 链: Robinhood Chain
• CA: 0x9999999999999999999999999999999999999999
• 5分钟交易量: $30.0K
• 市值: $90.0K
• 5个聪明钱已介入
• Top 10 持仓占比: 25.0%
  `.trim();

  const res = await tgMonitorService.ingestRawMessage({
    text: rawText,
    channel: "bobo8567",
    postId: `test-post-${Date.now()}`,
  });

  assert.equal(res.success, true, "Webhook ingestion should succeed");
  assert.ok(res.parsed);
  assert.equal(res.parsed.symbol, "ROCKET");
  assert.equal(res.parsed.address, "0x9999999999999999999999999999999999999999");
  assert.equal(res.parsed.chain, "Robinhood Chain");
  tgMonitorService.stop();
  tradeService.stop();
  lpService.stop();
  backtestEngine.stop();
});
