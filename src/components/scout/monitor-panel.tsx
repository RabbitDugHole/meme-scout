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
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getMonitorStatus,
  sendTestLarkAlarm,
  triggerMonitorScan,
  updateMonitorConfig,
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

  const { data: status, isLoading } = useQuery({
    queryKey: ["monitorStatus"],
    queryFn: () => getMonitorStatus(),
    refetchInterval: 6000,
  });

  const [webhookUrl, setWebhookUrl] = useState(
    status?.config.webhookUrl || DEFAULT_LARK_WEBHOOK_URL,
  );
  const [minScore, setMinScore] = useState(status?.config.minScoreThreshold ?? 65);
  const [minLiq, setMinLiq] = useState(status?.config.minLiquidityUsd ?? 30000);
  const [autoAlarm, setAutoAlarm] = useState(
    status?.config.autoAlarmEnabled ?? true,
  );

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
      toast.success("监控配置已保存并生效！");
    },
    onError: (err: any) => {
      toast.error(`配置保存失败: ${err?.message || String(err)}`);
    },
  });

  const handleSaveConfig = () => {
    updateConfigMutation.mutate({
      webhookUrl,
      minScoreThreshold: Number(minScore),
      minLiquidityUsd: Number(minLiq),
      autoAlarmEnabled: autoAlarm,
    });
  };

  const history = status?.history ?? [];

  return (
    <div className="flex flex-col gap-6 py-4">
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
              className="w-full"
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
                评分 ≥ {minScore} 分 (A/S级)
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
              {testLarkMutation.isPending ? "发送测试中..." : "测试发送飞书告警"}
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
              {history.length} 条记录
            </strong>
          </div>
        </div>
      </div>

      {/* Configuration Drawer / Accordion */}
      <div className="rounded-xl bg-card p-5 shadow-[0_0_0_1px_rgb(255_255_255_/_8%)]">
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-muted-foreground" />
            <h3 className="font-mono text-sm font-semibold">告警机器人与触发参数配置</h3>
          </div>
          <Button
            size="sm"
            onClick={handleSaveConfig}
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
                建议 65 分 (A-Tier/S-Tier 强劲潜力)
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

      {/* Alarm History Log */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-[#00f5a0]" />
            <h3 className="font-mono text-base font-semibold">
              潜力 Meme 币告警推送动态 ({history.length})
            </h3>
          </div>
          <span className="text-xs text-muted-foreground">
            仅展示通过多维潜力模型与安全锁仓的代币
          </span>
        </div>

        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <p>暂无触发告警的潜力代币记录。</p>
            <p className="mt-1 text-xs">
              点击上方「立即触发全链巡检」或保持后台自动监控运行中。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((record) => (
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
  );
}
