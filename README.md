# RH Early Meme Scout & Asymmetric LP Market Maker

> **Robinhood Chain (Chain ID: `4663`) 早期 Meme 发现雷达 · Telegram 实时信号聚合 · L3 非对称集中流动性做市系统 · 自动化模拟与实盘风控**

---

## 📖 系统概览 (Overview)

`RH Early Meme Scout` 是针对 **Robinhood Chain (`4663`)** 及 **BNB Chain (`56`)** 构建的全天候流动性雷达与自动化做市引擎。系统融合了**多源早期信号捕捉**、**严格五维链上硬指标过滤**、**动态叙事关联打分**，以及专为高波动 Meme 和 RWA 美股代币设计的 **L3 非对称集中流动性 (Concentrated LP) 策略矩阵**。

项目已实现从「信号发现 → 链上安全质检 → 自动模拟/实盘开池 → 动态网格移仓 → 五级风控熔断 → 飞书富文本卡片告警」的全流程闭环。

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    信号输入层 (Inflow)                  │
                               │  • Pons/Barker V4 工厂事件 (Blockscout / RPC Logs)       │
                               │  • Telegram 频道爬虫 (@bobo9527 / @bobo8567 等)         │
                               │  • 外部聚合 Webhook (/api/tg-webhook, 支持 LiteHook)     │
                               │  • BSC PancakeSwap V3 高潜力 Meme 跨链映射              │
                               └──────────────────────────┬─────────────────────────────┘
                                                          ▼
                               ┌────────────────────────────────────────────────────────┐
                               │                   风控与质检层 (Safety)                 │
                               │  • 5 条绝对硬过滤 (LP>$50k, 持币人>100, Top10<60% 等)    │
                               │  • 软过滤 (连发钱包/未开源/增发后门/市值>5M 迟到层)      │
                               │  • Robinhood RWA 美股代币跨层关联与叙事评分 (0-100)      │
                               └──────────────────────────┬─────────────────────────────┘
                                                          ▼
                               ┌────────────────────────────────────────────────────────┐
                               │             L3 非对称集中流动性做市 (LP Engine)         │
                               │  • Uniswap V3 真实链上铸造 (NonfungiblePositionManager)│
                               │  • Uniswap V4 Barker 高频费率雷达 (5% Dynamic Fee)     │
                               │  • PUMP 阶段: 单边上方做市挂单 (Core + Chase 限价出清)  │
                               │  • SIDEWAYS 阶段: 核心对称箱体网格                     │
                               │  • RWA 阶段: 美股代币 ±10% 窄幅做市 (AAPL/NVDA/TSLA)   │
                               │  • 动态移仓 (>12% 偏离) & 五级止损熔断 (-8% 净收益熔断)  │
                               └──────────────────────────┬─────────────────────────────┘
                                                          ▼
                               ┌────────────────────────────────────────────────────────┐
                               │                 通知与交互层 (Interface)                │
                               │  • 现代响应式 Web 控制台 (TanStack Router + Tailwind)   │
                               │  • 飞书 (Lark) 机器人富文本互动卡片实时推报             │
                               │  • Google 2FA (TOTP) 双因素安全认证与钱包隔离           │
                               └────────────────────────────────────────────────────────┘
```

---

## ⚡ 核心功能模块 (Core Modules)

### 1. 多源信号捕捉与侦测 (Multi-Source Inflow)
- **Robinhood Chain Pons / Barker 毕业雷达**：直连链上 RPC 与 Blockscout，实时监听 Pons 联合曲线毕业及 V4 池子初始化事件。
- **Telegram 频道实时监控**：自动化轮询与抓取知名 Meme Alpha 频道（`@bobo9527`、`@bobo8567`、`@supermeme_club` 等），智能提取合约地址并清洗。
- **外部 Webhook 接收端 (`/api/tg-webhook`)**：
  - 支持 `GET`（健康检查与接入规范）与 `POST`（接收第三方监控工具如 LiteHook、Telethon 自建脚本推送的 JSON 消息）。
  - 自动通过 DexScreener 多链接口补全流动性、价格、成交量数据，执行硬过滤后推送飞书。

### 2. 五维硬指标安全过滤 (5 Hard Filters)
任何新代币必须**全部通过**以下 5 条硬指标，缺少任一数据即按不合规处理：
1. **有效流动性**：`LP > $50,000`
2. **真实持币地址**：`Holders > 100`（剔除黑洞、部署者与做市合约）
3. **前十大持仓集中度**：`Top 10 < 60%`（剔除锁仓与官方池子后）
4. **流动性锁定状态**：LP 必须已打入锁仓合约或销毁黑洞 (`PONS_LOCKER` / `DEAD`)
5. **早期聪明钱动向**：2 小时内至少记录 `≥ 2 笔 ≥ $200` 的真实买单

### 3. L3 非对称集中流动性做市系统 (Asymmetric Concentrated LP)
基于 Uniswap V3、PancakeSwap V3 与 Uniswap V4 机制设计的做市系统，提供**实盘 (Live)** 与 **模拟 (Paper)** 双环境严格隔离运作：
- **多链 DEX 真实链上铸造**：直连各链官方 `NonfungiblePositionManager` 合约，自动完成授权 (`approve`)、精确 `slot0` Tick 对齐与 NFT 铸造 (`mint`)。
- **Uniswap V4 Barker 高频费率雷达**：集成 Barker 交易终端（`50000` 即 5% 费率梯度），实时监控高换手资金池，模拟复利流动性。
- **策略模式 (Strategy Modes)**：
  - **PUMP 阶段 (热门币上方单边阶梯止盈做市)**：
    - **先行买入 (Pre-Swap)**：雷达扫描到处于爆发上升期或高热度的标的（如 $TSLA、新晋金狗）时，先使用做市资金买入现货 Token。
    - **上方单边挂单 (Upper Single-Sided LP)**：在当前价格上方设立纯 Token 集中流动性池（`[P0, P0 * (1 + delta)]`），无需配对稳定币。
    - **分层收租吃手续费**：60% 资金置于核心费率区，40% 资金置于冲高追击区。拉盘期间每一笔外部买单都在为做市商持续纳贡 1%~5% 手续费。
    - **穿透上沿全额止盈 (Upper Pierced Exit)**：价格涨破上沿时，Token 100% 兑换为稳定币，系统自动执行撤池，锁定全额本金增值与手续费收益。
    - **单边快速防崩止损 (Fast Stop-Loss)**：价格若反向跌破设定的单边止损线（如 -8%），系统立即闪电撤池并市价清仓换回稳定币，防止深套。
  - **SIDEWAYS 阶段 (震荡核心箱体)**：
    - 70% 资金置于 `±15%` 核心做市带宽，15% 底部防御，15% 上沿收租。
  - **RWA_STABLE 阶段 (美股代币做市)**：
    - 自动识别 Robinhood 股票代币（AAPL、NVDA、TSLA、MSFT 等），配置 `±10%` 极窄带宽高倍做市。
- **动态移仓与五级风控熔断 (Dynamic Rebalancing & Safety)**：
  - **智能移仓**：价格偏离初始中心 `> 12%` 时自动触发撤池重构（单仓限移 3 次）。
  - **净收益熔断**：无常损失扣减手续费后 Net PnL `≤ -8%` 立即止损出局。
  - **价格破位熔断**：单边暴跌 `≤ -25%` 强制全额市价撤出。
  - **流动性枯竭熔断**：交易量 2 小时内骤降 `> 50%` 自动退出释放资金。
  - **超时平仓机制**：持仓超过 `720 分钟` 无论盈亏强制结项。

### 4. 模拟交易与自动化回测 (Paper Trading & Backtesting)
- **模拟做市沙盒**：支持零风险模拟开池与做市收益实时追踪。
- **自动化回测守护进程**：每小时与每日定时对历史做市与建仓代币进行多时间窗口（1h / 24h）收益核算，生成胜率、盈亏比与收益曲线。

### 5. 飞书 (Lark) 富文本卡片系统 (支持细粒度独立启停)
- **细粒度通知矩阵**：支持在 Web 后台一键启闭「新币雷达」、「TG 信号」、「回测胜率」、「现货买卖」、「LP 开池」、「LP 撤池止盈止损」、「LP 智能移仓」、「高费率机会雷达」及「每日收益综合日报」。
- **高收益 LP 机会雷达卡片**：换手率异常、费率激增时即刻推送。
- **开池 / 移仓 / 撤池交易报告卡片**：附带链上 Tx 哈希、开仓 Tick 区间、实时手续费收益与无常损失指标。
- **每日做市收益日报卡片**：定时汇总当日做市池整体盈亏、年化费率与胜率。

---

## ⛓️ 链上核心合约与参数规范 (On-Chain Reference)

### 1. Robinhood Chain (ID: `4663`)
- **RPC 节点**：`https://rpc.mainnet.chain.robinhood.com`
- **区块浏览器**：`https://explorer.mainnet.chain.robinhood.com`
- **主要代币**：
  - **USDG**（官方稳定币）：`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
  - **WETH**（包装以太坊）：`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- **Uniswap V3 官方合约**：
  - **NonfungiblePositionManager (NPM)**：`0x73991a25c818bf1f1128deaab1492d45638de0d3`
  - **Factory**：`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
  - **SwapRouter02**：`0xcaf681a66d020601342297493863e78c959e5cb2`
- **Pons / Barker V4 部署**：
  - **PoolManager**：`0x8366a39cc670b4001a1121b8f6a443a643e40951`
  - **Pons Factory**：`0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`
  - **Pons Locker**：`0x267444d099b10fb5ed7c3cc7b7c767adca574952`
  - **Pons Hook**：`0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`

### 2. BNB Smart Chain / BSC (ID: `56`)
- **RPC 节点**：`https://binance.llamarpc.com`
- **区块浏览器**：`https://bscscan.com`
- **主要代币**：**USDT** (`0x55d398326f99059fF775485246999027B3197955`) / **WBNB** (`0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`)
- **PancakeSwap V3 官方合约**：
  - **NonfungiblePositionManager**：`0x46A15B0b27311cedF172AB29E4f4766fbE521570`
  - **SwapRouter**：`0x13f4EA83D0bd40E75C8222255bc855a974568Dd4`

### 3. Arbitrum One (ID: `42161`)
- **RPC 节点**：`https://arb1.arbitrum.io/rpc`
- **区块浏览器**：`https://arbiscan.io`
- **主要代币**：**USDC** (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) / **WETH** (`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`)
- **Uniswap V3 官方合约**：
  - **NonfungiblePositionManager**：`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
  - **SwapRouter02**：`0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`

---

## 🛠️ 项目目录结构 (Directory Layout)

```
rh-early-meme-scout/
├── server/
│   ├── api/
│   │   ├── tg-webhook.get.ts      # TG Webhook 规范与健康探测
│   │   └── tg-webhook.post.ts     # TG Webhook 消息接收与清洗
│   └── plugins/
│       └── monitor.ts             # 服务端长效守护插件
├── src/
│   ├── routes/
│   │   ├── index.tsx              # 主控制台路由 (雷达/监控/回测/做市)
│   │   └── __root.tsx             # 根布局与 2FA 拦截层
│   ├── components/
│   │   └── scout/
│   │       ├── lp-panel.tsx       # L3 非对称做市交互面板
│   │       ├── monitor-panel.tsx  # 实时监听与告警配置面板
│   │       ├── stock-panel.tsx    # RWA 美股代币联动面板
│   │       └── two-factor-gate.tsx# Google 2FA 登录与激活弹窗
│   └── lib/
│       └── scout/
│           ├── actions.ts         # TanStack Start 服务端 Actions
│           ├── constants.ts       # 链 ID、合约地址与风控阈值
│           ├── lp.server.ts       # V3/V4 集中流动性做市核心引擎 (1500+ 行)
│           ├── barker.server.ts   # Barker V4 深度数据与费率分析
│           ├── v4-pool-radar.server.ts # V4 高收益池扫描服务
│           ├── scan.server.ts     # 链上质检与新币雷达引擎
│           ├── tg-monitor.server.ts # TG 频道轮询与文本分析引擎
│           ├── trade.server.ts    # 模拟现货交易执行器
│           ├── backtest.server.ts # 定时回测与收益统计服务
│           ├── lark.ts            # 飞书卡片构建与 Webhook 推送
│           ├── two-factor.server.ts # TOTP 2FA 认证系统
│           └── stocks.ts          # Robinhood 美股代币映射库
├── scripts/
│   ├── monitor-daemon.ts          # 独立后台监控脚本
│   └── startup.sh                 # 生产环境一键启动与更新脚本
├── data/                          # 运行时数据与持仓状态存储 (不提交 git)
│   ├── lp-config.json             # 做市风控与策略参数
│   ├── lp-positions.json          # 实盘与模拟盘活跃/历史仓位
│   └── lp-wallet.json             # 实盘做市钱包私钥 (0600 权限)
├── README.md                      # 系统使用与开发文档
├── STRATEGY.md                    # L3 非对称做市数学原理与策略手册
└── AGENTS.md                      # AI 协作与 Agent 指令规范
```

---

## 🚀 快速上手与本地开发 (Quickstart)

### 1. 环境依赖
- **Node.js**: `v22` 或 `v24` (推荐 `v24+`)
- **npm** 或 **pnpm**

### 2. 安装与启动
```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器 (默认端口 8080)
npm run dev

# 3. 生产环境构建与类型检查
npm run typecheck
npm run build
```

访问 `http://localhost:8080` 进入控制台。

### 3. 配置飞书推送与做市钱包
1. **飞书告警**：在「监控配置」中填入自定义飞书群 Webhook 机器人的链接，或设置系统环境变量 `LARK_WEBHOOK_URL`。
2. **实盘做市钱包**：
   - 切换至「L3 非对称 LP 做市」Tab。
   - 在钱包状态栏点击「导入私钥」，输入 Robinhood Chain 实盘私钥。
   - 系统将本地保存于 `data/lp-wallet.json` 并自动配置 `0600` 文件安全权限。
   - 确保钱包内持有足够的 **ETH**（用于 Gas 费）以及 **USDG**（用于做市本金）。

---

## 🚢 生产环境部署 (Production Deployment)

系统当前已部署在海外生产服务器（如腾讯云东京节点），并由 systemd 进行长效守护：

### 1. 常用运维命令
```bash
# 查看服务运行状态
sudo systemctl status rh-meme-scout.service

# 查看实时输出日志
journalctl -u rh-meme-scout.service -f -n 100

# 重启服务
sudo systemctl restart rh-meme-scout.service
```

### 2. Systemd 服务配置参考
```ini
[Unit]
Description=RH Early Meme Scout & Asymmetric LP
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/apps/rh-early-meme-scout
ExecStart=/usr/bin/npm run preview -- --port 4663 --host 0.0.0.0
Restart=always
RestartSec=5
Environment=PORT=4663
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## 📡 Webhook 接入指南 (TG & Third-Party)

你可以使用 [LiteHook](https://github.com/...)、自建 Telethon 脚本或第三方告警器将发现的代币推送给本系统：

- **请求方式**：`POST`
- **请求地址**：`http://<SERVER_IP>:4663/api/tg-webhook`
- **请求头**：`Content-Type: application/json`
- **请求体示例**：
```json
{
  "source": "litehook-bobo9527",
  "text": "发现早期金狗 PERPS 0x2724497e74cb2e4f0adcc29d77f10b777a8fc781 刚刚拉盘",
  "channel": "@bobo9527",
  "contract": "0x2724497e74cb2e4f0adcc29d77f10b777a8fc781"
}
```
系统将自动识别合约、查询 DexScreener 深度、执行 5 条硬过滤与叙事评分，并通过飞书机器人推送到专属协作群。

---

## ⚠️ 风险与免责声明 (Risk Disclaimer)

> **极度重要**：
> 1. 新链与早期 Meme 代币具有**极高归零风险**，任何自动化过滤器都无法杜绝精心编排的 Rug Pull、增发后门或貔貅合约。
> 2. 集中流动性 (Concentrated Liquidity) 策略虽能最大化提升资金利用率并捕获手续费，但在价格单边暴跌时会承受显著的**无常损失 (Impermanent Loss)**。请务必开启自动止损熔断开关。
> 3. 本系统代码开源仅供学习研究与量化做市策略验证，不构成任何投资建议。请严格控制实盘资金投入，**只用愿意承担全部亏损的资金参与**！
