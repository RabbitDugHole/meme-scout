# AGENTS.md — AI Agent Engineering Handbook for rh-early-meme-scout

Welcome, autonomous agents (Antigravity, Claude Code, Cursor, etc.). This document establishes the operational rules, architectural map, and engineering constraints for working within the `rh-early-meme-scout` codebase.

---

## 1. Project Context & Environment

- **Repository Role**: Submodule of `/Users/ray/git-repo/fee-arb-0828`.
- **Primary Mission**: Multi-channel early meme discovery, real-time Telegram signal ingestion, and automated L3 asymmetric concentrated liquidity (Uniswap V3 / V4) market-making.
- **Target Chains**:
  - **Robinhood Chain (Mainnet ID: `4663`)**: Primary chain for on-chain V3/V4 LP and Pons graduation.
  - **BNB Chain (ID: `56`)**: Multi-chain signal monitoring and PancakeSwap V3 execution.
- **Tech Stack**:
  - **Framework**: TanStack Start (Nitro engine + Vite) + TanStack Router
  - **Styling**: Tailwind CSS v4 + Radix UI + Lucide React
  - **Web3 / Blockchain**: Viem (`viem@2.56.3`)
  - **Security**: Google Authenticator TOTP (`otplib`, `qrcode`)

---

## 2. Mandatory Rules & Workflow (Critical)

### 2.1 The Commit-at-Every-Step Rule
> **User Global Rule**: `Remember commit changes at every step`
- Whenever you make code modifications, bug fixes, or documentation updates, you MUST commit them immediately to git inside `rh-early-meme-scout`.
- Because `rh-early-meme-scout` is a git submodule of `fee-arb-0828`, you must also update and commit the submodule pointer in the parent repository.

### 2.2 Verification Before Assertions
- Never declare a task complete without running verification commands:
  ```bash
  npm run typecheck
  npm run build
  ```
- If you touch server endpoints, test them with `curl` or unit tests.

### 2.3 Strict Live vs Paper Isolation
- All LP and trading data structures MUST preserve the `isDryRun` / `dryRun` flag.
- Never mix real on-chain transaction records (`isDryRun: false`) with paper simulation records (`isDryRun: true`).
- Private keys must never be logged, leaked in error messages, or committed to git. All credentials reside strictly in `data/lp-wallet.json` with `0600` permissions.

---

## 3. Directory & Architecture Map

| Directory / File | Description |
|---|---|
| `src/lib/scout/constants.ts` | Single source of truth for contract addresses (V3 NPM, Factory, V4 PoolManager, USDG, WETH) and risk thresholds. |
| `src/lib/scout/lp.server.ts` | **Core LP Engine (1500+ lines)**: V3 on-chain minting, tick alignment, PUMP / SIDEWAYS / RWA strategies, dynamic rebalancing, and 5-tier circuit breakers. |
| `src/lib/scout/actions.ts` | TanStack Start server functions (`createServerFn`) connecting UI and background services. |
| `src/lib/scout/scan.server.ts` | Blockscout and RPC log polling for new tokens, 5 hard filters, and narrative scoring. |
| `src/lib/scout/tg-monitor.server.ts` | Telegram channel scraper and regex contract extractor. |
| `server/api/tg-webhook.post.ts` | Inbound webhook endpoint for third-party bots (LiteHook, Telethon). |
| `src/lib/scout/v4-pool-radar.server.ts` | High-frequency Uniswap V4 / Barker fee opportunity radar. |
| `src/lib/scout/backtest.server.ts` | Automated hourly and daily performance evaluation and Lark reporting. |
| `src/lib/scout/lark.ts` | Lark (Feishu) rich interactive card generator and webhook sender. |
| `src/lib/scout/two-factor.server.ts` | TOTP 2FA authentication state and session validation. |
| `src/routes/index.tsx` | Main web dashboard with tabs: Radar, Watchlist, LP Market Maker, Backtest, Stocks. |
| `data/` | Runtime persistent JSON storage (`lp-config.json`, `lp-positions.json`, `lp-wallet.json`). Excluded from git. |

---

## 4. Key Contracts on Robinhood Chain (`4663`)

- **Uniswap V3 NonfungiblePositionManager (NPM)**: `0x73991a25c818bf1f1128deaab1492d45638de0d3`
- **Uniswap V3 Factory**: `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
- **Uniswap V3 SwapRouter02**: `0xcaf681a66d020601342297493863e78c959e5cb2`
- **Pons / Barker V4 PoolManager**: `0x8366a39cc670b4001a1121b8f6a443a643e40951`
- **Official USDG**: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- **Official WETH**: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

---

## 5. Production Operations Guide

- **Remote Host**: `ubuntu@tencent-jp` (Tokyo)
- **Deployment Path**: `/home/ubuntu/apps/rh-early-meme-scout`
- **Port**: `4663` (Production Preview / Nitro Server)
- **Systemd Unit**: `rh-meme-scout.service`

### Deployment Sync Workflow:
1. Ensure code passes local `npm run typecheck && npm run build`.
2. Commit in submodule `rh-early-meme-scout`.
3. Commit submodule reference in parent repo `fee-arb-0828`.
4. Rsync code to remote host:
   ```bash
   rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data/lp-wallet.json' ./ ubuntu@tencent-jp:/home/ubuntu/apps/rh-early-meme-scout/
   ```
5. Restart remote service:
   ```bash
   ssh ubuntu@tencent-jp "sudo systemctl restart rh-meme-scout.service"
   ```
