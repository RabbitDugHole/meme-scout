# L3 非对称集中流动性做市策略指南 (Asymmetric Concentrated LP Strategy)

> **核心设计哲学：高波动 Meme 的「单边限价卖出收租」与 RWA 美股代币的「窄幅高频做市」**

---

## 一、策略背景与痛点

在传统的恒定乘积做市（AMM Uniswap V2 / $x \cdot y = k$）中：
1. **资金利用率低下**：资金分散在 $[0, \infty)$ 的全价格区间，实际处于当前价格附近的资金往往不足 1%，大部分资金沉淀休眠。
2. **严重的单边无常损失 (Impermanent Loss)**：在 Meme 币出现单边暴跌时，LP 只能被动接盘并最终持有 100% 的归零代币；而在单边暴涨时，代币被全部买光，只赚取了极少量微薄的手续费，大幅跑输现货持有。

Uniswap V3 / V4 引入了**集中流动性 (Concentrated Liquidity)** 与 **范围订单 (Range Orders)**。通过将流动性精准注入至特定价格区间 $[P_{\min}, P_{\max}]$，资金效率可提升 **20 倍至 100 倍**。

针对 Robinhood Chain 与 BSC 上的资产特性，本系统设计了 **L3 非对称集中流动性策略矩阵**。

---

## 二、三大策略模式 (Strategy Matrix)

```
      ▲ 价格 Price
      │
      │   ┌──────────────────────────────────────────────┐
      │   │ 冲高追击区 (Chase Zone: +20% ~ +45%) · 40% Token │  ---> 价格穿透上沿: 100% 变现为 USDG,
      │   ├──────────────────────────────────────────────┤       自动触发获利退出 (Upper Pierced Exit)
      │   │ 核心费率区 (Core Fee Zone: 0% ~ +20%) · 60% Token │  ---> 捕获狂暴拉盘期间的天量交易手续费
      ├───┼──────────────────────────────────────────────┤
      │   │ 当前价格 $P_0$ (买入现货并挂单边 LP 起点)      │
      │   └──────────────────────────────────────────────┘
      │
      ▼ (单边上涨时只有卖出压力，不向下被动接盘；若跌破止损线则闪电撤池并市价清仓)
```

### 1. PUMP 阶段：热门币上方单边阶梯止盈做市 (`SINGLE_SIDED_RANGE_ORDER`)
- **设计哲学**：
  传统的做市商在 Meme 暴涨暴跌中极易遭遇灾难性无常损失：若在当前价格下方挂单做市，本质是「等价格下跌时被动买入接盘」，一旦代币崩盘将接满手归零筹码。
  **本系统的上方单边做市逻辑彻底颠覆此痛点**：
  1. **主动入场 (Pre-Swap)**：当雷达扫描到处于爆发上升期、换手率极高或热度极高的标的（如 $TSLA, 热门 Meme 等）时，系统先用设定做市资金快速买入该标的 Token。
  2. **挂单边上方 LP 池 (Upper Single-Sided Range Order)**：在当前价格上方设立纯 Token 单边集中流动性池（区间 $[P_0, P_0 \times (1 + \Delta P)]$，无需配对稳定币本金注入池内）。
  3. **分层收租吃手续费**：
     - **核心费率收益区 (Core Zone)**：$[P_0, P_0 \times (1 + \text{singleSidedUpperCorePct})]$（如 0% ~ +20%）。
     - **冲高追击区 (Chase Zone)**：$[P_0 \times (1 + \text{singleSidedUpperCorePct}), P_0 \times (1 + \text{singleSidedUpperMaxPct})]$（如 +20% ~ +45%）。
     - 外部狂暴拉盘时的每一笔买单都在高费率池（如 1%~5%）中持续向我们的 LP 纳贡手续费。
  4. **穿上沿全额落袋 (Upper Pierced Exit)**：当价格强势拉升突破做市区间上沿时，池内 Token **已 100% 被买盘兑换为报价稳定币（USDG / USDT）**。系统侦测到穿透后立即自动撤池（`CLOSED_TAKEPROFIT_PIERCED`），保住全部本金、价格增值收益与丰厚手续费。
  5. **单边快速防崩止损 (Fast Stop-Loss)**：若代币未能延续上涨，反而掉头下跌触及设定的止损阈值（如当前价格相对开仓点 $\le -8\%$），系统立即发起**闪电撤池并执行市价 Swap 清仓**，将剩余代币立即卖回稳定币，决不被动死扛。

---

### 2. SIDEWAYS 阶段：震荡核心箱体网格 (`SIDEWAYS`)
- **适用场景**：已度过早期狂热、市值在 $100k ~ $1M 之间震荡洗盘、且流动性较为充裕的双向交易代币。
- **仓位结构**：
  - **核心网格带宽 (Core Range)**：$[P_0 \times 0.85, P_0 \times 1.15]$（$\pm 15\%$，占资金 70%）。
  - **双向防御带宽 (Defend Range)**：下沿防御 15% 资金，上沿防御 15% 资金。
- **收益逻辑**：
  - 在代币区间往复震荡时，充分捕获多空博弈产生的双向手续费摩擦收益。

---

### 3. RWA_STABLE 阶段：美股代币窄幅做市 (`RWA_STABLE`)
- **适用场景**：Robinhood 链上的 Tokenized US Equities（美股 RWA 代币，如 AAPL、NVDA、TSLA、MSFT、SPY 等）。
- **仓位结构**：
  - 设定极窄的 $\pm 10\%$ 带宽（甚至 $\pm 5\%$）。
- **收益逻辑**：
  - 美股日间波动率相对 Meme 代币极低，集中度可以放大至 50~100 倍。
  - 为链上股票交易者提供极深盘口，同时稳健获取真实资产的手续费分红。

---

### 4. 多链与多 DEX 协议支持矩阵 (Multi-Chain DEX Architecture)

系统已全面抽象并接入多链集中流动性协议路由：
- **Robinhood Chain (Chain ID: `4663`)**:
  - Uniswap V3 NonfungiblePositionManager: `0x73991a25c818bf1f1128deaab1492d45638de0d3`
  - Uniswap V3 SwapRouter02: `0xcaf681a66d020601342297493863e78c959e5cb2`
  - Uniswap V4 Barker 高频费率雷达（5% 动态费率）
- **BNB Chain / BSC (Chain ID: `56`)**:
  - PancakeSwap V3 NonfungiblePositionManager: `0x46A15B0b27311cedF172AB29E4f4766fbE521570`
  - PancakeSwap V3 SwapRouter: `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4`
- **Arbitrum One (Chain ID: `42161`)**:
  - Uniswap V3 NonfungiblePositionManager: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
  - Uniswap V3 SwapRouter02: `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`

系统根据目标池的 `chainId` 自动切换 RPC 节点与协议合约，无论是 Robinhood 原生资产、BSC 上的 Pancake V3 币对，还是 Arbitrum 上的高深度池，均支持一键做市与风控接管。

---

## 三、数学原理与链上计算 (Tick Math)

### 1. 价格与 Tick 换算
Uniswap V3 中，价格 $P$（以 token1 计价的 token0 价格）与离散点 $\text{tick}$ 的关系为：

$$P = 1.0001^{\text{tick}} \times 10^{\text{decimals}_0 - \text{decimals}_1}$$

由目标价格 $P$ 反推对应 Tick：

$$\text{tick} = \left\lfloor \frac{\ln(P \times 10^{\text{decimals}_1 - \text{decimals}_0})}{\ln(1.0001)} \right\rfloor$$

### 2. Tick Spacing 对齐规范
不同费率梯度对应不同的 Tick 步长（`tickSpacing`），计算出的 Tick 必须严格对齐：
- `feeTier = 500` (0.05%): `tickSpacing = 10`
- `feeTier = 3000` (0.3%): `tickSpacing = 60`
- `feeTier = 10000` (1%): `tickSpacing = 200`

对齐公式：
$$\text{tickAligned} = \left\lfloor \frac{\text{tick}}{\text{tickSpacing}} \right\rfloor \times \text{tickSpacing}$$

---

## 四、五级动态风控与熔断体系 (Circuit Breakers)

系统在后台守护进程中，以 **30 秒** 为周期对所有活跃做市池进行全方位监控与指标核算，任何一条触发都会执行紧急退出：

```
+-----------------------------------------------------------------------------------+
|                            五级安全防护网 (Circuit Breakers)                       |
+---+----------------------------+--------------------------------------------------+
| 1 | 净收益止损 (Net PnL Stop)   | Net PnL (净收益含手续费) <= -8% 强制平仓             |
+---+----------------------------+--------------------------------------------------+
| 2 | 现货破位止损 (Price Drop)   | 现货价格相对于开仓点跌幅 <= -25% 强制撤单止损       |
+---+----------------------------+--------------------------------------------------+
| 3 | 流动性骤降 (Volume Crater) | 2 小时成交量较入场时下滑 > 50% 主动退出释放流动性    |
+---+----------------------------+--------------------------------------------------+
| 4 | 超时保护 (Max Hold Time)   | 持仓时间超过 720 分钟 (12小时) 无论盈亏强行结项     |
+---+----------------------------+--------------------------------------------------+
| 5 | 上沿穿透止盈 (Upper Pierced)| 价格向上突破做市区间上界，100% 转换为 USDG 获利退出 |
+---+----------------------------+--------------------------------------------------+
```

### 智能移仓重平衡 (Dynamic Rebalancing)
- **触发条件**：当前市价偏离初始中心价格 `> 12%`，且尚未触发极端熔断。
- **执行过程**：
  1. 调用 NPM 合约提取全部剩余流动性及已积累手续费。
  2. 根据当前最新价格，以最新资产比例重新计算最优 Tick 范围。
  3. 重新铸造新 NFT 仓位，并向飞书推送移仓调整卡片。
- **限制约束**：为防止反复震荡磨损 Gas 费，单个做市池上限只允许自动移仓 **3 次**。

---

## 五、实盘 vs 模拟盘隔离架构 (Live vs Paper)

为了兼顾策略迭代的安全性与实盘操作的确定性，系统在架构上实现了实盘与模拟盘的**全栈数据隔离**：

1. **状态存储独立**：
   - 活跃持仓列表中，`isDryRun: true`（模拟盘）与 `isDryRun: false`（实盘）携带清晰标记。
   - 前端 Web 控制面板与飞书推送卡片具备明确视觉标签区分。
2. **资金与权限安全**：
   - 模拟盘无需真实私钥，基于链上实时报价与流动性公式进行虚拟撮合结算。
   - 实盘做市必须在管理后台经过 **Google 2FA 双因素验证**后导入专用做市钱包私钥，文件以 `0600` 权限仅存放在服务端本地 `data/lp-wallet.json`。
   - 系统支持一键断开钱包，断开后自动从内存及磁盘中安全擦除私钥凭证。

---

## 六、飞书告警与通知细粒度控制 (Lark Granular Matrix)

为避免通知风暴对高频交易造成干扰，系统提供了完备的**独立分类启停开关**：

| 模块类别 | 控制字段 | 默认状态 | 说明与推送内容 |
| :--- | :--- | :---: | :--- |
| **新币雷达** | `MonitorConfig.autoAlarmEnabled` | 开启 | 监听通过 5 项硬过滤的新池爆发与叙事信号 |
| **TG 信号** | `TgMonitorConfig.autoAlarmEnabled` | 开启 | 聚合频道抓取与 Alpha 早期合约识别 |
| **自动化回测**| `BacktestConfig.autoLarkPush` | 开启 | 1h/24h 胜率追踪与盈亏统计分析 |
| **现货交易买入**| `TradeConfig.larkTradeBuyEnabled` | 开启 | 智能买单成交、滑点与 Gas 消耗 |
| **现货交易卖出**| `TradeConfig.larkTradeSellEnabled` | 开启 | 止盈/止损卖单成交与净盈亏卡片 |
| **交易日报** | `TradeConfig.larkTradeReportEnabled` | 开启 | 现货每日聚合交易流水与总收益 |
| **LP 总开关** | `LpConfig.larkNotification` | 开启 | LP 做市全流程通知总阀门 |
| **LP 建仓提醒**| `LpConfig.larkLpOpenEnabled` | 开启 | 集中做市开池、Tick 区间与做市本金详情 |
| **LP 撤池止盈止损**| `LpConfig.larkLpCollectEnabled` | 开启 | 穿上沿止盈、快速防崩止损或到期撤池归档 |
| **LP 智能移仓**| `LpConfig.larkLpRebalanceEnabled` | 开启 | 价格偏离时动态调整区间并重新铸造 NFT |
| **LP 机会雷达**| `LpConfig.larkLpOpportunityEnabled` | 开启 | Barker 5% 超高费率池与暴增交易量提醒 |
| **LP 综合日报**| `LpConfig.larkLpDailyReportEnabled` | 开启 | 每日定时汇总所有活跃池费率年化与总回报 |

用户可在 Web 端「L3 非对称 LP 做市」配置面板中一键按需启闭，变更秒级热生效。

---

## 七、安全防线与敏感凭证隔离 (Security & Privacy)

1. **代码库与 Git 深度加固**：
   - `.gitignore` 包含严格的排除规则：`*.pem`、`*.key`、`*.keystore`、`*.p12`、`*wallet*.json`、`*secret*.json`、`*credential*.json`、`*.seed`、`*.mnemonic`、`data/` 全量目录等。
   - 确保任何私钥、助记词、钱包文件或本地运行状态绝不流入版本控制。
2. **服务端权限沙盒**：
   - 私钥文件写入时强制采用 `fs.writeFileSync(..., { mode: 0o600 })`，仅操作系统当前服务进程属主有权读写。
   - 前端 Web 交互通过 Google Authenticator 双因素认证（TOTP）进行关键操作鉴权，防止未授权恶意指令。
