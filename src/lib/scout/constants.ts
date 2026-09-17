export const CHAIN_ID = 4663;
export const CHAIN_SLUG = "robinhood";
export const APP_NAME = "RH Early Meme Scout";

export const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const PONS_LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
export const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
export const PONS_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

// Uniswap V3 Official Deployments on Robinhood Chain (ID: 4663)
export const UNISWAP_V3_ROBINHOOD = {
  FACTORY: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  NPM: "0x73991a25c818bf1f1128deaab1492d45638de0d3", // NonfungiblePositionManager
  ROUTER: "0xcaf681a66d020601342297493863e78c959e5cb2", // SwapRouter02
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
} as const;

// PancakeSwap V3 on BSC (ID: 56)
export const PANCAKE_V3_BSC = {
  FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  NPM: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  ROUTER: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
} as const;

// Uniswap V3 on BSC (ID: 56)
export const UNISWAP_V3_BSC = {
  FACTORY: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7",
  NPM: "0x7b8AEE759F2D3595394ffb759905784659270ce1",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
} as const;

// Uniswap V3 on Arbitrum One ("arc" / "arb", ID: 42161)
export const UNISWAP_V3_ARBITRUM = {
  FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  NPM: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
} as const;

// Uniswap V3 on Base (ID: 8453)
export const UNISWAP_V3_BASE = {
  FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  NPM: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const ZERO = "0x0000000000000000000000000000000000000000";

export const EXCLUDED_HOLDERS = new Set(
  [
    DEAD,
    ZERO,
    PONS_LOCKER,
    PONS_HOOK,
    PONS_POOL_MANAGER,
    PONS_FACTORY,
  ].map((a) => a.toLowerCase()),
);

export const LP_MIN_USD = 50_000;
export const HOLDERS_MIN = 100;
export const TOP10_MAX = 0.6;
export const SMART_BUY_USD = 200;
export const SMART_WINDOW_MS = 120 * 60 * 1000;
export const LATE_MCAP_USD = 5_000_000;
export const PRIMARY_MCAP_MIN = 10_000;
export const PRIMARY_MCAP_MAX = 500_000;
export const TIER1_MCAP_MAX = 100_000;
export const WATCH_MAX = 5;
export const DECISION_MS = 3 * 60 * 1000;
export const FLATTEN_MS = 48 * 60 * 60 * 1000;
export const SCAN_TTL_MS = 90_000;
export const LOG_PAGES_MAX = 5;
export const HYDRATE_MAX = 8;
export const TRANSFER_PAGES = 1;

export const TIER_SIZE: Record<1 | 2 | 3, number> = {
  1: 10,
  2: 30,
  3: 60,
};

export const HARD_LABELS: Record<
  | "lp_gt_50k"
  | "holders_gt_100"
  | "top10_lt_60"
  | "lp_locked"
  | "smart_money_2plus",
  string
> = {
  lp_gt_50k: "流动性 > $50k",
  holders_gt_100: "持有人 > 100",
  top10_lt_60: "前十（剔 LP/锁/烧）< 60%",
  lp_locked: "流动性已锁 / 销毁",
  smart_money_2plus: "2h 内 ≥2 笔 ≥$200 买入",
};

export const SOFT_LABELS = {
  unverified_or_mint: "未开源 / 可增发 / 可暂停",
  serial_deployer: "部署者近窗连发 ≥3",
  late_layer: "市值 > $5M 或已 trending",
} as const;

export const RISK_FOOTER =
  "RH Chain 新币绝大多数会归零。过滤器挡不住讲得好的谎言。只用愿意全亏的钱。这不是投资建议，机器人不下单。";
