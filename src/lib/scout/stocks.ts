import { CHAIN_ID, ZERO } from "./constants";
import { fetchJson } from "./http";
import type { StockAsset } from "./types";

type Rhj = {
  assets?: Array<{
    tokenSymbol?: string;
    tokenName?: string;
    logoUrl?: string | null;
    status?: string;
    deployments?: Array<{
      contractAddress?: string;
      chainId?: number | string;
    }>;
  }>;
};

let cache: { at: number; rows: StockAsset[] } | null = null;

export async function fetchStockAssets(): Promise<StockAsset[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.rows;
  try {
    const d = await fetchJson<Rhj>("https://api.robinhood.com/rhj/assets", {
      timeoutMs: 10_000,
    });
    const rows: StockAsset[] = [];
    for (const a of d.assets ?? []) {
      const dep = (a.deployments ?? []).find(
        (x) => Number(x.chainId) === CHAIN_ID && x.contractAddress,
      );
      if (!dep?.contractAddress) continue;
      rows.push({
        symbol: a.tokenSymbol ?? "—",
        name: (a.tokenName ?? "").replace(" • Robinhood Token", ""),
        contract: dep.contractAddress,
        logoUrl: a.logoUrl ?? null,
        status: a.status ?? "",
      });
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    return cache?.rows ?? [];
  }
}

export const COMMON_EQUITY_SYMBOLS = new Set([
  "NVDA",
  "TSLA",
  "AAPL",
  "GOOGL",
  "GOOG",
  "MSFT",
  "AMZN",
  "META",
  "SPY",
  "QQQ",
  "COIN",
  "MSTR",
  "NFLX",
  "AMD",
  "BABA",
  "PLTR",
]);

export function isRwaSymbol(symbol?: string | null): boolean {
  if (!symbol) return false;
  const clean = symbol.toUpperCase().replace(/^[$]/, "").trim();
  return COMMON_EQUITY_SYMBOLS.has(clean);
}

export function extractRwaStock(
  pairNameOrSymbol: string,
  stocks: StockAsset[] = [],
): { isRwa: boolean; stockSymbol?: string; stockName?: string } {
  if (!pairNameOrSymbol) return { isRwa: false };

  const parts = pairNameOrSymbol.toUpperCase().split(/[\s/_\-]+/);
  for (const p of parts) {
    const clean = p.replace(/^[$]/, "");
    if (COMMON_EQUITY_SYMBOLS.has(clean)) {
      const match = stocks.find((s) => s.symbol.toUpperCase() === clean);
      return {
        isRwa: true,
        stockSymbol: clean,
        stockName: match?.name || `Robinhood ${clean} Stock Token`,
      };
    }
  }

  for (const s of stocks) {
    if (pairNameOrSymbol.toUpperCase().includes(s.symbol.toUpperCase())) {
      return {
        isRwa: true,
        stockSymbol: s.symbol.toUpperCase(),
        stockName: s.name,
      };
    }
  }

  return { isRwa: false };
}

