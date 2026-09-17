/**
 * Bobo MC-ladder FOMO tape.
 * Event key: (channel, ca, pushIndex). Tuple: (ca, pushIndex, intervalMin, vol5m, top10, phish, bundle).
 * First print = pre-crowd inventory. Shrinking 跟推 + rising vol5m = FOMO. Toxic holders = do not arm.
 */
import type { FomoKind, FomoTapeSnapshot } from "./types";

export const FOMO_TOP10_TOXIC = 70;
export const FOMO_BUNDLE_TOXIC = 40;
export const WEBHOOK_ONLY_CHANNELS = new Set(["bobo9527"]);

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

type TapeRow = FomoTapeSnapshot & { tsMs: number };

const tapes = new Map<string, TapeRow[]>();

function tapeKey(channel: string, ca: string): string {
  return `${channel.trim().toLowerCase()}::${ca.trim().toLowerCase()}`;
}

function cnToInt(s: string): number | undefined {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (s.startsWith("十") && s.length === 2) return 10 + (CN_NUM[s[1]] ?? 0);
  if (s.endsWith("十") && s.length === 2) return (CN_NUM[s[0]] ?? 0) * 10;
  if (s.length === 3 && s[1] === "十") {
    return (CN_NUM[s[0]] ?? 0) * 10 + (CN_NUM[s[2]] ?? 0);
  }
  return CN_NUM[s];
}

export function parsePushIndex(text: string): number | undefined {
  const arabic = text.match(/第\s*(\d+)\s*次(?:推送|跟推|首推)/);
  if (arabic) return Number(arabic[1]);
  const boxed = text.match(/【第?\s*([一二三四五六七八九十]+|\d+)\s*次推送】/);
  if (boxed) return cnToInt(boxed[1]);
  if (/战壕首推|第一次推送/.test(text)) return 1;
  return undefined;
}

export function parseIntervalMin(text: string): number | undefined {
  const m = text.match(/跟推间隔[\s:：]*([0-9.]+)\s*分钟/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parsePct(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function parsePhishPct(text: string): number | undefined {
  return parsePct(text, /钓鱼钱包[\s:：]*([0-9.]+)\s*%/);
}

export function parseBundlePct(text: string): number | undefined {
  return (
    parsePct(text, /老鼠仓偷跑比例[\s:：]*([0-9.]+)\s*%/) ??
    parsePct(text, /捆绑抢跑[\s:：]*([0-9.]+)\s*%/) ??
    parsePct(text, /捆绑[\s:：]*([0-9.]+)\s*%/)
  );
}

export function parseTop10Pct(text: string): number | undefined {
  return parsePct(text, /Top\s*10\s*持仓占比[\s:：]*([0-9.]+)\s*%/i);
}

export function parseVol5mUsd(text: string): number | undefined {
  const m = text.match(/5\s*分钟交易量[\s:：]*\$?([0-9.,]+)\s*([KkMmBb])?/i);
  if (!m) return undefined;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return undefined;
  const unit = (m[2] || "").toUpperCase();
  if (unit === "K") return num * 1_000;
  if (unit === "M") return num * 1_000_000;
  if (unit === "B") return num * 1_000_000_000;
  return num;
}

export function parseMultFromFirst(text: string): number | undefined {
  const m = text.match(/距离首推[\s:：]*([0-9.]+)\s*x/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function isArgusSignal(input: {
  channel?: string;
  chain?: string;
  platform?: string;
}): boolean {
  const ch = (input.channel || "").toLowerCase();
  const chain = (input.chain || "").toLowerCase();
  const plat = (input.platform || "").toLowerCase();
  if (ch.includes("bobo9632")) return true;
  if (plat.includes("argus")) return true;
  if (chain.includes("argus")) return true;
  if (/(^|[^a-z])arc([^a-z]|$)/i.test(input.chain || "") && !chain.includes("arbitrum")) {
    return true;
  }
  return false;
}

export function isWebhookOnlyChannel(username: string, webhookOnly?: boolean): boolean {
  const u = username.trim().toLowerCase().replace(/^@/, "");
  return webhookOnly === true || WEBHOOK_ONLY_CHANNELS.has(u);
}

export function resolveSignalChain(input: {
  channel: string;
  platform?: string;
  chainText?: string;
  address: string;
}): string {
  const ch = input.channel.toLowerCase();
  const plat = (input.platform || "").toLowerCase();
  const raw = (input.chainText || "").trim();
  const rawL = raw.toLowerCase();

  if (isArgusSignal({ channel: input.channel, chain: raw, platform: input.platform })) {
    return "Argus";
  }
  if (rawL.includes("bsc") || rawL.includes("binance") || ch.includes("bobo9527")) {
    return rawL.includes("bsc") || rawL.includes("binance") ? raw || "BSC" : "BSC";
  }
  if (
    rawL.includes("robinhood") ||
    plat.includes("pons") ||
    plat.includes("barker") ||
    ch.includes("bobo8567")
  ) {
    return rawL.includes("robinhood") ? raw || "Robinhood Chain" : "Robinhood Chain";
  }
  if (raw) return raw;
  if (input.address.startsWith("0x")) return "Robinhood Chain";
  return "Solana";
}

export function isRobinhoodLpTarget(input: {
  chain: string;
  channel: string;
  platform?: string;
  dexUrl?: string;
}): boolean {
  if (isArgusSignal(input)) return false;
  const chain = input.chain.toLowerCase();
  const ch = input.channel.toLowerCase();
  const plat = (input.platform || "").toLowerCase();
  return (
    chain.includes("robinhood") ||
    ch === "bobo8567" ||
    Boolean(input.dexUrl?.includes("/robinhood/")) ||
    plat.includes("pons") ||
    plat.includes("barker")
  );
}

export type FomoIngestInput = {
  channel: string;
  ca: string;
  pushIndex?: number;
  intervalMin?: number;
  vol5m?: number;
  top10?: number;
  phish?: number;
  bundle?: number;
  timestamp?: string;
  rawText?: string;
  chain?: string;
  platform?: string;
};

function decideKind(input: {
  pushIndex: number;
  intervalMin?: number;
  prevIntervalMin?: number;
  vol5m?: number;
  prevVol5m?: number;
  toxic: boolean;
  multFromFirst?: number;
}): { kind: FomoKind; armLp: boolean; reason: string } {
  if (input.toxic) {
    return { kind: "toxic", armLp: false, reason: "toxic top10/phish/bundle — do not arm" };
  }
  if (input.pushIndex >= 10 || (input.multFromFirst != null && input.multFromFirst >= 10)) {
    return { kind: "late", armLp: false, reason: "late 跟推 / 10x+ — do not chase" };
  }
  const shrinking =
    input.prevIntervalMin != null &&
    input.intervalMin != null &&
    input.intervalMin < input.prevIntervalMin;
  const volRising =
    input.prevVol5m != null && input.vol5m != null && input.vol5m > input.prevVol5m;

  if (input.pushIndex === 1) {
    return { kind: "inventory", armLp: true, reason: "first print — pre-crowd inventory" };
  }
  if (input.pushIndex >= 2 && input.pushIndex <= 5 && volRising && (shrinking || input.pushIndex === 2)) {
    return {
      kind: "fomo",
      armLp: false,
      reason: "shrinking 跟推 + rising vol — FOMO, let asks work",
    };
  }
  if (input.pushIndex >= 2 && shrinking && volRising) {
    return {
      kind: "fomo",
      armLp: false,
      reason: "shrinking 跟推 + rising vol — FOMO, let asks work",
    };
  }
  return { kind: "observe", armLp: false, reason: "ladder update — observe" };
}

export function applyFomoTape(input: FomoIngestInput): FomoTapeSnapshot {
  const ca = input.ca.trim().toLowerCase();
  const channel = input.channel.trim().toLowerCase();
  const text = input.rawText || "";
  const pushIndex = input.pushIndex ?? parsePushIndex(text) ?? 1;
  const tsMs = input.timestamp ? Date.parse(input.timestamp) : Date.now();
  const key = tapeKey(channel, ca);
  const prev = tapes.get(key) ?? [];
  const last = prev[prev.length - 1];

  let intervalMin = input.intervalMin ?? parseIntervalMin(text);
  if (intervalMin == null && last && Number.isFinite(tsMs) && Number.isFinite(last.tsMs)) {
    const delta = (tsMs - last.tsMs) / 60000;
    if (delta > 0) intervalMin = Math.round(delta * 100) / 100;
  }

  const vol5m = input.vol5m ?? parseVol5mUsd(text);
  const top10 = input.top10 ?? parseTop10Pct(text);
  const phish = input.phish ?? parsePhishPct(text);
  const bundle = input.bundle ?? parseBundlePct(text);
  const phishTrap = /高危诱捕/.test(text);
  const top10Dump = /庄家控盘/.test(text);
  const toxic =
    (top10 != null && top10 > FOMO_TOP10_TOXIC) ||
    top10Dump ||
    phishTrap ||
    (bundle != null && bundle >= FOMO_BUNDLE_TOXIC);

  const decided = decideKind({
    pushIndex,
    intervalMin,
    prevIntervalMin: last?.intervalMin,
    vol5m,
    prevVol5m: last?.vol5m,
    toxic,
    multFromFirst: parseMultFromFirst(text),
  });

  const snap: TapeRow = {
    channel,
    ca,
    pushIndex,
    intervalMin,
    vol5m,
    top10,
    phish,
    bundle,
    kind: decided.kind,
    armLp: decided.armLp && !isArgusSignal(input),
    reason: isArgusSignal(input) && decided.armLp
      ? "Argus/ARC signal — no Robinhood LP venue"
      : decided.reason,
    tsMs: Number.isFinite(tsMs) ? tsMs : Date.now(),
  };
  if (isArgusSignal(input)) snap.armLp = false;

  const next = [...prev, snap].slice(-16);
  tapes.set(key, next);
  if (tapes.size > 200) {
    const first = tapes.keys().next().value;
    if (first) tapes.delete(first);
  }
  return snap;
}

export function getFomoByCa(ca: string): FomoTapeSnapshot | undefined {
  const needle = ca.trim().toLowerCase();
  const hits: FomoTapeSnapshot[] = [];
  for (const rows of tapes.values()) {
    const last = rows[rows.length - 1];
    if (last && last.ca === needle) hits.push(last);
  }
  return hits.find((h) => h.kind === "toxic") ?? hits[hits.length - 1];
}

export function listFomoEvents(): FomoTapeSnapshot[] {
  const out: FomoTapeSnapshot[] = [];
  for (const rows of tapes.values()) {
    const last = rows[rows.length - 1];
    if (last) out.push(last);
  }
  return out;
}

export function resetFomoTape(): void {
  tapes.clear();
}

export function shouldArmLpFromTape(ca: string, chain: string, channel?: string): boolean {
  if (isArgusSignal({ chain, channel })) return false;
  const snap = getFomoByCa(ca);
  if (!snap) return true; // no tape → existing radar/hot-token path
  return snap.armLp;
}
