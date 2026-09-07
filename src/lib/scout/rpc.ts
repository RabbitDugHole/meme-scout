const RPC = "https://rpc.mainnet.chain.robinhood.com";
const UA =
  "Mozilla/5.0 (compatible; RHEarlyMemeScout/1.0; +https://x.ai) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";

const NAME_SEL = "0x06fdde03";
const SYMBOL_SEL = "0x95d89b41";

type RpcRes = { result?: string; error?: { message?: string } };

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as RpcRes;
    return j.result ?? null;
  } catch {
    return null;
  }
}

function decodeAbiString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  try {
    if (raw.length <= 64) {
      const buf = Buffer.from(raw.replace(/00+$/, ""), "hex").toString("utf8").replace(/\0/g, "").trim();
      return buf || null;
    }
    const len = parseInt(raw.slice(64, 128), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 128) return null;
    const body = raw.slice(128, 128 + len * 2);
    const s = Buffer.from(body, "hex").toString("utf8").replace(/\0/g, "").trim();
    return s || null;
  } catch {
    return null;
  }
}

export async function erc20Meta(address: string): Promise<{ name: string | null; symbol: string | null }> {
  const [nameHex, symbolHex] = await Promise.all([
    ethCall(address, NAME_SEL),
    ethCall(address, SYMBOL_SEL),
  ]);
  return {
    name: decodeAbiString(nameHex),
    symbol: decodeAbiString(symbolHex),
  };
}

export async function getLatestBlockNumber(): Promise<number> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as RpcRes;
    return j.result ? parseInt(j.result, 16) : 0;
  } catch {
    return 0;
  }
}

export type RpcFactoryEvent = {
  method: string;
  token: string | null;
  curve: string | null;
  deployer: string | null;
  pairToken: string | null;
  timestamp: string | null;
  tx: string | null;
};

// Event topic hashes for Pons Factory:
// TokenLaunched: 0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607
// PoolGraduated: 0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980
const TOPIC_TOKEN_LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const TOPIC_POOL_GRADUATED = "0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980";

export async function fetchFactoryLogsFromRpc(
  factoryAddress: string,
  lookbackBlocks = 35_000,
): Promise<RpcFactoryEvent[]> {
  const currentBlock = await getLatestBlockNumber();
  if (currentBlock <= 0) return [];

  const fromBlock = "0x" + Math.max(0, currentBlock - lookbackBlocks).toString(16);
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getLogs",
        params: [
          {
            address: factoryAddress,
            fromBlock,
            toBlock: "latest",
          },
        ],
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { result?: Array<{ topics?: string[]; transactionHash?: string }> };
    const logs = j.result ?? [];

    const events: RpcFactoryEvent[] = [];
    for (const log of logs) {
      const t0 = log.topics?.[0]?.toLowerCase();
      const tx = log.transactionHash ?? null;
      if (t0 === TOPIC_TOKEN_LAUNCHED.toLowerCase()) {
        const token = log.topics?.[1] ? "0x" + log.topics[1].slice(26) : null;
        const curve = log.topics?.[2] ? "0x" + log.topics[2].slice(26) : null;
        const deployer = log.topics?.[3] ? "0x" + log.topics[3].slice(26) : null;
        events.push({
          method: "TokenLaunched",
          token,
          curve,
          deployer,
          pairToken: null,
          timestamp: new Date().toISOString(),
          tx,
        });
      } else if (t0 === TOPIC_POOL_GRADUATED.toLowerCase()) {
        const token = log.topics?.[1] ? "0x" + log.topics[1].slice(26) : null;
        events.push({
          method: "PoolGraduated",
          token,
          curve: null,
          deployer: null,
          pairToken: null,
          timestamp: new Date().toISOString(),
          tx,
        });
      }
    }
    return events;
  } catch (err) {
    console.warn("[RPC] fetchFactoryLogsFromRpc error:", err);
    return [];
  }
}

