import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addTgChannel,
  getMonitorStatus,
  getTgMonitorStatus,
  removeTgChannel,
  sendTestLarkAlarm,
  toggleTgChannel,
  triggerMonitorScan,
  triggerTgPoll,
  updateMonitorConfig,
  updateTgMonitorConfig,
} from "@/lib/scout/actions";
import { formatUsd, shortAddr } from "@/lib/scout/format";
import { DEFAULT_LARK_WEBHOOK_URL } from "@/lib/scout/lark";
import { cn } from "@/lib/utils";

export function MonitorPanel({
  onInspect,
}: {
  onInspect?: (address: string) => void;
}) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<"robinhood" | "telegram">("telegram");

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
    </div>
  );
}
