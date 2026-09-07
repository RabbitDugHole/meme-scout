import { monitorService } from "../../src/lib/scout/monitor.server";

export default function () {
  console.log("🚀 [Nitro Plugin] Initializing Robinhood Meme Scout Background Monitor...");
  monitorService.start();
}
