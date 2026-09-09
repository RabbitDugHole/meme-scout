import { monitorService } from "../../src/lib/scout/monitor.server";
import { tgMonitorService } from "../../src/lib/scout/tg-monitor.server";
import { backtestEngine } from "../../src/lib/scout/backtest.server";

export default function () {
  console.log("🚀 [Nitro Plugin] Initializing Robinhood Meme Scout Background Monitor...");
  monitorService.start();
  console.log("✈️ [Nitro Plugin] Initializing Telegram Channel Meme Monitor...");
  tgMonitorService.start();
  console.log("📈 [Nitro Plugin] Initializing Meme Win-rate Backtest Engine...");
  backtestEngine.start();
}
