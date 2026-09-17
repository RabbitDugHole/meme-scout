import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Flame,
  Layers,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addTgChannel,
  closeAllPositions,
  closePosition,
  executeManualBuy,
  getBacktestStatus,
  getMonitorStatus,
  getTgMonitorStatus,
  getTradeState,
  removeTgChannel,
  sendTestLarkAlarm,
  toggleTgChannel,
  triggerDailyBacktest,
  triggerHourlyBacktest,
  triggerMonitorScan,
  triggerTgPoll,
  updateBacktestConfig,
  updateMonitorConfig,
  updateTgMonitorConfig,
  updateTradeConfig,
  getLpState,
} from "@/lib/scout/actions";
import { formatUsd, shortAddr } from "@/lib/scout/format";
import { DEFAULT_LARK_WEBHOOK_URL } from "@/lib/scout/lark";
import { cn } from "@/lib/utils";
import { LpPanel } from "./lp-panel";

export function MonitorPanel({
  onInspect,
}: {
  onInspect?: (address: string) => void;
}) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<
    "telegram" | "robinhood" | "backtest" | "trade" | "lp"
  >("telegram");

  // --- LP Engine Data ---
  const { data: lpData } = useQuery({
    queryKey: ["lpState"],
    queryFn: () => getLpState(),
    refetchInterval: 6000,
  });

  // --- Robinhood Monitor Data ---
  const { data: status } = useQuery({
    queryKey: ["monitorStatus"],
    queryFn: () => getMonitorStatus(),
    refetchInterval: 6000,
  });

  // --- Telegram Monitor Data ---
  const { data: tgStatus } = useQuery({
    queryKey: ["tgMonitorStatus"],
    queryFn: () => getTgMonitorStatus(),
    refetchInterval: 6000,
  });

  // --- Backtest Data ---
  const { data: backtestStatus } = useQuery({
    queryKey: ["backtestStatus"],
    queryFn: () => getBacktestStatus(),
    refetchInterval: 6000,
  });

  const [backtestView, setBacktestView] = useState<"tokens" | "reports">("tokens");

  const hourlyBacktestMutation = useMutation({
    mutationFn: () => triggerHourlyBacktest({ data: { force: true } }),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ["backtestStatus"] });
      toast.success(
        `1小时回测完成: 统计 ${report.summary.totalTokens} 个标的，止盈胜率 ${report.summary.winRatePct.toFixed(1)}%！${report.larkOk ? "（战报已推送飞书）" : ""}`,
      );
    },
    onError: (err: any) => {
      toast.error(`1小时回测失败: ${err?.message || String(err)}`);
    },
  });

  const dailyBacktestMutation = useMutation({
    mutationFn: () => triggerDailyBacktest({ data: { force: true } }),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ["backtestStatus"] });
      toast.success(
        `24小时大盘复盘完成: 统计 ${report.summary.totalTokens} 个标的，止盈胜率 ${report.summary.winRatePct.toFixed(1)}%，翻倍率 ${((report.summary.doubledTokens / (report.summary.totalTokens || 1)) * 100).toFixed(1)}%！${report.larkOk ? "（战报已推送飞书）" : ""}`,
      );
    },
    onError: (err: any) => {
      toast.error(`24小时复盘失败: ${err?.message || String(err)}`);
    },
  });

  const updateBacktestCfgMutation = useMutation({
    mutationFn: (newCfg: any) => updateBacktestConfig({ data: newCfg }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtestStatus"] });
      toast.success("回测配置已更新！");
    },
  });

  // Robinhood config states
  const [webhookUrl, setWebhookUrl] = useState(
    status?.config.webhookUrl || DEFAULT_LARK_WEBHOOK_URL,
  );
  const [minScore, setMinScore] = useState(status?.config.minScoreThreshold ?? 80);
  const [minLiq, setMinLiq] = useState(status?.config.minLiquidityUsd ?? 30000);
  const [autoAlarm, setAutoAlarm] = useState(
    status?.config.autoAlarmEnabled ?? true,
  );

  // TG config states
  const [newChannelInput, setNewChannelInput] = useState("");
  const [tgMinScore, setTgMinScore] = useState(
    tgStatus?.config.minScoreThreshold ?? 80,
  );
  const [tgMinLiq, setTgMinLiq] = useState(
    tgStatus?.config.minLiquidityUsd ?? 20000,
  );
  const [tgAutoAlarm, setTgAutoAlarm] = useState(
    tgStatus?.config.autoAlarmEnabled ?? true,
  );
  const [tgFeedFilter, setTgFeedFilter] = useState<"alerts" | "all">("all");

  // Robinhood mutations
  const scanMutation = useMutation({
    mutationFn: () => triggerMonitorScan({ data: { forceCheck: true } }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["monitorStatus"] });
      qc.invalidateQueries({ queryKey: ["radar"] });
      toast.success(
        `扫描完成: 扫描 ${data.scannedCount} 个代币，发现 ${data.potentialCount} 个高潜力，触发 ${data.newAlarmsSent} 条新告警！`,
      );
    },
    onError: (err: any) => {
      toast.error(`扫描失败: ${err?.message || String(err)}`);
    },
  });

  const testLarkMutation = useMutation({
    mutationFn: () => sendTestLarkAlarm({ data: { webhookUrl } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("飞书/Lark 告警测试消息已成功送达！");
      } else {
        toast.error(`飞书消息发送失败: ${res.msg || res.error || "未知错误"}`);
      }
    },
    onError: (err: any) => {
      toast.error(`测试失败: ${err?.message || String(err)}`);
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: (newCfg: any) => updateMonitorConfig({ data: newCfg }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitorStatus"] });
      toast.success("Robinhood 监控配置已保存并生效！");
    },
    onError: (err: any) => {
      toast.error(`配置保存失败: ${err?.message || String(err)}`);
    },
  });

  // TG mutations
  const tgPollMutation = useMutation({
    mutationFn: () => triggerTgPoll({ data: { force: true } }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tgMonitorStatus"] });
      toast.success(
        `TG 巡检完成: 巡检 ${data.polledChannels} 个频道，新收 ${data.newMessagesCount} 条情报，研判 ${data.evaluatedCount} 个代币，触发 ${data.newAlarmsCount} 条新告警！`,
      );
    },
    onError: (err: any) => {
      toast.error(`TG 巡检失败: ${err?.message || String(err)}`);
    },
  });

  const tgAddChannelMutation = useMutation({
    mutationFn: (channel: string) => addTgChannel({ data: { channel } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tgMonitorStatus"] });
      setNewChannelInput("");
      toast.success("TG 监控频道添加成功！");
    },
    onError: (err: any) => {
      toast.error(`添加失败: ${err?.message || String(err)}`);
    },
  });

  const tgRemoveChannelMutation = useMutation({
    mutationFn: (channel: string) => removeTgChannel({ data: { channel } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tgMonitorStatus"] });
      toast.success("已移除监控频道");
    },
  });

  const tgToggleChannelMutation = useMutation({
    mutationFn: ({ channel, enabled }: { channel: string; enabled: boolean }) =>
      toggleTgChannel({ data: { channel, enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tgMonitorStatus"] });
      toast.success("频道状态已更新");
    },
  });

  const tgUpdateConfigMutation = useMutation({
    mutationFn: (newCfg: any) => updateTgMonitorConfig({ data: newCfg }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tgMonitorStatus"] });
      toast.success("TG 监控过滤参数已保存并生效！");
    },
    onError: (err: any) => {
      toast.error(`保存失败: ${err?.message || String(err)}`);
    },
  });

  // --- Trade Data & Mutations ---
  const { data: tradeData } = useQuery({
    queryKey: ["tradeState"],
    queryFn: () => getTradeState(),
    refetchInterval: 4000,
  });

  const [tradeDryRun, setTradeDryRun] = useState<boolean>(true);
  const [tradeAutoBuy, setTradeAutoBuy] = useState<boolean>(true);
  const [tradeBuyBnb, setTradeBuyBnb] = useState<number>(0.05);
  const [tradeBuyEth, setTradeBuyEth] = useState<number>(0.005);
  const [tradeTimeoutSec, setTradeTimeoutSec] = useState<number>(60);
  const [tradeMaxDeviation, setTradeMaxDeviation] = useState<number>(10);
  const [tradeSlippage, setTradeSlippage] = useState<number>(8);
  const [tradeTp1Pct, setTradeTp1Pct] = useState<number>(50);
  const [tradeTp1SellRatio, setTradeTp1SellRatio] = useState<number>(50);
  const [tradeTp2Pct, setTradeTp2Pct] = useState<number>(100);
  const [tradeTp2SellRatio, setTradeTp2SellRatio] = useState<number>(25);
  const [tradeTp3Trailing, setTradeTp3Trailing] = useState<number>(25);
  const [tradeStopLoss, setTradeStopLoss] = useState<number>(-18);
  const [tradeMaxHoldMinutes, setTradeMaxHoldMinutes] = useState<number>(360);
  const [tradeLiqDrain, setTradeLiqDrain] = useState<number>(35);
  const [tradeLarkNotification, setTradeLarkNotification] = useState<boolean>(true);
  const [tradeConfigInitialized, setTradeConfigInitialized] = useState(false);

  useEffect(() => {
    if (tradeData?.config && !tradeConfigInitialized) {
      setTradeDryRun(tradeData.config.dryRun ?? true);
      setTradeAutoBuy(tradeData.config.autoBuyEnabled ?? true);
      setTradeBuyBnb(tradeData.config.buyAmountBscBnb ?? 0.05);
      setTradeBuyEth(tradeData.config.buyAmountRhEth ?? 0.005);
      setTradeTimeoutSec(tradeData.config.executionTimeoutSeconds ?? 60);
      setTradeMaxDeviation(tradeData.config.maxPriceDeviationPct ?? 10);
      setTradeSlippage(tradeData.config.slippagePct ?? 8);
      setTradeTp1Pct(tradeData.config.tp1Pct ?? 50);
      setTradeTp1SellRatio(tradeData.config.tp1SellRatioPct ?? 50);
      setTradeTp2Pct(tradeData.config.tp2Pct ?? 100);
      setTradeTp2SellRatio(tradeData.config.tp2SellRatioPct ?? 25);
      setTradeTp3Trailing(tradeData.config.tp3TrailingStopPct ?? 25);
      setTradeStopLoss(tradeData.config.stopLossPct ?? -18);
      setTradeMaxHoldMinutes(tradeData.config.maxHoldTimeMinutes ?? 360);
      setTradeLiqDrain(tradeData.config.emergencyLiquidityDrainPct ?? 35);
      setTradeLarkNotification(tradeData.config.larkTradeNotification ?? true);
      setTradeConfigInitialized(true);
    }
  }, [tradeData?.config, tradeConfigInitialized]);

  const updateTradeCfgMutation = useMutation({
    mutationFn: (newCfg: any) => updateTradeConfig({ data: newCfg }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tradeState"] });
      toast.success("交易与风控策略配置已更新！");
    },
    onError: (err: any) => {
      toast.error(`更新失败: ${err?.message || String(err)}`);
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: (positionId: string) => closePosition({ data: { positionId } }),
    onSuccess: (ok) => {
      qc.invalidateQueries({ queryKey: ["tradeState"] });
      if (ok) {
        toast.success("平仓操作已执行成功！");
      } else {
        toast.error("平仓失败，未找到该仓位或执行未成功");
      }
    },
    onError: (err: any) => {
      toast.error(`平仓异常: ${err?.message || String(err)}`);
    },
  });

  const closeAllMutation = useMutation({
    mutationFn: () => closeAllPositions(),
    onSuccess: (closedCount) => {
      qc.invalidateQueries({ queryKey: ["tradeState"] });
      toast.success(`全仓清仓操作完成: 共平仓 ${closedCount} 个标的`);
    },
    onError: (err: any) => {
      toast.error(`一键清仓失败: ${err?.message || String(err)}`);
    },
  });

  const rhHistory = status?.history ?? [];
  const tgHistory = tgStatus?.history ?? [];
  const tgRecentEvals = tgStatus?.recentEvaluations ?? [];

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Sub Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-border/50 pb-3">
        <button
          type="button"
          onClick={() => setSubTab("telegram")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            subTab === "telegram"
              ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <MessageSquare className="size-4" />
          <span>Telegram 频道情报监控</span>
          <Badge variant="outline" className="text-xs">
            {tgStatus?.config.channels.length ?? 1} 频道
          </Badge>
          {tgHistory.length > 0 && (
            <Badge variant="go" className="text-xs">
              {tgHistory.length} 告警
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab("robinhood")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            subTab === "robinhood"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Radio className="size-4" />
          <span>Robinhood 链上全量巡检</span>
          {rhHistory.length > 0 && (
            <Badge variant="go" className="text-xs">
              {rhHistory.length} 告警
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab("backtest")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            subTab === "backtest"
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <BarChart3 className="size-4" />
          <span>战绩回顾与收益回测 (1h / 24h)</span>
          <Badge variant="outline" className="text-xs">
            {backtestStatus?.trackedTokensCount ?? 0} 标的
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setSubTab("trade")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            subTab === "trade"
              ? "bg-violet-500/15 text-violet-400 border border-violet-500/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Zap className="size-4" />
          <span>自动交易与持仓风控 (BSC / Robinhood)</span>
          {(tradeData?.activePositions?.length ?? 0) > 0 ? (
            <Badge variant="go" className="text-xs">
              {tradeData?.activePositions?.length} 笔持仓
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              {tradeData?.config?.dryRun ? "模拟盘" : "实盘"}
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab("lp")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            subTab === "lp"
              ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Layers className="size-4" />
          <span>V3 非对称 LP 做市 (Robinhood)</span>
          {(lpData?.activePositions?.length ?? 0) > 0 ? (
            <Badge variant="go" className="text-xs">
              {lpData?.activePositions?.length} 个池子
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              {lpData?.config?.dryRun ? "模拟" : "实盘"}
            </Badge>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TELEGRAM CHANNEL MONITOR TAB CONTENT */}
      {/* ========================================================================= */}
      {subTab === "telegram" && (
        <div className="flex flex-col gap-6">
          {/* Top Status Cards for TG */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Card 1: TG Monitor State */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex size-3 rounded-full bg-cyan-500"></span>
                  </span>
                  <h3 className="font-mono text-sm font-medium">TG 频道情报抓取</h3>
                </div>
                <Badge variant={tgStatus?.isRunning ? "go" : "default"}>
                  {tgStatus?.isRunning ? "实时抓取中" : "已暂停"}
                </Badge>
              </div>

              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <p>
                  轮询间隔:{" "}
                  <strong className="text-foreground">
                    每 {tgStatus?.config.pollIntervalSeconds ?? 30} 秒
                  </strong>
                </p>
                <p>
                  最近拉取:{" "}
                  <span className="font-mono text-foreground">
                    {tgStatus?.lastPollTime
                      ? new Date(tgStatus.lastPollTime).toLocaleTimeString("zh-CN")
                      : "启动中..."}
                  </span>
                </p>
                <p>
                  抓取情报条数:{" "}
                  <strong className="text-foreground">
                    {tgStatus?.parsedMessagesCount ?? 0} 条
                  </strong>
                </p>
              </div>

              <div className="mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full gap-1.5"
                  onClick={() => tgPollMutation.mutate()}
                  disabled={tgPollMutation.isPending}
                >
                  <RefreshCw
                    className={cn("size-3.5", tgPollMutation.isPending && "animate-spin")}
                  />
                  立即拉取 TG 最新情报
                </Button>
              </div>
            </div>

            {/* Card 2: Filter & Alert Rules */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-cyan-400" />
                  <h3 className="font-mono text-sm font-medium">二次研判与告警过滤</h3>
                </div>
                <Badge variant={tgStatus?.config.autoAlarmEnabled ? "go" : "default"}>
                  {tgStatus?.config.autoAlarmEnabled ? "自动推送开" : "已暂停"}
                </Badge>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p>
                  门槛要求:{" "}
                  <strong className="text-foreground">
                    综合评分 ≥ {tgStatus?.config.minScoreThreshold ?? 80} 分 (S-Tier)
                  </strong>
                </p>
                <p>
                  池子硬门槛:{" "}
                  <strong className="text-foreground">
                    实时 DEX 流动性 ≥ ${((tgStatus?.config.minLiquidityUsd ?? 20000) / 1000).toFixed(0)}k
                  </strong>
                </p>
                <p>
                  防砸盘过滤:{" "}
                  <strong className="text-foreground">
                    1h 跌幅 &lt; -40% 自动拦截
                  </strong>
                </p>
                <p className="text-[11px] text-cyan-400 font-mono">
                  * 自动过滤已归零与被反向收割的旧币
                </p>
              </div>

              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => testLarkMutation.mutate()}
                  disabled={testLarkMutation.isPending}
                >
                  <Send className="size-3.5" />
                  测试飞书告警连接
                </Button>
              </div>
            </div>

            {/* Card 3: Metrics summary */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="size-4 text-amber-400" />
                  <h3 className="font-mono text-sm font-medium">情报研判统计</h3>
                </div>
                <Badge variant="outline">跨链 Meme</Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">已研判代币</span>
                  <p className="font-mono font-bold text-foreground">
                    {tgStatus?.evaluatedTokensCount ?? 0} 个
                  </p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">通过并告警</span>
                  <p className="font-mono font-bold text-cyan-400">
                    {tgStatus?.alertedCount ?? 0} 个
                  </p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">拦截过滤率</span>
                  <p className="font-mono font-bold text-foreground">
                    {tgStatus?.evaluatedTokensCount && tgStatus.evaluatedTokensCount > 0
                      ? `${(
                          ((tgStatus.evaluatedTokensCount - tgStatus.alertedCount) /
                            tgStatus.evaluatedTokensCount) *
                          100
                        ).toFixed(0)}%`
                      : "100%"}
                  </p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">冷却防刷</span>
                  <p className="font-mono font-bold text-foreground">
                    {tgStatus?.config.cooldownMinutes ?? 120} 分钟
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>首发监控频道:</span>
                <strong className="font-mono text-foreground">@lanniaohui</strong>
              </div>
            </div>
          </div>

          {/* Channel Management Card */}
          <div className="rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-cyan-400" />
                <h3 className="font-mono text-sm font-semibold">
                  Telegram 监控频道列表 ({tgStatus?.config.channels.length ?? 0})
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                支持公开频道抓取，无需 Bot Token
              </span>
            </div>

            {/* Channel List */}
            <div className="mt-4 divide-y divide-border/40">
              {(tgStatus?.config.channels ?? []).map((ch) => (
                <div
                  key={ch.username}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                      <MessageSquare className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-foreground">
                          @{ch.username}
                        </span>
                        {ch.name && (
                          <span className="text-xs text-muted-foreground">
                            ({ch.name})
                          </span>
                        )}
                        <Badge variant={ch.enabled ? "go" : "default"}>
                          {ch.enabled ? "监控中" : "已停用"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ch.webhookOnly || ch.username.toLowerCase() === "bobo9527" ? (
                          <>
                            webhook-only (no public t.me/s feed)
                          </>
                        ) : (
                          <>
                            预览地址:{" "}
                            <a
                              href={`https://t.me/s/${ch.username}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-cyan-400 hover:underline inline-flex items-center gap-1"
                            >
                              https://t.me/s/{ch.username}
                              <ExternalLink className="size-3" />
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={ch.enabled ? "outline" : "secondary"}
                      onClick={() =>
                        tgToggleChannelMutation.mutate({
                          channel: ch.username,
                          enabled: !ch.enabled,
                        })
                      }
                      disabled={tgToggleChannelMutation.isPending}
                    >
                      {ch.enabled ? "暂停" : "启用"}
                    </Button>
                    {ch.username.toLowerCase() !== "lanniaohui" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => tgRemoveChannelMutation.mutate(ch.username)}
                        disabled={tgRemoveChannelMutation.isPending}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Channel Form */}
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
              <input
                type="text"
                value={newChannelInput}
                onChange={(e) => setNewChannelInput(e.target.value)}
                placeholder="输入频道名或链接，如 @lanniaohui 或 https://t.me/..."
                className="flex-1 min-w-[240px] rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-cyan-500 focus:outline-none"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newChannelInput.trim()) {
                    tgAddChannelMutation.mutate(newChannelInput.trim());
                  }
                }}
                disabled={!newChannelInput.trim() || tgAddChannelMutation.isPending}
              >
                <Plus className="size-3.5 mr-1" />
                添加监控频道
              </Button>
            </div>

            {/* External Webhook Receiver Info Box */}
            <div className="mt-4 rounded-lg bg-cyan-950/20 border border-cyan-500/30 p-3.5 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono font-semibold text-cyan-400">
                  <span>⚡ 外部 Webhook 推送接口已就绪 (支持 litehook / Telethon / TG Bot)</span>
                </div>
                <code className="rounded bg-background/80 px-2 py-0.5 font-mono text-[11px] text-cyan-300">
                  POST /api/tg-webhook
                </code>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed">
                针对需要加入才能查看消息的私密或受限频道（如 <span className="text-foreground font-semibold">bobo9527</span> / <span className="text-foreground font-semibold">bobo8567</span>），可搭配开源 <span className="text-cyan-400 font-medium">litehook</span> 或 Python Telethon 用户号脚本，捕获消息后直接 POST 推送到本系统进行自动化评分、飞书报警与跟单：
              </p>
              <div className="mt-2 rounded bg-background/80 p-2 font-mono text-[11px] text-muted-foreground break-all">
                curl -X POST /api/tg-webhook -H &quot;Content-Type: application/json&quot; -d &#39;&#123;&quot;channel&quot;:&quot;bobo9527&quot;, &quot;text&quot;:&quot;• 代币: GDPair (GDP)\n• CA: 0x7d2c...&quot;&#125;&#39;
              </div>
            </div>
          </div>

          {/* TG Secondary Screening Filter Settings */}
          <div className="rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="size-4 text-muted-foreground" />
                <h3 className="font-mono text-sm font-semibold">
                  TG 情报研判与二次过滤门槛参数
                </h3>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  tgUpdateConfigMutation.mutate({
                    minScoreThreshold: Number(tgMinScore),
                    minLiquidityUsd: Number(tgMinLiq),
                    autoAlarmEnabled: tgAutoAlarm,
                  });
                }}
                disabled={tgUpdateConfigMutation.isPending}
              >
                保存生效
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  最低综合评分 (0 - 100)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    min={40}
                    max={95}
                    value={tgMinScore}
                    onChange={(e) => setTgMinScore(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">分</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  当前设定 ≥ {tgMinScore} 分才触发飞书推送 (过滤普通炒作币)
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  最低实时池子 (USD)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    step={5000}
                    value={tgMinLiq}
                    onChange={(e) => setTgMinLiq(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">$</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  当前设定 ≥ ${tgMinLiq.toLocaleString()} (防止几百刀诱多池)
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  自动告警开关
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <Button
                    size="sm"
                    variant={tgAutoAlarm ? "default" : "secondary"}
                    onClick={() => setTgAutoAlarm(!tgAutoAlarm)}
                    className={cn(
                      "w-full",
                      tgAutoAlarm && "bg-cyan-600 hover:bg-cyan-500 text-white",
                    )}
                  >
                    {tgAutoAlarm ? "✓ 自动推送已开启" : "已暂停自动推送"}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  合格代币将直接发送至你的飞书告警机器人
                </p>
              </div>
            </div>
          </div>

          {/* Evaluations & Alarms Feed */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-cyan-400" />
                <h3 className="font-mono text-base font-semibold">
                  TG 情报研判动态 ({tgRecentEvals.length})
                </h3>
              </div>

              <div className="flex items-center gap-1.5 rounded-lg bg-secondary p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setTgFeedFilter("all")}
                  className={cn(
                    "rounded px-2.5 py-1 transition-colors",
                    tgFeedFilter === "all"
                      ? "bg-card text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  全部研判 ({tgRecentEvals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTgFeedFilter("alerts")}
                  className={cn(
                    "rounded px-2.5 py-1 transition-colors",
                    tgFeedFilter === "alerts"
                      ? "bg-cyan-500/20 text-cyan-400 font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  飞书推送 ({tgHistory.length})
                </button>
              </div>
            </div>

            {tgRecentEvals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                <p>暂无 TG 研判记录。</p>
                <p className="mt-1 text-xs">
                  点击上方「立即拉取 TG 最新情报」或等待后台自动巡检 (每 30 秒)。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {tgRecentEvals
                  .filter((item) => (tgFeedFilter === "alerts" ? item.passedFilter : true))
                  .map((ev, idx) => (
                    <div
                      key={`${ev.token.address}-${idx}`}
                      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)] transition-all hover:bg-card/80"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-mono text-base font-bold text-foreground">
                            ${ev.token.symbol}
                          </h4>
                          <Badge variant="outline" className="font-mono text-xs">
                            ⛓️ {ev.token.chain}
                          </Badge>
                          <Badge
                            variant={
                              ev.potentialTier === "S"
                                ? "go"
                                : ev.potentialTier === "A"
                                  ? "go"
                                  : "default"
                            }
                          >
                            {ev.potentialTier === "S" ? "🌟 S-Tier" : `🚀 ${ev.potentialTier}-Tier`}{" "}
                            · 得分 {ev.totalScore}/100
                          </Badge>
                          {ev.passedFilter ? (
                            <Badge variant="go" className="gap-1">
                              <CheckCircle2 className="size-3" />
                              符合推送
                            </Badge>
                          ) : (
                            <Badge variant="stop" className="gap-1">
                              <XCircle className="size-3" />
                              已拦截: {ev.filterReason}
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                          <span>来自 @{ev.token.channel}</span>
                          <span>
                            {new Date(ev.token.timestamp).toLocaleTimeString("zh-CN")}
                          </span>
                        </div>
                      </div>

                      {/* Live Data & TG Metrics Grid */}
                      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                        <div>
                          <span className="text-muted-foreground">现价 / 1h涨跌:</span>
                          <p className="font-mono font-bold text-foreground">
                            {ev.liveData?.priceUsd != null
                              ? `$${ev.liveData.priceUsd < 0.01 ? ev.liveData.priceUsd.toExponential(3) : ev.liveData.priceUsd.toFixed(4)}`
                              : "—"}{" "}
                            {ev.liveData?.priceChangeH1 != null && (
                              <span
                                className={
                                  ev.liveData.priceChangeH1 >= 0
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }
                              >
                                ({ev.liveData.priceChangeH1 >= 0 ? "+" : ""}
                                {ev.liveData.priceChangeH1.toFixed(1)}%)
                              </span>
                            )}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">池子流动性:</span>
                          <p className="font-mono font-bold text-foreground">
                            {ev.liveData?.liquidityUsd != null
                              ? formatUsd(ev.liveData.liquidityUsd)
                              : ev.token.tgMcap || "未知"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">聪明钱 / KOL:</span>
                          <p className="font-mono font-bold text-foreground">
                            {ev.token.smartMoneyCount ?? 0} 人 / {ev.token.kolCount ?? 0} 人
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">合约地址 (CA):</span>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(ev.token.address);
                              toast.success("合约地址已复制到剪贴板！");
                            }}
                            className="flex items-center gap-1 font-mono text-cyan-400 hover:underline"
                            title="点击一键复制"
                          >
                            {shortAddr(ev.token.address)}
                            <Copy className="size-3" />
                          </button>
                        </div>
                      </div>

                      {/* Signals & Risks */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {ev.signals.map((sig, sIdx) => (
                          <span
                            key={sIdx}
                            className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20"
                          >
                            ✓ {sig}
                          </span>
                        ))}
                        {ev.risks.map((risk, rIdx) => (
                          <span
                            key={rIdx}
                            className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/20"
                          >
                            ⚠ {risk}
                          </span>
                        ))}
                      </div>

                      {/* Action Links */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button size="sm" variant="ghost" asChild>
                          <a
                            href={ev.token.url}
                            target="_blank"
                            rel="noreferrer"
                            className="gap-1"
                          >
                            <MessageSquare className="size-3.5" />
                            TG 原情报
                          </a>
                        </Button>
                        {ev.liveData?.dexUrl && (
                          <Button size="sm" variant="ghost" asChild>
                            <a
                              href={ev.liveData.dexUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="gap-1"
                            >
                              <ExternalLink className="size-3.5" />
                              DexScreener
                            </a>
                          </Button>
                        )}
                        {ev.token.tweetUrl && (
                          <Button size="sm" variant="ghost" asChild>
                            <a
                              href={ev.token.tweetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="gap-1 text-cyan-400"
                            >
                              <ExternalLink className="size-3.5" />
                              𝕏 叙事推文
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROBINHOOD ON-CHAIN MONITOR TAB CONTENT */}
      {/* ========================================================================= */}
      {subTab === "robinhood" && (
        <div className="flex flex-col gap-6">
          {/* Top Banner / Status Overview */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Card 1: Monitor Status */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex size-3 rounded-full bg-emerald-500"></span>
                  </span>
                  <h3 className="font-mono text-sm font-medium">Robinhood 链上巡检</h3>
                </div>
                <Badge variant="go">运行中</Badge>
              </div>

              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <p>
                  巡检周期:{" "}
                  <strong className="text-foreground">
                    每 {status?.config.intervalSeconds ?? 60} 秒
                  </strong>
                </p>
                <p>
                  最近巡检:{" "}
                  <span className="font-mono text-foreground">
                    {status?.lastScanTime
                      ? new Date(status.lastScanTime).toLocaleTimeString("zh-CN")
                      : "启动中..."}
                  </span>
                </p>
                <p>
                  已建档标记代币:{" "}
                  <strong className="text-foreground">
                    {status?.alertedCount ?? 0} 个
                  </strong>
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full gap-1.5"
                  onClick={() => scanMutation.mutate()}
                  disabled={scanMutation.isPending}
                >
                  <RefreshCw
                    className={cn("size-3.5", scanMutation.isPending && "animate-spin")}
                  />
                  立即触发全链巡检
                </Button>
              </div>
            </div>

            {/* Card 2: Lark Bot Status */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-cyan-400" />
                  <h3 className="font-mono text-sm font-medium">飞书 / Lark 告警推送</h3>
                </div>
                <Badge variant={autoAlarm ? "go" : "default"}>
                  {autoAlarm ? "自动推送开" : "已暂停"}
                </Badge>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="truncate font-mono">
                  Webhook: {webhookUrl ? shortAddr(webhookUrl) : "未配置"}
                </p>
                <p>
                  告警门槛:{" "}
                  <strong className="text-foreground">
                    评分 ≥ {minScore} 分 (S-Tier 极高潜力)
                  </strong>
                </p>
                <p>
                  防刷冷却:{" "}
                  <strong className="text-foreground">
                    {status?.config.cooldownMinutes ?? 120} 分钟
                  </strong>
                </p>
                <p className="text-[11px] text-emerald-400 font-mono">
                  * 告警文本已强制前缀: **
                </p>
              </div>

              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => testLarkMutation.mutate()}
                  disabled={testLarkMutation.isPending}
                >
                  <Send className="size-3.5" />
                  测试发送飞书告警
                </Button>
              </div>
            </div>

            {/* Card 3: Potential Statistics */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="size-4 text-amber-400" />
                  <h3 className="font-mono text-sm font-medium">高潜力 Meme 指标库</h3>
                </div>
                <Badge variant="outline">5 维量化模型</Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">🛡️ 安全底线</span>
                  <p className="font-mono font-bold text-foreground">LP 100% 锁/无增发</p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">👥 筹码去中心</span>
                  <p className="font-mono font-bold text-foreground">前十 &lt; 45%</p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">🚀 盘口动量</span>
                  <p className="font-mono font-bold text-foreground">买单占比 &gt; 60%</p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">💎 聪明钱介入</span>
                  <p className="font-mono font-bold text-foreground">≥2 笔 ≥$200 大单</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>总计触发历史:</span>
                <strong className="font-mono text-foreground">
                  {rhHistory.length} 条记录
                </strong>
              </div>
            </div>
          </div>

          {/* Configuration Drawer */}
          <div className="rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="size-4 text-muted-foreground" />
                <h3 className="font-mono text-sm font-semibold">告警机器人与触发参数配置</h3>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  updateConfigMutation.mutate({
                    webhookUrl,
                    minScoreThreshold: Number(minScore),
                    minLiquidityUsd: Number(minLiq),
                    autoAlarmEnabled: autoAlarm,
                  });
                }}
                disabled={updateConfigMutation.isPending}
              >
                保存生效
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  飞书 / Lark Webhook 机器人链接
                </label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..."
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-cyan-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  已绑定你的飞书告警机器人，推送内容以 <code>**</code> 为严格前缀。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    最低评分门槛 (0 - 100)
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={40}
                      max={95}
                      value={minScore}
                      onChange={(e) => setMinScore(Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none"
                    />
                    <span className="text-xs text-muted-foreground">分</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    建议 ≥ 80 分 (S-Tier 极高爆发潜力代币)
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    最低流动性 (USD)
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      step={5000}
                      value={minLiq}
                      onChange={(e) => setMinLiq(Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none"
                    />
                    <span className="text-xs text-muted-foreground">$</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    建议 ≥ $30,000 过滤虚假无池空气
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Robinhood Alarm History Log */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-[#00f5a0]" />
                <h3 className="font-mono text-base font-semibold">
                  Robinhood 链上告警推送历史 ({rhHistory.length})
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                仅展示通过多维潜力模型与安全锁仓的代币
              </span>
            </div>

            {rhHistory.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                <p>暂无触发告警的潜力代币记录。</p>
                <p className="mt-1 text-xs">
                  点击上方「立即触发全链巡检」或保持后台自动监控运行中。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {rhHistory.map((record) => (
                  <div
                    key={record.id}
                    className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)] transition-all hover:bg-card/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-mono text-base font-bold text-foreground">
                          ${record.symbol}
                        </h4>
                        <span className="text-xs text-muted-foreground">
                          ({record.name})
                        </span>
                        <Badge
                          variant={
                            record.tier === "S"
                              ? "go"
                              : record.tier === "A"
                                ? "go"
                                : "default"
                          }
                        >
                          {record.tier === "S" ? "🌟 S-Tier" : `🚀 ${record.tier}-Tier`}{" "}
                          · 得分 {record.score}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-muted-foreground">
                          {new Date(record.timestamp).toLocaleString("zh-CN")}
                        </span>
                        <Badge variant={record.larkOk ? "go" : "stop"}>
                          {record.larkOk ? (
                            <CheckCircle2 className="mr-1 size-3" />
                          ) : (
                            <XCircle className="mr-1 size-3" />
                          )}
                          飞书: {record.larkOk ? "已送达" : "未成功"}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div>
                        <span className="text-muted-foreground">价格:</span>
                        <p className="font-mono font-bold text-foreground">
                          {record.priceUsd != null
                            ? `$${record.priceUsd.toFixed(6)}`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">估算市值:</span>
                        <p className="font-mono font-bold text-foreground">
                          {formatUsd(record.mcapUsd)}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">池子流动性:</span>
                        <p className="font-mono font-bold text-foreground">
                          {formatUsd(record.liquidityUsd)}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">合约地址:</span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(record.tokenAddress);
                            toast.success("合约地址已复制");
                          }}
                          className="flex items-center gap-1 font-mono text-cyan-400 hover:underline"
                        >
                          {shortAddr(record.tokenAddress)}
                          <Copy className="size-3" />
                        </button>
                      </div>
                    </div>

                    {record.signals && record.signals.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {record.signals.map((sig, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20"
                          >
                            ✓ {sig}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onInspect?.(record.tokenAddress)}
                      >
                        <Radio className="size-3.5" />
                        体检
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={`https://dexscreener.com/robinhood/${record.tokenAddress}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="size-3.5" />
                          DexScreener
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={`https://robinhoodchain.blockscout.com/address/${record.tokenAddress}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="size-3.5" />
                          Blockscout
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BACKTEST & WIN-RATE TRACKING TAB CONTENT */}
      {/* ========================================================================= */}
      {subTab === "backtest" && (
        <div className="flex flex-col gap-6">
          {/* Top Summary Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Card 1: Win Rate & Profit Multiples */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="size-4 text-amber-400" />
                  <h3 className="font-mono text-sm font-medium">快进快出获利胜率</h3>
                </div>
                <Badge variant="outline">Meme 极值统计</Badge>
              </div>

              {(() => {
                const tokens = backtestStatus?.trackedTokens ?? [];
                const total = tokens.length;
                const tpCount = tokens.filter(
                  (t) => (t.highestGainPct ?? 0) >= (backtestStatus?.config.takeProfitThresholdPct ?? 30),
                ).length;
                const doubleCount = tokens.filter(
                  (t) => (t.highestGainPct ?? 0) >= 100,
                ).length;
                const posCount = tokens.filter(
                  (t) =>
                    t.latestPriceUsd != null &&
                    t.alertPriceUsd != null &&
                    t.latestPriceUsd > t.alertPriceUsd,
                ).length;
                const winRate = total > 0 ? (tpCount / total) * 100 : 0;
                const doubleRate = total > 0 ? (doubleCount / total) * 100 : 0;

                return (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">🎯 止盈胜率 (≥+30%)</span>
                      <p className="font-mono text-base font-bold text-amber-400">
                        {winRate.toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {tpCount} / {total} 标的达标
                      </span>
                    </div>
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">🌟 翻倍爆发率 (≥+100%)</span>
                      <p className="font-mono text-base font-bold text-emerald-400">
                        {doubleRate.toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {doubleCount} 个代币翻倍
                      </span>
                    </div>
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">🟢 现价正收益率</span>
                      <p className="font-mono text-base font-bold text-foreground">
                        {total > 0 ? ((posCount / total) * 100).toFixed(1) : "0"}%
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {posCount} 涨 / {total - posCount} 跌
                      </span>
                    </div>
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">📊 已追踪标的</span>
                      <p className="font-mono text-base font-bold text-foreground">
                        {total} 个
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        含 Robinhood &amp; TG
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-3 text-[11px] text-muted-foreground font-mono">
                * 追踪推送后 ATH 峰值涨幅，捕捉土狗脉冲波段获利窗口
              </div>
            </div>

            {/* Card 2: Actions & Triggers */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-cyan-400" />
                  <h3 className="font-mono text-sm font-medium">周期回测与飞书推送</h3>
                </div>
                <Badge variant={backtestStatus?.config.autoLarkPush ? "go" : "default"}>
                  {backtestStatus?.config.autoLarkPush ? "战报推送开" : "已暂停"}
                </Badge>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p>
                  1 小时复盘:{" "}
                  <strong className="text-foreground">
                    每小时自动执行 (回顾 1h 前标的)
                  </strong>
                </p>
                <p>
                  上次 1h 回测:{" "}
                  <span className="font-mono text-foreground">
                    {backtestStatus?.lastHourlyCheckTime
                      ? new Date(backtestStatus.lastHourlyCheckTime).toLocaleTimeString("zh-CN")
                      : "待触发"}
                  </span>
                </p>
                <p>
                  上次 24h 复盘:{" "}
                  <span className="font-mono text-foreground">
                    {backtestStatus?.lastDailyCheckTime
                      ? new Date(backtestStatus.lastDailyCheckTime).toLocaleTimeString("zh-CN")
                      : "待触发"}
                  </span>
                </p>
                <p className="text-[11px] text-cyan-400 font-mono">
                  * 战报自动以 ** 为标题推送至飞书机器人
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => hourlyBacktestMutation.mutate()}
                  disabled={hourlyBacktestMutation.isPending}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5 mr-1",
                      hourlyBacktestMutation.isPending && "animate-spin",
                    )}
                  />
                  1小时极速回测
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => dailyBacktestMutation.mutate()}
                  disabled={dailyBacktestMutation.isPending}
                >
                  <Send className="size-3.5 mr-1" />
                  24小时大盘战报
                </Button>
              </div>
            </div>

            {/* Card 3: Disciplines */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-yellow-400" />
                  <h3 className="font-mono text-sm font-medium">土狗快进快出操盘策略</h3>
                </div>
                <Badge variant="outline">纪律模型</Badge>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-amber-400 font-medium">🎯 第一止盈位 (+30% ~ +50%)</span>
                  <p className="text-muted-foreground mt-0.5">
                    脉冲拉升时分批止盈 30%~50%，快速收回本金降低敞口。
                  </p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-emerald-400 font-medium">🌟 翻倍出本位 (+100%)</span>
                  <p className="text-muted-foreground mt-0.5">
                    达到 2x 必须卖出 50% 仓位彻底保本，剩余利润零成本博弈高倍。
                  </p>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-red-400 font-medium">🔴 铁律止损位 (-15% ~ -20%)</span>
                  <p className="text-muted-foreground mt-0.5">
                    跌破开仓成本支撑迅速止损，严禁长持变成死扛归零！
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tracked Tokens Feed & Report History */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-amber-400" />
                <h3 className="font-mono text-base font-semibold">
                  代币价格追踪与胜率表现 ({(backtestStatus?.trackedTokens ?? []).length})
                </h3>
              </div>

              <div className="flex items-center gap-1.5 rounded-lg bg-secondary p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setBacktestView("tokens")}
                  className={cn(
                    "rounded px-2.5 py-1 transition-colors",
                    backtestView === "tokens"
                      ? "bg-card text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  实时代币表现 ({(backtestStatus?.trackedTokens ?? []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setBacktestView("reports")}
                  className={cn(
                    "rounded px-2.5 py-1 transition-colors",
                    backtestView === "reports"
                      ? "bg-amber-500/20 text-amber-400 font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  历史飞书战报 ({(backtestStatus?.recentReports ?? []).length})
                </button>
              </div>
            </div>

            {/* View 1: Tracked Tokens List */}
            {backtestView === "tokens" && (
              <>
                {(backtestStatus?.trackedTokens ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    <p>暂无正在追踪的推送代币。</p>
                    <p className="mt-1 text-xs">
                      当 Robinhood 巡检或 Telegram 频道触发新的高潜力告警时，将自动收录并开启 5 分钟极值追踪！
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(backtestStatus?.trackedTokens ?? []).map((token) => {
                      const curPrice = token.latestPriceUsd;
                      const alertPrice = token.alertPriceUsd;
                      const roi =
                        curPrice && alertPrice && alertPrice > 0
                          ? ((curPrice - alertPrice) / alertPrice) * 100
                          : null;
                      const peak = token.highestGainPct ?? roi;

                      let verdictText = "稳健观察";
                      let verdictVariant: "go" | "default" | "stop" = "default";

                      if (peak != null && peak >= 200) {
                        verdictText = "🚀 爆拉 3x+ (超级肉)";
                        verdictVariant = "go";
                      } else if (peak != null && peak >= 100) {
                        verdictText = "🌟 翻倍 2x (大幅止盈)";
                        verdictVariant = "go";
                      } else if (peak != null && peak >= 30) {
                        verdictText = "🎯 达成止盈 (波段成功)";
                        verdictVariant = "go";
                      } else if (roi != null && roi < -25) {
                        verdictText = "🔴 跌破支撑 (触发止损)";
                        verdictVariant = "stop";
                      } else if (peak != null && peak >= 15 && (roi ?? 0) < 0) {
                        verdictText = "📉 冲高回落";
                        verdictVariant = "default";
                      }

                      return (
                        <div
                          key={token.id}
                          className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)] transition-all hover:bg-card/80"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-mono text-base font-bold text-foreground">
                                ${token.symbol}
                              </h4>
                              {token.name && (
                                <span className="text-xs text-muted-foreground">
                                  ({token.name})
                                </span>
                              )}
                              <Badge variant="outline" className="font-mono text-xs">
                                ⛓️ {token.chain}
                              </Badge>
                              <Badge variant={verdictVariant}>{verdictText}</Badge>
                              <Badge variant="outline" className="font-mono text-xs">
                                得分: {token.score}
                              </Badge>
                            </div>

                            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                              <span>来源: {token.source === "telegram-channel" ? `TG @${token.channel || "频道"}` : "Robinhood 链上"}</span>
                              <span>
                                {new Date(token.alertTimestamp).toLocaleTimeString("zh-CN")}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                            <div>
                              <span className="text-muted-foreground">推送价:</span>
                              <p className="font-mono font-bold text-foreground">
                                {alertPrice != null
                                  ? alertPrice < 0.0001
                                    ? `$${alertPrice.toExponential(3)}`
                                    : `$${alertPrice.toFixed(6)}`
                                  : "—"}
                              </p>
                            </div>

                            <div>
                              <span className="text-muted-foreground">当前现价:</span>
                              <p className="font-mono font-bold text-foreground">
                                {curPrice != null
                                  ? curPrice < 0.0001
                                    ? `$${curPrice.toExponential(3)}`
                                    : `$${curPrice.toFixed(6)}`
                                  : "—"}{" "}
                                {roi != null && (
                                  <span
                                    className={cn(
                                      "font-mono",
                                      roi >= 0 ? "text-emerald-400" : "text-red-400",
                                    )}
                                  >
                                    ({roi >= 0 ? "+" : ""}
                                    {roi.toFixed(1)}%)
                                  </span>
                                )}
                              </p>
                            </div>

                            <div>
                              <span className="text-muted-foreground">🚀 期间最高涨幅 (ATH):</span>
                              <p className="font-mono font-bold text-amber-400">
                                {token.highestGainPct != null
                                  ? `+${token.highestGainPct.toFixed(1)}%`
                                  : "—"}{" "}
                                {token.highestPriceUsd != null && (
                                  <span className="text-xs text-muted-foreground font-normal">
                                    (${token.highestPriceUsd < 0.0001 ? token.highestPriceUsd.toExponential(2) : token.highestPriceUsd.toFixed(4)})
                                  </span>
                                )}
                              </p>
                            </div>

                            <div>
                              <span className="text-muted-foreground">合约地址 (CA):</span>
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(token.tokenAddress);
                                  toast.success("合约地址已复制到剪贴板！");
                                }}
                                className="flex items-center gap-1 font-mono text-cyan-400 hover:underline"
                                title="点击一键复制"
                              >
                                {shortAddr(token.tokenAddress)}
                                <Copy className="size-3" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onInspect?.(token.tokenAddress)}
                            >
                              <Radio className="size-3.5" />
                              验合约
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <a
                                href={`https://dexscreener.com/search?q=${token.tokenAddress}`}
                                target="_blank"
                                rel="noreferrer"
                                className="gap-1"
                              >
                                <ExternalLink className="size-3.5" />
                                DexScreener 实时K线
                              </a>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* View 2: Reports History */}
            {backtestView === "reports" && (
              <>
                {(backtestStatus?.recentReports ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    <p>暂无生成的飞书战报记录。</p>
                    <p className="mt-1 text-xs">
                      点击上方「1小时极速回测」或「24小时大盘战报」按钮立即生成！
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(backtestStatus?.recentReports ?? []).map((rep) => (
                      <div
                        key={rep.id}
                        className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={rep.interval === "1h" ? "outline" : "default"}
                              className="font-mono text-xs"
                            >
                              {rep.interval === "1h" ? "⏱️ 1小时战报" : "📅 24小时大盘"}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground">
                              {new Date(rep.timestamp).toLocaleString("zh-CN")}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge variant={rep.larkOk ? "go" : "stop"}>
                              {rep.larkOk ? (
                                <CheckCircle2 className="mr-1 size-3" />
                              ) : (
                                <XCircle className="mr-1 size-3" />
                              )}
                              飞书: {rep.larkOk ? "已送达" : "未成功"}
                            </Badge>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          <div>
                            <span className="text-muted-foreground">统计标的:</span>
                            <p className="font-mono font-bold text-foreground">
                              {rep.summary.totalTokens} 个
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">止盈胜率 (≥+30%):</span>
                            <p className="font-mono font-bold text-amber-400">
                              {rep.summary.winRatePct.toFixed(1)}% ({rep.summary.takeProfitTokens} 个)
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">翻倍爆发率 (≥+100%):</span>
                            <p className="font-mono font-bold text-emerald-400">
                              {rep.summary.doubledTokens} 个标的
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">平均涨跌:</span>
                            <p className="font-mono font-bold text-foreground">
                              {rep.summary.avgChangePct >= 0 ? "+" : ""}
                              {rep.summary.avgChangePct.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TRADE & RISK CONTROL TAB CONTENT */}
      {/* ========================================================================= */}
      {subTab === "trade" && (
        <div className="flex flex-col gap-6">
          {/* Top Status Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Card 1: Trade Engine & Execution Mode */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-violet-400" />
                  <h3 className="font-mono text-sm font-medium">自动交易执行状态</h3>
                </div>
                <Badge
                  variant={tradeData?.config?.dryRun ? "outline" : "go"}
                  className={tradeData?.config?.dryRun ? "text-cyan-400 border-cyan-500/30" : ""}
                >
                  {tradeData?.config?.dryRun ? "模拟操盘 (Paper)" : "链上实盘 (Live)"}
                </Badge>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">自动开仓策略:</span>
                  <span
                    className={cn(
                      "font-mono font-medium",
                      tradeData?.config?.autoBuyEnabled ? "text-emerald-400" : "text-amber-400",
                    )}
                  >
                    {tradeData?.config?.autoBuyEnabled ? "● 运行中 (自动跟单)" : "○ 已暂停 (仅人工)"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">飞书交易战报:</span>
                  <span className="font-mono text-foreground">
                    {tradeData?.config?.larkTradeNotification ? "已开启实时推送" : "已关闭"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">当前运行持仓:</span>
                  <span className="font-mono font-bold text-violet-400">
                    {tradeData?.activePositions?.length ?? 0} 个活动仓位
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Wallet Balances & Gas Funds */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="size-4 text-emerald-400" />
                  <h3 className="font-mono text-sm font-medium">链上钱包与储备资金</h3>
                </div>
                <Badge variant="outline">
                  {tradeData?.walletAddress ? "已绑定私钥" : "未配私钥 (模拟)"}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">BSC 资金 (BNB)</span>
                  <p className="font-mono text-base font-bold text-yellow-400">
                    {tradeData?.bscBnbBalance ? Number(tradeData.bscBnbBalance).toFixed(4) : "0.0000"}
                  </p>
                  <span className="text-[10px] text-muted-foreground">PancakeSwap v2</span>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <span className="text-muted-foreground">Robinhood 资金 (ETH)</span>
                  <p className="font-mono text-base font-bold text-cyan-400">
                    {tradeData?.rhEthBalance ? Number(tradeData.rhEthBalance).toFixed(4) : "0.0000"}
                  </p>
                  <span className="text-[10px] text-muted-foreground">Pons Swap DEX</span>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>地址:</span>
                <span className="font-mono text-foreground">
                  {tradeData?.walletAddress
                    ? shortAddr(tradeData.walletAddress)
                    : "本地沙盒模拟账号"}
                </span>
              </div>
            </div>

            {/* Card 3: PnL Performance Summary */}
            <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-amber-400" />
                  <h3 className="font-mono text-sm font-medium">累计交易统计</h3>
                </div>
                <Badge variant="outline">实战/回测总览</Badge>
              </div>

              {(() => {
                const totalPnlUsd = tradeData?.totalRealizedPnlUsd ?? 0;
                const totalClosed = (tradeData?.winTradeCount ?? 0) + (tradeData?.lossTradeCount ?? 0);
                const winClosed = tradeData?.winTradeCount ?? 0;
                const winRate = tradeData?.winRatePct ?? 0;

                return (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">累计实现盈亏</span>
                      <p
                        className={cn(
                          "font-mono text-base font-bold",
                          totalPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {totalPnlUsd >= 0 ? "+" : ""}${totalPnlUsd.toFixed(2)}
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {totalClosed} 笔已平仓
                      </span>
                    </div>
                    <div className="rounded bg-secondary/50 p-2">
                      <span className="text-muted-foreground">交易胜率 (PnL &gt; 0)</span>
                      <p className="font-mono text-base font-bold text-amber-400">
                        {winRate.toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {winClosed} 胜 / {totalClosed - winClosed} 负
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Strategy Parameters Configuration Panel */}
          <div className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-violet-400" />
                <h3 className="font-mono text-base font-medium">策略与风控参数配置</h3>
                <span className="text-xs text-muted-foreground">
                  （调整入场单量、阶梯止盈比例、止损线与持仓时效）
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    updateTradeCfgMutation.mutate({
                      dryRun: tradeDryRun,
                      autoBuyEnabled: tradeAutoBuy,
                      buyAmountBscBnb: Number(tradeBuyBnb),
                      buyAmountRhEth: Number(tradeBuyEth),
                      executionTimeoutSeconds: Number(tradeTimeoutSec),
                      maxPriceDeviationPct: Number(tradeMaxDeviation),
                      slippagePct: Number(tradeSlippage),
                      tp1Pct: Number(tradeTp1Pct),
                      tp1SellRatioPct: Number(tradeTp1SellRatio),
                      tp2Pct: Number(tradeTp2Pct),
                      tp2SellRatioPct: Number(tradeTp2SellRatio),
                      tp3TrailingStopPct: Number(tradeTp3Trailing),
                      stopLossPct: Number(tradeStopLoss),
                      maxHoldTimeMinutes: Number(tradeMaxHoldMinutes),
                      emergencyLiquidityDrainPct: Number(tradeLiqDrain),
                      larkTradeNotification: tradeLarkNotification,
                    });
                  }}
                  disabled={updateTradeCfgMutation.isPending}
                  className="bg-violet-600 hover:bg-violet-500 text-white"
                >
                  <ShieldCheck className="size-3.5 mr-1" />
                  {updateTradeCfgMutation.isPending ? "保存中..." : "保存并应用策略"}
                </Button>
              </div>
            </div>

            {/* Mode & Switches */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 rounded-lg border border-border/40 bg-secondary/20 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tradeDryRun}
                  onChange={(e) => setTradeDryRun(e.target.checked)}
                  className="mt-1 size-4 rounded border-border"
                />
                <div>
                  <span className="font-mono text-sm font-medium text-cyan-400">
                    模拟沙盒操盘模式 (Dry-Run)
                  </span>
                  <p className="text-xs text-muted-foreground">
                    勾选后不消耗真实代币与私钥，按链上实时报价在本地精确模拟下单与撮合；取消勾选将发起真实链上交易。
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tradeAutoBuy}
                  onChange={(e) => setTradeAutoBuy(e.target.checked)}
                  className="mt-1 size-4 rounded border-border"
                />
                <div>
                  <span className="font-mono text-sm font-medium text-emerald-400">
                    自动跟单开仓 (Auto-Buy)
                  </span>
                  <p className="text-xs text-muted-foreground">
                    勾选后当 Telegram / Robinhood 雷达监测到符合高分条件的 Meme 币时，自动按预设仓位执行买入。
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tradeLarkNotification}
                  onChange={(e) => setTradeLarkNotification(e.target.checked)}
                  className="mt-1 size-4 rounded border-border"
                />
                <div>
                  <span className="font-mono text-sm font-medium text-amber-400">
                    飞书/Lark 交易战报推送
                  </span>
                  <p className="text-xs text-muted-foreground">
                    买入成交、阶梯分批止盈、快速止损或超时强平清仓时，即时向飞书机器人推送详细战报。
                  </p>
                </div>
              </label>
            </div>

            {/* Parameter Fields Grid */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Group A: Entry Ticket & Slippage */}
              <div className="space-y-4 rounded-lg border border-border/40 p-4">
                <div className="flex items-center gap-2 font-mono text-sm font-semibold text-yellow-400">
                  <DollarSign className="size-4" />
                  <span>单笔买入与滑点控制</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">BSC 单笔买入金额 (BNB)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tradeBuyBnb}
                    onChange={(e) => setTradeBuyBnb(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">建议 0.05 BNB (~$30) 稳健试仓</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Robinhood 单笔买入金额 (ETH)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={tradeBuyEth}
                    onChange={(e) => setTradeBuyEth(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">建议 0.005 ETH (~$15) 抢跑早鸟</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">信号时效 (秒)</label>
                    <input
                      type="number"
                      value={tradeTimeoutSec}
                      onChange={(e) => setTradeTimeoutSec(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-muted-foreground">&gt;60s 超时放弃</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">追高限制 (%)</label>
                    <input
                      type="number"
                      value={tradeMaxDeviation}
                      onChange={(e) => setTradeMaxDeviation(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-muted-foreground">超+10%不追</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">DEX 最大交易滑点 (%)</label>
                  <input
                    type="number"
                    value={tradeSlippage}
                    onChange={(e) => setTradeSlippage(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">土狗流动性浅，默认 8% 确保极速撮合</span>
                </div>
              </div>

              {/* Group B: Multi-Stage Take Profit */}
              <div className="space-y-4 rounded-lg border border-border/40 p-4">
                <div className="flex items-center gap-2 font-mono text-sm font-semibold text-emerald-400">
                  <TrendingUp className="size-4" />
                  <span>三段式阶梯止盈策略 (TP)</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">TP1 触发涨幅 (%)</label>
                    <input
                      type="number"
                      value={tradeTp1Pct}
                      onChange={(e) => setTradeTp1Pct(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-emerald-400">默认 +50% 启动</span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">TP1 抛售比例 (%)</label>
                    <input
                      type="number"
                      value={tradeTp1SellRatio}
                      onChange={(e) => setTradeTp1SellRatio(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-emerald-400">落袋 50% (收回75%本金)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">TP2 触发涨幅 (%)</label>
                    <input
                      type="number"
                      value={tradeTp2Pct}
                      onChange={(e) => setTradeTp2Pct(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-emerald-400">默认 +100% (翻倍)</span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">TP2 抛售比例 (%)</label>
                    <input
                      type="number"
                      value={tradeTp2SellRatio}
                      onChange={(e) => setTradeTp2SellRatio(Number(e.target.value))}
                      className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                    />
                    <span className="text-[10px] text-emerald-400">再卖 25% (全额保本且大赚)</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">TP3 移动止盈回撤阈值 (%)</label>
                  <input
                    type="number"
                    value={tradeTp3Trailing}
                    onChange={(e) => setTradeTp3Trailing(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    剩余 25% 仓位享受无上限单边牛市，当自历史最高 ATH 回撤超 25% 时清仓
                  </span>
                </div>
              </div>

              {/* Group C: Stop-Loss & Liquidation */}
              <div className="space-y-4 rounded-lg border border-border/40 p-4">
                <div className="flex items-center gap-2 font-mono text-sm font-semibold text-rose-400">
                  <ShieldAlert className="size-4" />
                  <span>严苛止损与安全清仓机制</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">快速止损触发线 (%)</label>
                  <input
                    type="number"
                    value={tradeStopLoss}
                    onChange={(e) => setTradeStopLoss(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm text-rose-400"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    默认 -18% 坚决砍仓，防止土狗直线下跌归零
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">最长持仓时效 (分钟)</label>
                  <input
                    type="number"
                    value={tradeMaxHoldMinutes}
                    onChange={(e) => setTradeMaxHoldMinutes(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    默认 360 分钟 (6小时) 自动市价平仓，杜绝死锁僵尸代币
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">防撤池/流动性抽逃清仓线 (%)</label>
                  <input
                    type="number"
                    value={tradeLiqDrain}
                    onChange={(e) => setTradeLiqDrain(Number(e.target.value))}
                    className="w-full rounded border border-border/60 bg-secondary/50 px-3 py-1.5 font-mono text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    池子流动性若短时间蒸发超 35%，判定疑似 Rug Pull 立即紧急清仓
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Active Positions Section */}
          <div className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Flame className="size-4 text-violet-400" />
                <h3 className="font-mono text-base font-medium">当前活跃持仓</h3>
                <Badge variant="go">
                  {tradeData?.activePositions?.length ?? 0} 个监控中
                </Badge>
                <span className="text-xs text-muted-foreground">（每 4 秒刷新实时行情与盈亏）</span>
              </div>
              {(tradeData?.activePositions?.length ?? 0) > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm("⚠️ 确认要市价一键全部清仓当前所有活跃持仓吗？")) {
                      closeAllMutation.mutate();
                    }
                  }}
                  disabled={closeAllMutation.isPending}
                >
                  <XCircle className="size-3.5 mr-1" />
                  {closeAllMutation.isPending ? "清仓中..." : "一键全仓市价平仓"}
                </Button>
              )}
            </div>

            {(!tradeData?.activePositions || tradeData.activePositions.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Target className="size-10 text-muted-foreground/40 mb-2" />
                <p className="font-mono text-sm text-muted-foreground">
                  当前暂无持仓
                </p>
                <p className="text-xs text-muted-foreground/70 max-w-md mt-1">
                  当 Telegram 频道或 Robinhood 链上雷达捕获到评分 ≥ 80 的潜力 Meme 币时，将根据开仓条件自动在此建立仓位并实施三段式止盈与风控。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {tradeData.activePositions.map((pos) => {
                  const pnlPct = pos.currentGainPct ?? 0;
                  const isPositive = pnlPct >= 0;
                  const entryMs = new Date(pos.entryTime).getTime();
                  const holdMin = Math.round((Date.now() - entryMs) / 60000);
                  const explorerUrl =
                    pos.chain === "bsc"
                      ? `https://bscscan.com/token/${pos.tokenAddress}`
                      : `https://robinhoodchain.blockscout.com/token/${pos.tokenAddress}`;
                  const unrealizedUsd = (pos.entryCostUsd || 0) * (pnlPct / 100);
                  const athDrawdown =
                    pos.highestPriceUsd > 0
                      ? Math.max(
                          0,
                          ((pos.highestPriceUsd - (pos.currentPriceUsd || pos.highestPriceUsd)) /
                            pos.highestPriceUsd) *
                            100,
                        )
                      : 0;

                  return (
                    <div
                      key={pos.id}
                      className="flex flex-col gap-3 rounded-lg border border-border/50 bg-secondary/20 p-4 transition-colors hover:border-border"
                    >
                      {/* Top info line */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-foreground">
                            ${pos.symbol}
                          </span>
                          <span className="text-xs text-muted-foreground">({pos.name || pos.symbol})</span>
                          <Badge
                            variant={pos.chain === "bsc" ? "outline" : "go"}
                            className={pos.chain === "bsc" ? "text-yellow-400 border-yellow-500/30" : ""}
                          >
                            {pos.chain === "bsc" ? "BSC (PancakeSwap)" : "Robinhood (Pons)"}
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            [{shortAddr(pos.tokenAddress)}]
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(pos.tokenAddress);
                              toast.success(`已复制 ${pos.symbol} 合约地址！`);
                            }}
                            className="text-muted-foreground hover:text-foreground"
                            title="复制合约地址"
                          >
                            <Copy className="size-3.5" />
                          </button>
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="查看区块链浏览器"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant={isPositive ? "go" : "stop"}
                            className="font-mono text-sm px-2.5 py-0.5"
                          >
                            {isPositive ? "+" : ""}
                            {pnlPct.toFixed(1)}%
                          </Badge>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => closePositionMutation.mutate(pos.id)}
                            disabled={closePositionMutation.isPending}
                          >
                            <XCircle className="size-3.5 mr-1" />
                            市价平仓
                          </Button>
                        </div>
                      </div>

                      {/* Position metrics grid */}
                      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                        <div>
                          <span className="text-muted-foreground">买入成本 (入场价):</span>
                          <p className="font-mono font-medium text-foreground">
                            ${pos.entryPriceUsd.toFixed(6)}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {pos.entryCostNative.toFixed(4)} {pos.chain === "bsc" ? "BNB" : "ETH"} (${pos.entryCostUsd.toFixed(1)})
                          </span>
                        </div>

                        <div>
                          <span className="text-muted-foreground">当前价格 (最新):</span>
                          <p
                            className={cn(
                              "font-mono font-medium",
                              isPositive ? "text-emerald-400" : "text-rose-400",
                            )}
                          >
                            ${pos.currentPriceUsd?.toFixed(6) ?? "0.000000"}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            未实现: {isPositive ? "+" : ""}${unrealizedUsd.toFixed(2)}
                          </span>
                        </div>

                        <div>
                          <span className="text-muted-foreground">历史最高 ATH:</span>
                          <p className="font-mono font-medium text-amber-400">
                            ${pos.highestPriceUsd.toFixed(6)}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            高点回撤: -{athDrawdown.toFixed(1)}%
                          </span>
                        </div>

                        <div>
                          <span className="text-muted-foreground">阶梯止盈进度:</span>
                          <div className="flex flex-col gap-0.5 font-mono text-[11px] mt-0.5">
                            <span className={pos.tp1Done ? "text-emerald-400" : "text-muted-foreground"}>
                              TP1 (+50%): {pos.tp1Done ? "✅ 已出50%" : "⏳ 待触发"}
                            </span>
                            <span className={pos.tp2Done ? "text-emerald-400" : "text-muted-foreground"}>
                              TP2 (+100%): {pos.tp2Done ? "✅ 已出25%" : "⏳ 待触发"}
                            </span>
                            <span className={pos.tp2Done ? "text-cyan-400" : "text-muted-foreground"}>
                              TP3 (移动止盈): {pos.tp2Done ? "🏃 追踪中" : "待触发"}
                            </span>
                          </div>
                        </div>

                        <div>
                          <span className="text-muted-foreground">持有时长:</span>
                          <p className="font-mono font-medium text-foreground">
                            {holdMin < 60 ? `${holdMin} 分钟` : `${(holdMin / 60).toFixed(1)} 小时`}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            已落袋: +${pos.realizedPnlUsd.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historical Closed Positions Section */}
          <div className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <h3 className="font-mono text-base font-medium">历史已平仓交易</h3>
                <Badge variant="outline">
                  {tradeData?.closedPositions?.length ?? 0} 笔
                </Badge>
              </div>
            </div>

            {(!tradeData?.closedPositions || tradeData.closedPositions.length === 0) ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                暂无历史平仓记录
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {tradeData.closedPositions.slice(0, 20).map((pos) => {
                  const pnl = pos.realizedPnlUsd ?? 0;
                  const isProfitable = pnl >= 0;
                  const entryMs = new Date(pos.entryTime).getTime();
                  const closeMs = pos.closeTime ? new Date(pos.closeTime).getTime() : Date.now();
                  const holdMin = Math.round((closeMs - entryMs) / 60000);

                  const reasonMap: Record<string, { label: string; variant: "go" | "stop" | "warn" | "outline" }> = {
                    CLOSED_TP: { label: "🎯 阶梯止盈清仓", variant: "go" },
                    CLOSED_SL: { label: "🛑 快速止损触发", variant: "stop" },
                    CLOSED_TIMEOUT: { label: "⏱️ 6小时超时强平", variant: "outline" },
                    CLOSED_MANUAL: { label: "👤 人工手动平仓", variant: "outline" },
                    TAKE_PROFIT_COMPLETE: { label: "🎯 阶梯止盈清仓", variant: "go" },
                    STOP_LOSS: { label: "🛑 快速止损触发", variant: "stop" },
                    TIMEOUT_6H: { label: "⏱️ 6小时超时强平", variant: "outline" },
                    LIQUIDITY_DRAIN: { label: "🚨 防撤池紧急清仓", variant: "stop" },
                    MANUAL_CLOSE: { label: "👤 人工手动平仓", variant: "outline" },
                  };
                  const r = reasonMap[pos.status || ""] || { label: pos.status || "已平仓", variant: "outline" };

                  return (
                    <div
                      key={pos.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/30 bg-secondary/15 px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-bold text-foreground">
                          ${pos.symbol}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {pos.chain.toUpperCase()}
                        </Badge>
                        <Badge variant={r.variant} className="text-[10px]">
                          {r.label}
                        </Badge>
                        <span className="font-mono text-muted-foreground">
                          持有时长: {holdMin < 60 ? `${holdMin} 分` : `${(holdMin / 60).toFixed(1)} 小时`}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[10px] text-muted-foreground">净盈亏:</span>
                          <p
                            className={cn(
                              "font-mono font-bold",
                              isProfitable ? "text-emerald-400" : "text-rose-400",
                            )}
                          >
                            {isProfitable ? "+" : ""}${pnl.toFixed(2)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onInspect?.(pos.tokenAddress)}
                        >
                          <Radio className="size-3.5 mr-1" />
                          验合约
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROBINHOOD V3 ASYMMETRIC LP MARKET MAKER TAB CONTENT */}
      {/* ========================================================================= */}
      {subTab === "lp" && <LpPanel onInspect={onInspect} />}
    </div>
  );
}
