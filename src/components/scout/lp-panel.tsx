import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
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
} from "@/lib/scout/actions";
import { formatUsd, shortAddr } from "@/lib/scout/format";
import type { LpPosition, LpRangeSegment } from "@/lib/scout/types";
import { cn } from "@/lib/utils";

export function LpPanel({
  onInspect,
}: {
  onInspect?: (address: string) => void;
}) {
  const qc = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);

  // Fetch LP State
  const { data: lpData, isLoading, refetch } = useQuery({
    queryKey: ["lpState"],
    queryFn: () => getLpState(),
    refetchInterval: 5000,
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
    setHasSynced(true);
  }

  // Update Config Mutation
  const updateConfigMut = useMutation({
    mutationFn: (data: any) => updateLpConfig({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success("LP 做市配置已成功更新");
    },
    onError: (err: any) => {
      toast.error(`更新配置失败: ${err?.message || err}`);
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
    mutationFn: () => closeAllLpPositions(),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["lpState"] });
      toast.success(`已清仓全部 ${count} 个做市池流动性`);
    },
    onError: (err: any) => {
      toast.error(`全部撤池失败: ${err?.message || err}`);
    },
  });

  const activePositions = lpData?.activePositions || [];
  const closedPositions = lpData?.closedPositions || [];

  return (
    <div className="flex flex-col gap-6">
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
            <span className="text-xs text-muted-foreground font-medium">累计手续费收入</span>
            <DollarSign className="size-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400">
            +${(lpData?.totalFeeEarnedUsd ?? 0).toFixed(2)}
            <span className="text-xs font-normal text-muted-foreground ml-1">USDG</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            高频换手过路费（含在持与已结项）
          </div>
        </div>

        {/* Card 3: Net Realized PnL */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">累计净盈亏 (扣除无常损失)</span>
            <TrendingUp className="size-4 text-cyan-400" />
          </div>
          <div
            className={cn(
              "mt-2 text-2xl font-bold",
              (lpData?.totalRealizedPnlUsd ?? 0) >= 0 ? "text-cyan-400" : "text-rose-400",
            )}
          >
            {(lpData?.totalRealizedPnlUsd ?? 0) >= 0 ? "+" : ""}
            ${(lpData?.totalRealizedPnlUsd ?? 0).toFixed(2)}
            <span className="text-xs font-normal text-muted-foreground ml-1">USDG</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            综合胜率: {(lpData?.winRatePct ?? 0).toFixed(1)}% ({lpData?.winCount ?? 0} 胜 / {lpData?.lossCount ?? 0} 负)
          </div>
        </div>

        {/* Card 4: Active Pools */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">当前做市状态</span>
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
              <label className="text-muted-foreground font-medium">实盘模式</label>
              <select
                className="bg-secondary/60 border border-border/60 rounded-md px-2.5 py-1.5 text-foreground"
                value={cfgDryRun ? "dry" : "live"}
                onChange={(e) => setCfgDryRun(e.target.value === "dry")}
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

            {/* Actions */}
            <div className="flex items-end gap-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs h-8"
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
                  })
                }
                disabled={updateConfigMut.isPending}
              >
                保存策略配置
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Active LP Positions Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-foreground">
              当前做市池 ({activePositions.length})
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
                  if (confirm("确定要对所有在持做市头寸执行紧急一键撤池并兑回 USDG 吗？")) {
                    closeAllMut.mutate();
                  }
                }}
                disabled={closeAllMut.isPending}
              >
                <Trash2 className="size-3 mr-1" /> 紧急全量撤池
              </Button>
            )}
          </div>
        </div>

        {activePositions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Layers className="size-8 text-muted-foreground/40" />
            <div>暂无正在做市的流动性头寸</div>
            <div className="text-xs text-muted-foreground/70">
              当扫描雷达或 TG 频道发现满足 5m 成交量 / 流动性 ≥ {config?.minVolumeToLiquidityRatio ?? 1.5} 的高频标的时，系统将自动建仓并在区间内收租。
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activePositions.map((pos) => {
              const isPump = pos.stage === "PUMP";
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
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          isPump ? "border-amber-500/40 text-amber-400 bg-amber-500/10" : "border-cyan-500/40 text-cyan-400 bg-cyan-500/10",
                        )}
                      >
                        {isPump ? "🚀 拉升期偏上方多段" : "⚖️ 横盘期Spot核心震荡"}
                      </Badge>
                      {pos.status === "PRINCIPAL_SECURED" && (
                        <Badge variant="go" className="text-[10px]">
                          🛡️ 已保本锁定
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">入场/现价:</span>
                      <div className="font-semibold text-foreground mt-0.5">
                        ${pos.entryPriceUsd} / ${pos.currentPriceUsd}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">做市本金:</span>
                      <div className="font-semibold text-foreground mt-0.5">
                        ${pos.initialUsdInvested.toFixed(2)} USDG
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">手续费收入:</span>
                      <div className="font-bold text-emerald-400 mt-0.5">
                        +${pos.feeEarnedUsd.toFixed(2)} USDG
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">净盈亏 (扣除IL):</span>
                      <div
                        className={cn(
                          "font-bold mt-0.5",
                          isProfit ? "text-cyan-400" : "text-rose-400",
                        )}
                      >
                        {isProfit ? "+" : ""}${pos.netPnlUsd.toFixed(2)} ({isProfit ? "+" : ""}{pos.netPnlPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

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
                      <td className="py-2.5 px-3 text-muted-foreground max-w-[200px] truncate">
                        {pos.exitReason || pos.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
