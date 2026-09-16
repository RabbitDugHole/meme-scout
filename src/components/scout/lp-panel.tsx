import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  DollarSign,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Info,
  Key,
  Layers,
  Landmark,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  closeAllLpPositions,
  closeLpPosition,
  getLpState,
  updateLpConfig,
  getV4MarketSummary,
  triggerV4RadarScan,
  openManualLp,
  rebalanceLpPositionAction,
  importLpWalletAction,
  disconnectLpWalletAction,
  getLpWalletStatusAction,
  getHotTokensList,
  triggerHotTokenLpAction,
} from "@/lib/scout/actions";
import { formatUsd, shortAddr } from "@/lib/scout/format";
import type { LpPosition, LpRangeSegment, V4PoolItem } from "@/lib/scout/types";
import { cn } from "@/lib/utils";

export function LpPanel({
  onInspect,
}: {
  onInspect?: (address: string) => void;
}) {
  const qc = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [radarFilter, setRadarFilter] = useState<"top" | "rwa" | "meme" | "new">("top");

  // Fetch LP State
  const { data: lpData, isLoading, refetch } = useQuery({
    queryKey: ["lpState"],
    queryFn: () => getLpState(),
    refetchInterval: 5000,
  });

  // Fetch Barker V4 Market Summary
  const { data: v4Summary, isLoading: isV4Loading, refetch: refetchV4 } = useQuery({
    queryKey: ["v4MarketSummary"],
    queryFn: () => getV4MarketSummary(),
    refetchInterval: 15000,
  });

  // Fetch High-Liquidity Hot Tokens List
  const { data: hotTokensList, isLoading: isHotLoading, refetch: refetchHotTokens } = useQuery({
    queryKey: ["hotTokensList"],
    queryFn: () => getHotTokensList(),
    refetchInterval: 10000,
  });

  // Hot Token One-Click LP Mutation
  const triggerHotLpMut = useMutation({
    mutationFn: (args: { symbol: string; customCapitalUsd?: number; dryRun?: boolean }) =>
      triggerHotTokenLpAction({ data: args }),
    onSuccess: (_, vars) => {
      toast.success(`成功为热门标的 $${vars.symbol} 建立做市头寸！`);
      qc.invalidateQueries({ queryKey: ["lpState"] });
      qc.invalidateQueries({ queryKey: ["hotTokensList"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "热门做市开池失败");
    },
  });

  // Config Form State
  const config = lpData?.config;
  const [cfgDryRun, setCfgDryRun] = useState(true);
  const [cfgAutoLp, setCfgAutoLp] = useState(true);
  const [cfgCapitalUsd, setCfgCapitalUsd] = useState(50);
  const [cfgMinVolToLiq, setCfgMinVolToLiq] = useState(1.5);
  const [cfgWithdrawRatio, setCfgWithdrawRatio] = useState(0.35);
  const [cfgVolDropExit, setCfgVolDropExit] = useState(50);
  const [cfgStopLossDrop, setCfgStopLossDrop] = useState(-25);
  const [cfgMaxHoldMin, setCfgMaxHoldMin] = useState(720);

  // New V4 & RWA & Rebalance config states
  const [cfgRwaWidth, setCfgRwaWidth] = useState(10);
  const [cfgRwaCapital, setCfgRwaCapital] = useState(100);
  const [cfgAutoRebalance, setCfgAutoRebalance] = useState(true);
  const [cfgRebalanceDrift, setCfgRebalanceDrift] = useState(12);
  const [cfgNetPnlStopLoss, setCfgNetPnlStopLoss] = useState(-8);
  const [cfgMinOppFeeRate, setCfgMinOppFeeRate] = useState(80);

  // Single-Sided Upper Range Order States
  const [cfgEnableUpperPiercedExit, setCfgEnableUpperPiercedExit] = useState(true);
  const [cfgPumpMode, setCfgPumpMode] = useState<"SINGLE_SIDED_RANGE_ORDER" | "ASYMMETRIC_UPPER">("SINGLE_SIDED_RANGE_ORDER");
  const [cfgSingleSidedCorePct, setCfgSingleSidedCorePct] = useState(20);
  const [cfgSingleSidedMaxPct, setCfgSingleSidedMaxPct] = useState(45);
  const [cfgFastStopLossPct, setCfgFastStopLossPct] = useState(-8);

  // High-Liquidity Hot Tokens Config States
  const [cfgEnableHotTokensLp, setCfgEnableHotTokensLp] = useState(true);
  const [cfgHotTokensCapital, setCfgHotTokensCapital] = useState(20);

  // Sync form state when config loads
  const [hasSynced, setHasSynced] = useState(false);
  if (config && !hasSynced) {
    setCfgDryRun(config.dryRun);
    setCfgAutoLp(config.autoLpEnabled);
    setCfgCapitalUsd(config.capitalPerPoolUsd);
    setCfgMinVolToLiq(config.minVolumeToLiquidityRatio);
    setCfgWithdrawRatio(config.withdrawPrincipalFeeRatio);
    setCfgVolDropExit(config.volumeDropExitThresholdPct);
    setCfgStopLossDrop(config.stopLossPriceDropPct);
    setCfgMaxHoldMin(config.maxHoldMinutes);
    if (config.rwaBandWidthPct !== undefined) setCfgRwaWidth(config.rwaBandWidthPct);
    if (config.rwaCapitalUsd !== undefined) setCfgRwaCapital(config.rwaCapitalUsd);
    if (config.enableAutoRebalance !== undefined) setCfgAutoRebalance(config.enableAutoRebalance);
    if (config.rebalanceDriftThresholdPct !== undefined) setCfgRebalanceDrift(config.rebalanceDriftThresholdPct);
    if (config.netPnlStopLossPct !== undefined) setCfgNetPnlStopLoss(config.netPnlStopLossPct);
    if (config.minOpportunityFeeRatePct !== undefined) setCfgMinOppFeeRate(config.minOpportunityFeeRatePct);
    if (config.enableUpperPiercedExit !== undefined) setCfgEnableUpperPiercedExit(config.enableUpperPiercedExit);
    if (config.pumpMode !== undefined) setCfgPumpMode(config.pumpMode);
    if (config.singleSidedUpperCorePct !== undefined) setCfgSingleSidedCorePct(config.singleSidedUpperCorePct);
    if (config.singleSidedUpperMaxPct !== undefined) setCfgSingleSidedMaxPct(config.singleSidedUpperMaxPct);
    if (config.fastStopLossPct !== undefined) setCfgFastStopLossPct(config.fastStopLossPct);
    if (config.enableHotTokensLp !== undefined) setCfgEnableHotTokensLp(config.enableHotTokensLp);
    if (config.hotTokensCapitalUsd !== undefined) setCfgHotTokensCapital(config.hotTokensCapitalUsd);
    setHasSynced(true);
  }

  // Update Config Mutation
  const updateConfigMut = useMutation({
    mutationFn: (data: any) => updateLpConfig({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      qc.invalidateQueries({ queryKey: ["hotTokensList"] });
      toast.success("做市策略与风控配置已成功保存更新");
    },
    onError: (err: any) => {
      toast.error(`更新配置失败: ${err?.message || err}`);
    },
  });

  // Radar Scan Mutation
  const scanRadarMut = useMutation({
    mutationFn: () => triggerV4RadarScan(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["v4MarketSummary"] });
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success(
        `V4 雷达扫描完成: 锁定 ${res.opportunitiesCount} 个高收益做市机会, ${res.newPoolsCount} 个新上线池`,
      );
    },
    onError: (err: any) => {
      toast.error(`雷达扫描失败: ${err?.message || err}`);
    },
  });

  // Rebalance Mutation
  const rebalanceMut = useMutation({
    mutationFn: (positionId: string) => rebalanceLpPositionAction({ data: { positionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success("已完成智能动态移仓，区间已重新中枢化！");
    },
    onError: (err: any) => {
      toast.error(`移仓失败: ${err?.message || err}`);
    },
  });

  // 1-Click LP Mutation from Radar
  const quickOpenV4Mut = useMutation({
    mutationFn: (pool: V4PoolItem) =>
      openManualLp({
        data: {
          tokenAddress: pool.token0Address,
          symbol: pool.token0Symbol,
          name: pool.pairName,
          chain: "robinhood",
          pairAddress: pool.pairAddress,
          feeTier: pool.feeTierBps,
          priceUsd: pool.currentPriceUsd,
          liquidityUsd: pool.totalLiquidityUsd,
          volume5m: pool.volume2hUsd / 24,
          stage: pool.isRwa ? "RWA_STABLE" : "SIDEWAYS",
          isRwa: pool.isRwa,
          stockSymbol: pool.stockSymbol,
          category: pool.category,
          activeBandLiquidityUsd: pool.activeBandLiquidityUsd,
          dryRun: displayMode === "paper",
        },
      }),
    onSuccess: (pos) => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      if (!pos.dryRun) {
        toast.success(`🎉 真实链上做市头寸已铸造: $${pos.symbol} (NFT #${pos.tokenId || ""})`);
      } else if (displayMode === "live") {
        toast.warning(`已转入【模拟盘】建立测算头寸（标的仅在 V4 协议运行，未扣除链上资金）`);
        setDisplayMode("paper");
      } else {
        toast.success(`已成功在模拟盘为 $${pos.symbol} 建立做市头寸！`);
      }
    },
    onError: (err: any) => {
      toast.error(`建仓失败: ${err?.message || err}`);
    },
  });


  // Close Position Mutation
  const closePosMut = useMutation({
    mutationFn: (positionId: string) => closeLpPosition({ data: { positionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success("已成功撤回做市流动性并兑回 USDG");
    },
    onError: (err: any) => {
      toast.error(`撤池失败: ${err?.message || err}`);
    },
  });

  // Close All Mutation
  const closeAllMut = useMutation({
    mutationFn: (scope?: "paper" | "live" | "all") =>
      closeAllLpPositions({ data: { scope: scope || displayMode } }),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success(`已清仓当前所选模式下的 ${count} 个做市池流动性`);
    },
    onError: (err: any) => {
      toast.error(`全部撤池失败: ${err?.message || err}`);
    },
  });

  // Wallet Modal & Input State
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [inputPrivateKey, setInputPrivateKey] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // Wallet Import & Disconnect Mutations
  const importWalletMut = useMutation({
    mutationFn: (privateKey: string) => importLpWalletAction({ data: { privateKey } }),
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success(`做市钱包绑定成功！已就绪: ${shortAddr(status.walletAddress || "")}`);
      setShowWalletModal(false);
      setInputPrivateKey("");
    },
    onError: (err: any) => {
      toast.error(`钱包导入失败: ${err?.message || err}`);
    },
  });

  const disconnectWalletMut = useMutation({
    mutationFn: () => disconnectLpWalletAction(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success("已解绑做市钱包，系统已恢复为模拟做市模式");
    },
    onError: (err: any) => {
      toast.error(`解绑失败: ${err?.message || err}`);
    },
  });

  const refreshBalanceMut = useMutation({
    mutationFn: () => getLpWalletStatusAction(),
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      if (status.hasWallet) {
        toast.success(`余额已更新: ${status.ethBalance ?? "0.0000"} ETH · $${status.usdgBalance ?? "0.00"} USDG`);
      } else {
        toast.info("做市钱包未配置，请先导入私钥");
      }
    },
    onError: (err: any) => {
      toast.error(`刷新余额失败: ${err?.message || err}`);
    },
  });

  // Data Isolation: displayMode ("paper" | "live" | "all")
  const [displayMode, setDisplayMode] = useState<"paper" | "live" | "all">(
    config?.dryRun === false ? "live" : "paper",
  );

  const paperStats = lpData?.paperStats || {
    totalFeeEarnedUsd: 0,
    totalRealizedPnlUsd: 0,
    totalInvestedUsd: 0,
    activeCount: 0,
    closedCount: 0,
    winCount: 0,
    lossCount: 0,
    winRatePct: 0,
  };

  const liveStats = lpData?.liveStats || {
    totalFeeEarnedUsd: 0,
    totalRealizedPnlUsd: 0,
    totalInvestedUsd: 0,
    activeCount: 0,
    closedCount: 0,
    winCount: 0,
    lossCount: 0,
    winRatePct: 0,
  };

  const currentStats =
    displayMode === "live"
      ? liveStats
      : displayMode === "paper"
        ? paperStats
        : {
            totalFeeEarnedUsd: paperStats.totalFeeEarnedUsd + liveStats.totalFeeEarnedUsd,
            totalRealizedPnlUsd: paperStats.totalRealizedPnlUsd + liveStats.totalRealizedPnlUsd,
            totalInvestedUsd: paperStats.totalInvestedUsd + liveStats.totalInvestedUsd,
            activeCount: paperStats.activeCount + liveStats.activeCount,
            closedCount: paperStats.closedCount + liveStats.closedCount,
            winCount: paperStats.winCount + liveStats.winCount,
            lossCount: paperStats.lossCount + liveStats.lossCount,
            winRatePct:
              paperStats.closedCount + liveStats.closedCount > 0
                ? ((paperStats.winCount + liveStats.winCount) /
                    (paperStats.closedCount + liveStats.closedCount)) *
                  100
                : 0,
          };

  const allActivePositions = lpData?.activePositions || [];
  const activePositions = allActivePositions.filter((pos) => {
    if (displayMode === "live") return !pos.dryRun;
    if (displayMode === "paper") return pos.dryRun;
    return true;
  });

  const allClosedPositions = lpData?.closedPositions || [];
  const closedPositions = allClosedPositions.filter((pos) => {
    if (displayMode === "live") return !pos.dryRun;
    if (displayMode === "paper") return pos.dryRun;
    return true;
  });

  const walletStatus = lpData?.walletStatus;
  const hasWallet = Boolean(lpData?.walletAddress || walletStatus?.hasWallet);
  const walletAddr = lpData?.walletAddress || walletStatus?.walletAddress;
  const ethBalance = walletStatus?.ethBalance ?? "0.0000";
  const usdgBalance = walletStatus?.usdgBalance ?? "0.00";

  return (
    <div className="flex flex-col gap-6">
      {/* Market-Making Wallet Status Banner & Import Entry */}
      <div
        className={cn(
          "rounded-xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors",
          hasWallet
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <div className="flex items-start md:items-center gap-3">
          <div
            className={cn(
              "p-2.5 rounded-lg shrink-0",
              hasWallet
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-amber-500/20 text-amber-400",
            )}
          >
            <Wallet className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">
                {hasWallet
                  ? "LP 链上做市钱包已绑定"
                  : "LP 实盘做市钱包未配置 (当前处于模拟保护模式)"}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  hasWallet
                    ? "text-emerald-400 border-emerald-500/30"
                    : "text-amber-400 border-amber-500/30",
                )}
              >
                Robinhood Chain (ID: 4663)
              </Badge>
              {hasWallet && (
                <Badge
                  variant={walletStatus?.isReadyForLive ? "outline" : "stop"}
                  className="text-[10px]"
                >
                  {walletStatus?.isReadyForLive ? "🟢 实盘就绪" : "⚠️ 资金/燃料偏低"}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
              {hasWallet ? (
                <>
                  <span>
                    地址:{" "}
                    <code className="font-mono text-foreground font-medium">
                      {shortAddr(walletAddr || "")}
                    </code>
                  </span>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center"
                    onClick={() => {
                      if (walletAddr) {
                        navigator.clipboard.writeText(walletAddr);
                        toast.success("已复制完整做市钱包地址");
                      }
                    }}
                    title="复制完整地址"
                  >
                    <Copy className="size-3 ml-0.5" />
                  </button>
                  <a
                    href={`https://robinhoodchain.blockscout.com/address/${walletAddr}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                    title="在区块浏览器查看"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                  <span className="text-muted-foreground/40">|</span>
                  <span>
                    ⛽ ETH (Gas):{" "}
                    <strong
                      className={cn(
                        Number(ethBalance) < 0.001
                          ? "text-rose-400"
                          : "text-foreground font-semibold",
                      )}
                    >
                      {ethBalance} ETH
                    </strong>
                  </span>
                  <span className="text-muted-foreground/40">|</span>
                  <span>
                    💵 USDG (做市本金):{" "}
                    <strong
                      className={cn(
                        Number(usdgBalance) < 10
                          ? "text-amber-400"
                          : "text-foreground font-semibold",
                      )}
                    >
                      ${usdgBalance}
                    </strong>
                  </span>
                  {walletStatus?.warning && (
                    <span className="text-[11px] text-amber-400 ml-1">
                      ({walletStatus.warning})
                    </span>
                  )}
                </>
              ) : (
                <span>
                  开启实盘做市需在 <strong>Robinhood Chain (ID: 4663)</strong> 准备{" "}
                  <strong>ETH</strong> (Gas燃料) 与 <strong>USDG</strong> (做市本金)，点击右侧按钮导入独立子钱包私钥。
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          {hasWallet ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={refreshBalanceMut.isPending}
                onClick={() => refreshBalanceMut.mutate()}
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    refreshBalanceMut.isPending && "animate-spin",
                  )}
                />
                刷新余额
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                onClick={() => setShowWalletModal(true)}
              >
                <Key className="size-3.5" />
                重新导入 / 详情
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                disabled={disconnectWalletMut.isPending}
                onClick={() => {
                  if (
                    confirm(
                      "确定要解绑当前 LP 做市钱包吗？解绑后系统将自动恢复为模拟做市模式以保障安全。",
                    )
                  ) {
                    disconnectWalletMut.mutate();
                  }
                }}
              >
                解绑
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
              onClick={() => setShowWalletModal(true)}
            >
              <Key className="size-3.5" />
              🔑 导入 LP 做市钱包
            </Button>
          )}
        </div>
      </div>

      {/* Scope / Mode Isolation Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/30 p-2.5 rounded-xl border border-border/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setDisplayMode("paper")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
              displayMode === "paper"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <span>🛡️ 模拟做市数据</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/40 font-mono">
              {paperStats.activeCount} 活跃 / {paperStats.closedCount} 结项
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode("live")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
              displayMode === "live"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <span>🚀 真实链上实盘</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/40 font-mono">
              {liveStats.activeCount} 活跃 / {liveStats.closedCount} 结项
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode("all")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
              displayMode === "all"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <span>🌐 全部汇总数据</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/40 font-mono">
              {paperStats.activeCount + liveStats.activeCount} 活跃
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <span>当前统计口径:</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[11px]",
              displayMode === "live"
                ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                : displayMode === "paper"
                  ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                  : "text-blue-400 border-blue-500/30 bg-blue-500/10",
            )}
          >
            {displayMode === "live"
              ? "🚀 真实链上实盘 (已隔离)"
              : displayMode === "paper"
                ? "🛡️ 模拟沙盒 (已隔离)"
                : "🌐 模拟 + 实盘 汇总"}
          </Badge>
        </div>
      </div>

      {/* Top Banner & KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Engine Status */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">做市引擎状态</span>
            <Badge
              variant={config?.dryRun ? "outline" : "stop"}
              className="text-[10px]"
            >
              {config?.dryRun ? "🛡️ 模拟做市 (Dry-Run)" : "🚀 链上实盘 (Live)"}
            </Badge>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-2.5 rounded-full animate-pulse",
                  config?.autoLpEnabled ? "bg-emerald-400" : "bg-amber-400",
                )}
              />
              <span className="text-sm font-semibold">
                {config?.autoLpEnabled ? "自动做市已激活" : "自动做市已暂停"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                updateConfigMut.mutate({
                  autoLpEnabled: !config?.autoLpEnabled,
                })
              }
            >
              {config?.autoLpEnabled ? (
                <>
                  <Pause className="size-3 mr-1" /> 暂停
                </>
              ) : (
                <>
                  <Play className="size-3 mr-1" /> 启动
                </>
              )}
            </Button>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            单池分配: ${config?.capitalPerPoolUsd ?? 50} USDG · 费率: 1.0%
          </div>
        </div>

        {/* Card 2: Fee Accrued */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              累计手续费收入 ({displayMode === "live" ? "实盘" : displayMode === "paper" ? "模拟" : "汇总"})
            </span>
            <DollarSign className="size-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400">
            +${(currentStats.totalFeeEarnedUsd ?? 0).toFixed(2)}
            <span className="text-xs font-normal text-muted-foreground ml-1">USDG</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            高频换手过路费（含在持与已结项）
          </div>
        </div>

        {/* Card 3: Net Realized PnL */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              累计净盈亏 ({displayMode === "live" ? "实盘" : displayMode === "paper" ? "模拟" : "汇总"})
            </span>
            <TrendingUp className="size-4 text-cyan-400" />
          </div>
          <div
            className={cn(
              "mt-2 text-2xl font-bold",
              (currentStats.totalRealizedPnlUsd ?? 0) >= 0 ? "text-cyan-400" : "text-rose-400",
            )}
          >
            {(currentStats.totalRealizedPnlUsd ?? 0) >= 0 ? "+" : ""}
            ${(currentStats.totalRealizedPnlUsd ?? 0).toFixed(2)}
            <span className="text-xs font-normal text-muted-foreground ml-1">USDG</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            综合胜率: {(currentStats.winRatePct ?? 0).toFixed(1)}% ({currentStats.winCount ?? 0} 胜 / {currentStats.lossCount ?? 0} 负)
          </div>
        </div>

        {/* Card 4: Active Pools */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              当前做市池 ({displayMode === "live" ? "实盘" : displayMode === "paper" ? "模拟" : "汇总"})
            </span>
            <Layers className="size-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {activePositions.length}
            <span className="text-xs font-normal text-muted-foreground ml-1">
              / 最多 {config?.maxActivePools ?? 5} 个活跃池
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>已结项历史: {closedPositions.length} 个</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowConfig(!showConfig)}
            >
              <Sliders className="size-3 mr-1" />
              {showConfig ? "收起参数" : "做市参数"}
            </Button>
          </div>
        </div>
      </div>

      {/* Config Drawer */}
      {showConfig && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div className="flex items-center gap-2">
              <Settings className="size-4 text-blue-400" />
              <span className="text-sm font-semibold text-foreground">
                Robinhood V3 非对称做市与极速熔断参数配置
              </span>
            </div>
            <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">
              Robinhood Chain (Pons / Uniswap V3)
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {/* Param 1: Dry-Run Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium flex items-center justify-between">
                <span>实盘模式</span>
                {!hasWallet && (
                  <button
                    type="button"
                    onClick={() => setShowWalletModal(true)}
                    className="text-[10px] text-amber-400 hover:underline"
                  >
                    未配私钥
                  </button>
                )}
              </label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgDryRun ? "dry" : "live"}
                onChange={(e) => {
                  const isDry = e.target.value === "dry";
                  if (!isDry && !hasWallet) {
                    toast.warning("尚未绑定做市钱包，请先导入专属实盘子钱包私钥");
                    setShowWalletModal(true);
                    return;
                  }
                  setCfgDryRun(isDry);
                }}
              >
                <option value="dry">🛡️ 模拟实盘 (Dry-Run 无链上资金损耗)</option>
                <option value="live">🚀 真实上链 (Live 需要配置私钥)</option>
              </select>
            </div>

            {/* Param 2: Capital per pool */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">单池做市资金 (USDG)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgCapitalUsd}
                onChange={(e) => setCfgCapitalUsd(Number(e.target.value))}
              />
            </div>

            {/* Param 3: Volume to Liquidity Ratio */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">5m成交/深度准入门槛 (倍比)</label>
              <input
                type="number"
                step="0.1"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgMinVolToLiq}
                onChange={(e) => setCfgMinVolToLiq(Number(e.target.value))}
              />
            </div>

            {/* Param 4: Principal Recovery Ratio */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">保本提润门槛 (手续费达到本金比)</label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgWithdrawRatio}
                onChange={(e) => setCfgWithdrawRatio(Number(e.target.value))}
              >
                <option value={0.25}>25% (回本 25% 时提取本金保底)</option>
                <option value={0.35}>35% (推荐: 回本 35% 时提取 50% 本金)</option>
                <option value={0.5}>50% (半本保底)</option>
              </select>
            </div>

            {/* Param 5: Volume Drop Exit */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">量能枯竭撤退阈值 (5m环比跌幅)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgVolDropExit}
                onChange={(e) => setCfgVolDropExit(Number(e.target.value))}
              />
            </div>

            {/* Param 6: Stop Loss Drop */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">下沿击穿熔断比例 (%)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgStopLossDrop}
                onChange={(e) => setCfgStopLossDrop(Number(e.target.value))}
              />
            </div>

            {/* Param 7: Max Hold Minutes */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">最大持仓周期 (分钟)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgMaxHoldMin}
                onChange={(e) => setCfgMaxHoldMin(Number(e.target.value))}
              />
            </div>

            {/* Param 8: RWA Band Width */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">美股 RWA 窄带宽度 (±%)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgRwaWidth}
                onChange={(e) => setCfgRwaWidth(Number(e.target.value))}
              />
            </div>

            {/* Param 9: RWA Capital */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">RWA 单池资金 (USDG)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgRwaCapital}
                onChange={(e) => setCfgRwaCapital(Number(e.target.value))}
              />
            </div>

            {/* Param 10: Dynamic Rebalance */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">智能动态移仓自愈</label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgAutoRebalance ? "on" : "off"}
                onChange={(e) => setCfgAutoRebalance(e.target.value === "on")}
              >
                <option value="on">✅ 开启 (偏离区间自动中枢化)</option>
                <option value="off">❌ 关闭 (保持静态区间)</option>
              </select>
            </div>

            {/* Param 11: Rebalance Drift */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">移仓偏离触发阈值 (±%)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgRebalanceDrift}
                onChange={(e) => setCfgRebalanceDrift(Number(e.target.value))}
              />
            </div>

            {/* Param 12: Net PnL Stop Loss */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">净盈亏硬止损线 (%)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgNetPnlStopLoss}
                onChange={(e) => setCfgNetPnlStopLoss(Number(e.target.value))}
              />
            </div>

            {/* Param 13: Radar Opportunity Min Daily Fee */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">雷达机会报警日费率 (%/天)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgMinOppFeeRate}
                onChange={(e) => setCfgMinOppFeeRate(Number(e.target.value))}
              />
            </div>

            {/* Param 14: Single-Sided Upper Range Order Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium flex items-center gap-1">
                <span>做市策略模式</span>
                <span className="text-[10px] text-cyan-400 font-normal">(Range Order 限价卖)</span>
              </label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground font-medium"
                value={cfgPumpMode}
                onChange={(e) => setCfgPumpMode(e.target.value as any)}
              >
                <option value="SINGLE_SIDED_RANGE_ORDER">🚀 单边上方限价卖出 (推荐: 穿上沿收割)</option>
                <option value="ASYMMETRIC_UPPER">⚖️ 经典非对称做市 (保留底仓)</option>
              </select>
            </div>

            {/* Param 15: Upper Pierced Auto Exit */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium flex items-center gap-1">
                <span>穿上沿全额限价兑回 USDG 撤池</span>
              </label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground font-medium"
                value={cfgEnableUpperPiercedExit ? "on" : "off"}
                onChange={(e) => setCfgEnableUpperPiercedExit(e.target.value === "on")}
              >
                <option value="on">🎯 开启 (穿上沿100%全额兑USDG并撤池锁定暴利)</option>
                <option value="off">❌ 关闭 (突破上沿后继续挂单)</option>
              </select>
            </div>

            {/* Param 16: Single Sided Upper Core % */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">单边核心收租区间 (+% 从现价)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgSingleSidedCorePct}
                onChange={(e) => setCfgSingleSidedCorePct(Number(e.target.value))}
              />
            </div>

            {/* Param 17: Single Sided Upper Max % */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">穿上沿自动止盈点 (+% 从现价)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgSingleSidedMaxPct}
                onChange={(e) => setCfgSingleSidedMaxPct(Number(e.target.value))}
              />
            </div>

            {/* Param 18: Fast Stop Loss */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">单边快速防崩止损 (%)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgFastStopLossPct}
                onChange={(e) => setCfgFastStopLossPct(Number(e.target.value))}
              />
            </div>

            {/* Param 19: Hot Tokens Auto LP Enabled */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">🔥 热门蓝筹/RWA 自动做市</label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground text-xs"
                value={cfgEnableHotTokensLp ? "true" : "false"}
                onChange={(e) => setCfgEnableHotTokensLp(e.target.value === "true")}
              >
                <option value="true">开启 (空闲池位自动分配主流标的)</option>
                <option value="false">关闭 (仅手动触发热门做市)</option>
              </select>
            </div>

            {/* Param 20: Hot Tokens Capital */}
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-medium">热门标的单池资金 ($ USDG)</label>
              <input
                type="number"
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgHotTokensCapital}
                onChange={(e) => setCfgHotTokensCapital(Number(e.target.value))}
              />
            </div>

            {/* Actions */}
            <div className="flex items-end gap-2 col-span-1 sm:col-span-2 md:col-span-3">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs h-8 font-semibold"
                onClick={() =>
                  updateConfigMut.mutate({
                    dryRun: cfgDryRun,
                    autoLpEnabled: cfgAutoLp,
                    capitalPerPoolUsd: cfgCapitalUsd,
                    minVolumeToLiquidityRatio: cfgMinVolToLiq,
                    withdrawPrincipalFeeRatio: cfgWithdrawRatio,
                    volumeDropExitThresholdPct: cfgVolDropExit,
                    stopLossPriceDropPct: cfgStopLossDrop,
                    maxHoldMinutes: cfgMaxHoldMin,
                    rwaBandWidthPct: cfgRwaWidth,
                    rwaCapitalUsd: cfgRwaCapital,
                    enableAutoRebalance: cfgAutoRebalance,
                    rebalanceDriftThresholdPct: cfgRebalanceDrift,
                    netPnlStopLossPct: cfgNetPnlStopLoss,
                    minOpportunityFeeRatePct: cfgMinOppFeeRate,
                    enableUpperPiercedExit: cfgEnableUpperPiercedExit,
                    pumpMode: cfgPumpMode,
                    singleSidedUpperCorePct: cfgSingleSidedCorePct,
                    singleSidedUpperMaxPct: cfgSingleSidedMaxPct,
                    fastStopLossPct: cfgFastStopLossPct,
                    enableHotTokensLp: cfgEnableHotTokensLp,
                    hotTokensCapitalUsd: cfgHotTokensCapital,
                  })
                }
                disabled={updateConfigMut.isPending}
              >
                保存全部策略与风控配置
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* High-Liquidity Hot Tokens Section */}
      <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 via-background to-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Flame className="size-5 text-amber-400 animate-pulse" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  🔥 热门高流动性做市 (主流蓝筹 WETH & 美股 RWA 专区)
                </h3>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  {hotTokensList?.length || 7} 个核心池
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                聚焦 Robinhood 链上高换手蓝筹（WETH/USDG 日交易量上亿）与已部署 Uniswap V3 的美股 RWA 代币（AAPL、TSLA、NVDA、SPY 等），专注极深流动性摩擦收租
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/30 hover:bg-amber-500/10 text-amber-300"
              onClick={() => refetchHotTokens()}
            >
              <RefreshCw className="size-3 mr-1" />
              刷新行情
            </Button>
          </div>
        </div>

        {/* Hot Tokens Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {(hotTokensList || []).map((t) => (
            <div
              key={t.symbol}
              className={cn(
                "flex flex-col justify-between rounded-lg border p-3 transition-colors",
                t.hasActivePosition
                  ? "border-emerald-500/40 bg-emerald-950/10"
                  : "border-border/50 bg-secondary/20 hover:border-amber-500/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-foreground">${t.symbol}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-500/30 text-amber-300">
                      {t.category === "RWA" ? "🏛️ 美股" : "💎 蓝筹"}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/30">
                      {t.feeTier === 500 ? "0.05%" : "0.3%"}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                    {t.name}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">
                    ${t.priceUsd > 1 ? t.priceUsd.toFixed(2) : t.priceUsd.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-medium">
                    预估日费率 +{t.estDailyFeeRatePct}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 my-2.5 py-1.5 border-y border-border/30 text-[11px]">
                <div>
                  <span className="text-muted-foreground">24H 成交量:</span>
                  <div className="font-semibold text-foreground">
                    ${formatUsd(t.volume24hUsd)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">做市池深度:</span>
                  <div className="font-semibold text-foreground">
                    ${formatUsd(t.liquidityUsd)}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground mb-2.5 flex items-center gap-1">
                <Info className="size-3 text-amber-400 shrink-0" />
                <span className="truncate">{t.statusDesc}</span>
              </div>

              <div className="mt-auto pt-1">
                {t.hasActivePosition ? (
                  <Badge className="w-full justify-center bg-emerald-500/20 text-emerald-300 border-emerald-500/30 py-1 font-normal text-xs">
                    <CheckCircle2 className="size-3 mr-1" /> 已在活跃做市中
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold shadow-sm"
                    disabled={triggerHotLpMut.isPending}
                    onClick={() =>
                      triggerHotLpMut.mutate({
                        symbol: t.symbol,
                        customCapitalUsd: config?.hotTokensCapitalUsd || 20,
                        dryRun: displayMode === "live" ? false : true,
                      })
                    }
                  >
                    <Zap className="size-3 mr-1 fill-current" />
                    一键以 ${config?.hotTokensCapitalUsd || 20} 开做市池
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Robinhood V4 Barker Market Radar Section */}
      <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 to-background p-4">
        {/* Radar Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Radar className="size-5 text-indigo-400 animate-pulse" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  Robinhood V4 做市机会雷达 (Barker 实时做市情报)
                </h3>
                <Badge variant="outline" className="text-[10px] text-indigo-400 border-indigo-500/30">
                  全网索引 {v4Summary?.indexedPoolsCount ?? 0} 个池
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                实时追踪 Robinhood Chain 上的 Uniswap V4 集中流动性日费率、活跃带集中深度与美股 RWA / 热门 Meme 做市机会
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-indigo-500/30 hover:bg-indigo-500/10 text-indigo-300"
              onClick={() => scanRadarMut.mutate()}
              disabled={scanRadarMut.isPending}
            >
              <Sparkles className="size-3 mr-1" />
              {scanRadarMut.isPending ? "扫描中..." : "触发即时扫描"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => refetchV4()}
            >
              <RefreshCw className="size-3" />
            </Button>
            <a
              href="https://app.barker.money/raid/robinhood"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-400 hover:underline flex items-center gap-1 ml-1"
            >
              Barker 终端 <ExternalLink className="size-3" />
            </a>
          </div>
        </div>

        {/* Global Market Mini Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/30 rounded-lg p-2.5 text-xs">
          <div>
            <span className="text-muted-foreground">24H 市场成交总额:</span>
            <div className="font-bold text-foreground text-sm mt-0.5">
              ${formatUsd(v4Summary?.total24hVolumeUsd ?? 406000000)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">24H 产出过路费:</span>
            <div className="font-bold text-emerald-400 text-sm mt-0.5">
              +${formatUsd(v4Summary?.total24hFeeUsd ?? 2950000)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">市场平均日费率:</span>
            <div className="font-bold text-amber-400 text-sm mt-0.5">
              +{(v4Summary?.avgDailyFeeRatePct ?? 0).toFixed(1)}%/天
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">超高收益池数量:</span>
            <div className="font-bold text-cyan-400 text-sm mt-0.5">
              {(v4Summary?.topYieldPools ?? []).filter((p) => p.dailyFeeRatePct >= 100).length} 个 (&gt;100%/天)
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Button
            size="sm"
            variant={radarFilter === "top" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setRadarFilter("top")}
          >
            <Flame className="size-3 mr-1 text-amber-400" />
            Top 高收益做市池 ({v4Summary?.topYieldPools.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={radarFilter === "rwa" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setRadarFilter("rwa")}
          >
            <Landmark className="size-3 mr-1 text-purple-400" />
            🏛️ 美股 RWA 专区 ({v4Summary?.rwaPools.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={radarFilter === "meme" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setRadarFilter("meme")}
          >
            <Coins className="size-3 mr-1 text-cyan-400" />
            🐸 Meme 热门池 ({v4Summary?.memePools.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={radarFilter === "new" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setRadarFilter("new")}
          >
            <Sparkles className="size-3 mr-1 text-emerald-400" />
            ✨ 24H 新上线池 ({v4Summary?.newPools.length ?? 0})
          </Button>
        </div>

        {/* Filtered Pools Table */}
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-secondary/40 text-muted-foreground border-b border-border/60">
              <tr>
                <th className="py-2 px-3">交易对 / 费率</th>
                <th className="py-2 px-3">日费率 (2H折算)</th>
                <th className="py-2 px-3">折合年化 APR</th>
                <th className="py-2 px-3">±15% 活跃集中深度</th>
                <th className="py-2 px-3">2H 成交额 / 费</th>
                <th className="py-2 px-3">资本效率 / 健康度</th>
                <th className="py-2 px-3 text-right">快捷操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {((() => {
                if (!v4Summary) return [];
                if (radarFilter === "rwa") return v4Summary.rwaPools;
                if (radarFilter === "meme") return v4Summary.memePools;
                if (radarFilter === "new") return v4Summary.newPools;
                return v4Summary.topYieldPools;
              })()).slice(0, 15).map((pool) => (
                <tr key={pool.poolId} className="hover:bg-secondary/20 transition-colors">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-foreground text-xs">{pool.pairName}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0",
                          pool.feeTierPct >= 4 ? "border-amber-500/40 text-amber-400" : "border-border",
                        )}
                      >
                        {pool.feeTierPct}%
                      </Badge>
                      {pool.feeTierBps >= 40000 || pool.poolId.length === 66 ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 border-indigo-500/40 text-indigo-300 bg-indigo-500/10"
                        >
                          V4 Barker
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 border-blue-500/40 text-blue-300 bg-blue-500/10"
                        >
                          V3
                        </Badge>
                      )}
                      {pool.isRwa && (
                        <Badge className="text-[9px] px-1 py-0 bg-purple-500/10 text-purple-400 border border-purple-500/30">
                          美股 {pool.stockSymbol}
                        </Badge>
                      )}
                      {pool.isNewPool && (
                        <Badge className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          新池
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <span>
                        1h: {pool.priceChange1hPct >= 0 ? "+" : ""}
                        {pool.priceChange1hPct.toFixed(1)}%
                      </span>
                      <span>· CA: {shortAddr(pool.token0Address)}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="font-bold text-emerald-400 text-sm">
                      +{pool.dailyFeeRatePct.toFixed(1)}%/天
                    </span>
                  </td>
                  <td className="py-2 px-3 text-cyan-400 font-semibold">
                    +{pool.annualizedAprPct.toLocaleString()}%
                  </td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-foreground">
                      ${pool.activeBandLiquidityUsd.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      全池: ${pool.totalLiquidityUsd.toLocaleString()}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="text-foreground">${pool.volume2hUsd.toLocaleString()}</div>
                    <div className="text-[10px] text-emerald-400">
                      费: +${pool.fee2hUsd.toLocaleString()}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="text-xs font-semibold text-blue-400">
                      {pool.capitalEfficiency.toFixed(1)}x 乘数
                    </div>
                    <div className="text-[10px] text-muted-foreground">健康分: {pool.healthScore}/100</div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white"
                      onClick={() => quickOpenV4Mut.mutate(pool)}
                      disabled={quickOpenV4Mut.isPending}
                    >
                      一键做市
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active LP Positions Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-foreground">
              当前活跃做市池 ({activePositions.length})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => refetch()}
            >
              <RefreshCw className="size-3 mr-1" /> 刷新
            </Button>
            {activePositions.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  const scopeDesc =
                    displayMode === "live"
                      ? "真实链上实盘"
                      : displayMode === "paper"
                        ? "模拟沙盒"
                        : "全量（含实盘与模拟）";
                  if (
                    confirm(
                      `确定要对当前范围 [${scopeDesc}] 下的所有 ${activePositions.length} 个在持做市头寸执行紧急一键撤池并兑回 USDG 吗？`,
                    )
                  ) {
                    closeAllMut.mutate(displayMode);
                  }
                }}
                disabled={closeAllMut.isPending}
              >
                <Trash2 className="size-3 mr-1" /> 一键撤池 (
                {displayMode === "live" ? "实盘" : displayMode === "paper" ? "模拟" : "全部"})
              </Button>
            )}
          </div>
        </div>

        {activePositions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
            <Layers className="size-8 text-muted-foreground/40" />
            <div className="font-medium text-foreground">
              当前【{displayMode === "live" ? "实盘" : "模拟"}】模式下暂无活跃做市池
            </div>
            {displayMode === "live" && allActivePositions.some((p) => p.dryRun) && (
              <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs max-w-md">
                <span>
                  💡 模拟盘中检测到 {allActivePositions.filter((p) => p.dryRun).length} 个活跃测算池（未部署 V3 池的标的已安全转入模拟测算，本金未扣除）。
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
                  onClick={() => setDisplayMode("paper")}
                >
                  切换至【模拟测算】查看
                </Button>
              </div>
            )}
            <div className="text-xs text-muted-foreground/70 max-w-md">
              当扫描雷达或 TG 频道发现满足 5m 成交量 / 流动性 ≥ {config?.minVolumeToLiquidityRatio ?? 1.5} 的高频标的时，系统将自动建仓并在区间内收租。
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activePositions.map((pos) => {
              const isPump = pos.stage === "PUMP";
              const isRwa = pos.stage === "RWA_STABLE" || pos.isRwa;
              const isProfit = pos.netPnlUsd >= 0;

              return (
                <div
                  key={pos.id}
                  className="rounded-xl border border-border/80 bg-card p-4 flex flex-col gap-3 transition-colors hover:border-blue-500/40"
                >
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-foreground">
                        ${pos.symbol}
                      </span>
                      {pos.name && (
                        <span className="text-xs text-muted-foreground max-w-[140px] truncate">
                          ({pos.name})
                        </span>
                      )}
                      {pos.dryRun ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-amber-500/40 text-amber-300 bg-amber-500/10"
                        >
                          🛡️ 模拟
                        </Badge>
                      ) : (
                        <>
                          <Badge
                            variant="outline"
                            className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10 font-semibold"
                          >
                            🚀 实盘
                          </Badge>
                          {pos.tokenId && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-blue-500/40 text-blue-300 bg-blue-500/10"
                            >
                              NFT #{pos.tokenId}
                            </Badge>
                          )}
                          {pos.onChainTxHash && (
                            <a
                              href={`https://robinhoodchain.blockscout.com/tx/${pos.onChainTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              链上凭证 <ExternalLink className="size-2.5" />
                            </a>
                          )}
                        </>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          isRwa
                            ? "border-purple-500/40 text-purple-400 bg-purple-500/10"
                            : isPump
                              ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                              : "border-cyan-500/40 text-cyan-400 bg-cyan-500/10",
                        )}
                      >
                        {isRwa ? "🏛️ 美股 RWA 窄带" : isPump ? "🚀 拉升期偏上方多段" : "⚖️ 横盘期Spot核心震荡"}
                      </Badge>
                      {pos.status === "PRINCIPAL_SECURED" && (
                        <Badge variant="go" className="text-[10px]">
                          🛡️ 已保本锁定
                        </Badge>
                      )}
                      {(pos.rebalanceCount || 0) > 0 && (
                        <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-400 bg-blue-500/10">
                          🔄 移仓: 第 {pos.rebalanceCount} 次
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2 border-blue-500/30 hover:bg-blue-500/10 text-blue-300"
                        onClick={() => rebalanceMut.mutate(pos.id)}
                        disabled={rebalanceMut.isPending}
                      >
                        <RefreshCw className="size-3 mr-1" />
                        动态移仓
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => {
                          navigator.clipboard.writeText(pos.tokenAddress);
                          toast.success("合约地址已复制");
                        }}
                      >
                        <Copy className="size-3 mr-1" />
                        {shortAddr(pos.tokenAddress)}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => closePosMut.mutate(pos.id)}
                        disabled={closePosMut.isPending}
                      >
                        一键撤池 Flash Exit
                      </Button>
                    </div>
                  </div>

                  {/* Core Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">入场/现价:</span>
                      <div className="font-semibold text-foreground mt-0.5">
                        ${pos.entryPriceUsd} / ${pos.currentPriceUsd}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">做市资金/活跃深度:</span>
                      <div className="font-semibold text-foreground mt-0.5">
                        ${pos.initialUsdInvested.toFixed(0)} / ${(pos.activeBandLiquidityUsd || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">实时日费率 / 乘数:</span>
                      <div className="font-bold text-amber-400 mt-0.5">
                        +{(pos.dailyFeeRatePct || 0).toFixed(1)}%/天 ({pos.capitalEfficiencyRatio?.toFixed(1) ?? "7.5"}x)
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">手续费收入:</span>
                      <div className="font-bold text-emerald-400 mt-0.5">
                        +${pos.feeEarnedUsd.toFixed(2)} USDG
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">净盈亏 (扣IL):</span>
                      <div
                        className={cn(
                          "font-bold mt-0.5",
                          isProfit ? "text-cyan-400" : "text-rose-400",
                        )}
                      >
                        {isProfit ? "+" : ""}${pos.netPnlUsd.toFixed(2)} ({isProfit ? "+" : ""}{pos.netPnlPct.toFixed(1)}%)
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">做市优势分 (对比持币):</span>
                      <div className="font-bold text-blue-400 mt-0.5">
                        {pos.holdVsLpScore ?? 50} / 100
                      </div>
                    </div>
                  </div>

                  {/* Single-Sided Upper Range Order Piercing Tracker */}
                  {pos.upperPiercedTargetPriceUsd && pos.upperPiercedTargetPriceUsd > pos.entryPriceUsd && (
                    <div className="rounded-lg bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 border border-emerald-500/30 p-2.5 flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <span>🎯 单边上方限价卖进度:</span>
                          <span className="text-emerald-400 font-mono">
                            现价 ${pos.currentPriceUsd} → 目标上沿 ${pos.upperPiercedTargetPriceUsd.toFixed(6)}
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-[11px]">
                            距100%兑回USDG还需:{" "}
                            <strong
                              className={cn(
                                pos.currentPriceUsd >= pos.upperPiercedTargetPriceUsd
                                  ? "text-emerald-400"
                                  : "text-amber-300",
                              )}
                            >
                              {pos.currentPriceUsd >= pos.upperPiercedTargetPriceUsd
                                ? "已穿上沿 (触发止盈撤池)"
                                : `+${(((pos.upperPiercedTargetPriceUsd - pos.currentPriceUsd) / pos.currentPriceUsd) * 100).toFixed(1)}%`}
                            </strong>
                          </span>
                          {(pos.upperPiercedProgressPct || 0) >= 80 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/20 animate-pulse"
                            >
                              🔥 逼近上沿自动止盈
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-secondary/80 rounded-full h-2 overflow-hidden border border-border/40">
                        <div
                          className="bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400 h-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(5, pos.upperPiercedProgressPct || 0))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* V3 Ranges Visual Breakdown */}
                  <div className="rounded-lg bg-secondary/40 border border-border/40 p-2.5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
                      <span>V3 动态流动性分布与做市区间状态:</span>
                      <span>
                        5m 成交量: ${pos.latestVolume5m.toLocaleString()} (入场比: {(pos.volume5mAtEntry / Math.max(1, pos.liquidityAtEntry)).toFixed(2)}x)
                      </span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1 text-[11px]">
                      {pos.ranges.map((range, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "rounded p-2 border",
                            range.inRange
                              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                              : "bg-background/40 border-border/40 text-muted-foreground",
                          )}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span>{range.segmentName}</span>
                            {range.inRange && (
                              <Badge variant="go" className="text-[9px] px-1 py-0">
                                正在吃费
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 text-[10px]">
                            ${range.minPriceUsd.toFixed(5)} ~ ${range.maxPriceUsd.toFixed(5)}
                          </div>
                          <div className="text-[10px] text-muted-foreground/80">
                            分配: ${range.capitalAllocatedUsd.toFixed(2)} USDG
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Closed Positions History */}
      <div className="flex flex-col gap-3 mt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              历史做市结项战报 ({closedPositions.length})
            </h3>
          </div>
        </div>

        {closedPositions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
            暂无已结项的历史做市记录
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/40 text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-2.5 px-3">模式</th>
                  <th className="py-2.5 px-3">代币标的</th>
                  <th className="py-2.5 px-3">做市周期</th>
                  <th className="py-2.5 px-3">初始本金</th>
                  <th className="py-2.5 px-3">手续费产出</th>
                  <th className="py-2.5 px-3">无常损失 (IL)</th>
                  <th className="py-2.5 px-3">最终净盈亏</th>
                  <th className="py-2.5 px-3">撤池原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {closedPositions.map((pos) => {
                  const isPos = pos.netPnlUsd >= 0;
                  const entryTime = pos.entryTime ? pos.entryTime.slice(11, 16) : "--";
                  const closeTime = pos.closeTime ? pos.closeTime.slice(11, 16) : "--";

                  return (
                    <tr key={pos.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="py-2.5 px-3">
                        {pos.dryRun ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-amber-500/40 text-amber-300 bg-amber-500/10"
                          >
                            🛡️ 模拟
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10 font-semibold"
                          >
                            🚀 实盘
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        ${pos.symbol}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {entryTime} → {closeTime}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        ${pos.initialUsdInvested.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-400">
                        +${pos.feeEarnedUsd.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-rose-400">
                        -${pos.impermanentLossUsd.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 px-3 font-bold",
                          isPos ? "text-cyan-400" : "text-rose-400",
                        )}
                      >
                        {isPos ? "+" : ""}${pos.netPnlUsd.toFixed(2)} ({isPos ? "+" : ""}{pos.netPnlPct.toFixed(1)}%)
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground max-w-[220px] truncate">
                        {pos.status === "CLOSED_TAKEPROFIT_PIERCED" ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">
                            🎯 穿上沿限价止盈
                          </span>
                        ) : (
                          pos.exitReason || pos.status
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Wallet Import & Detailed Requirements Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                  <Wallet className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    导入 Robinhood Chain LP 做市钱包
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    配置 Uniswap V4 集中流动性做市私钥，开启自动化上链做市
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowWalletModal(false);
                  setInputPrivateKey("");
                }}
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Wallet & Token Requirements Notice */}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex flex-col gap-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-blue-400">
                <Info className="size-4 shrink-0" />
                <span>做市钱包与资产要求（请仔细阅读）</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                {/* Network requirement */}
                <div className="rounded-lg bg-card/70 border border-border/50 p-3 flex flex-col gap-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    🌐 目标区块链网络
                  </span>
                  <span className="text-muted-foreground">
                    网络：<strong className="text-foreground">Robinhood Chain</strong> (EVM 兼容)
                  </span>
                  <span className="text-muted-foreground">
                    Chain ID: <code className="text-foreground font-mono">4663</code>
                  </span>
                  <span className="text-muted-foreground">
                    RPC: <code className="text-[11px] font-mono text-muted-foreground break-all">https://rpc.mainnet.chain.robinhood.com</code>
                  </span>
                </div>

                {/* Gas requirement */}
                <div className="rounded-lg bg-card/70 border border-border/50 p-3 flex flex-col gap-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    ⛽ 必须储备代币 1 (Gas 燃料)
                  </span>
                  <span className="text-muted-foreground">
                    币种：<strong className="text-foreground">ETH</strong> (以太坊原生代币)
                  </span>
                  <span className="text-muted-foreground">
                    用途：支付链上加池、调仓、提取手续费与撤池 Gas 费
                  </span>
                  <span className="text-muted-foreground">
                    建议储备：<strong className="text-emerald-400">0.002 ~ 0.005 ETH</strong> (单笔 Gas 约 $0.002，足够数百次交互)
                  </span>
                </div>

                {/* Capital requirement */}
                <div className="rounded-lg bg-card/70 border border-border/50 p-3 flex flex-col gap-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    💵 必须储备代币 2 (做市本金)
                  </span>
                  <span className="text-muted-foreground">
                    币种：<strong className="text-foreground">USDG</strong> (Canal USDG 稳定币)
                  </span>
                  <span className="text-muted-foreground">
                    合约：<code className="text-[11px] font-mono break-all text-muted-foreground">0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168</code>
                  </span>
                  <span className="text-muted-foreground">
                    建议储备：小资金推荐 <strong className="text-cyan-400">$50 ~ $200 USDG</strong>
                  </span>
                </div>

                {/* Optional token requirement */}
                <div className="rounded-lg bg-card/70 border border-border/50 p-3 flex flex-col gap-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    🏛️ 可选储备代币 3 (标的资产)
                  </span>
                  <span className="text-muted-foreground">
                    币种：<strong className="text-foreground">CANAL / 目标美股 / 目标Meme</strong>
                  </span>
                  <span className="text-muted-foreground">
                    说明：若仅持有 USDG，系统在集中流动性建仓时亦支持单边配置或自动兑换。
                  </span>
                </div>
              </div>

              {/* Security Warning */}
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2.5 text-rose-300">
                <ShieldAlert className="size-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="flex flex-col gap-1">
                  <span className="font-bold text-rose-200">
                    安全隔离重要提醒（严格遵守）：
                  </span>
                  <span className="text-[11px] leading-relaxed">
                    1. <strong>请务必生成全新的独立小额子钱包</strong>（仅转入用于测试做市的几十刀 ETH 和 USDG），<strong>严禁导入存有主力大额资产的主钱包！</strong><br />
                    2. 私钥在服务器本地加密隔离保存（<code>data/lp-wallet.json</code>，权限 0600，且在 .gitignore 中永久防泄露），不经过任何第三方云端。
                  </span>
                </div>
              </div>
            </div>

            {/* Current wallet status if bound */}
            {hasWallet && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-400">当前已绑定做市钱包</span>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                    已连接
                  </Badge>
                </div>
                <div className="font-mono text-sm text-foreground bg-secondary/50 p-2 rounded border border-border/50 break-all">
                  {walletAddr}
                </div>
                <div className="flex items-center gap-4 text-muted-foreground mt-1">
                  <span>⛽ ETH: <strong className="text-foreground">{ethBalance} ETH</strong></span>
                  <span>💵 USDG: <strong className="text-foreground">${usdgBalance} USDG</strong></span>
                </div>
              </div>
            )}

            {/* Private key input form */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>{hasWallet ? "更换做市钱包私钥" : "输入做市钱包私钥"}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  64 位十六进制私钥 (以 0x 开头或不带)
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPrivateKey ? "text" : "password"}
                  placeholder="0x1234567890abcdef..."
                  className="w-full bg-secondary/60 border border-border/60 rounded-xl px-3.5 py-2.5 text-xs text-foreground font-mono focus:outline-none focus:border-blue-500/80 pr-10"
                  value={inputPrivateKey}
                  onChange={(e) => setInputPrivateKey(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                >
                  {showPrivateKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              {hasWallet ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  disabled={disconnectWalletMut.isPending}
                  onClick={() => {
                    if (confirm("确定要解绑当前做市钱包吗？系统将自动切回模拟模式。")) {
                      disconnectWalletMut.mutate();
                      setShowWalletModal(false);
                      setInputPrivateKey("");
                    }
                  }}
                >
                  解绑并重置为模拟模式
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setShowWalletModal(false);
                    setInputPrivateKey("");
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white"
                  disabled={!inputPrivateKey.trim() || importWalletMut.isPending}
                  onClick={() => {
                    importWalletMut.mutate(inputPrivateKey);
                  }}
                >
                  {importWalletMut.isPending ? "校验并保存中..." : "测试并保存绑定"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
