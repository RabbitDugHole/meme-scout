import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  confirmTwoFactorSetup,
  createTwoFactorSetup,
  getTwoFactorStatus,
  resetTwoFactor,
} from "@/lib/scout/actions";

export const Route = createFileRoute("/init-meme")({
  component: InitMemePage,
});

function InitMemePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [showReset, setShowReset] = useState(false);

  // Check current status
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["twoFactorStatus"],
    queryFn: () => getTwoFactorStatus(),
  });

  // Setup session query
  const {
    data: setupData,
    isLoading: isLoadingSetup,
    refetch: refetchSetup,
  } = useQuery({
    queryKey: ["twoFactorSetup"],
    queryFn: () => createTwoFactorSetup(),
    enabled: status ? !status.isConfigured : true,
  });

  // Confirm Setup Mutation
  const confirmMut = useMutation({
    mutationFn: (params: { setupId: string; code: string }) =>
      confirmTwoFactorSetup({ data: params }),
    onSuccess: (res) => {
      if (res.success && res.sessionToken) {
        localStorage.setItem("rh_meme_2fa_token", res.sessionToken);
        toast.success("🎉 Google 2FA 绑定成功！已为您解锁管理权限");
        setTimeout(() => {
          navigate({ to: "/" });
        }, 1200);
      } else {
        toast.error(res.error || "验证失败，请重新输入");
      }
    },
    onError: (err: any) => {
      toast.error(`提交失败: ${err?.message || err}`);
    },
  });

  // Reset Mutation
  const resetMut = useMutation({
    mutationFn: (currentCode: string) =>
      resetTwoFactor({ data: { currentCode } }),
    onSuccess: (res) => {
      if (res.success) {
        localStorage.removeItem("rh_meme_2fa_token");
        toast.success("2FA 配置已成功重置，正在重新生成密钥二维码...");
        setShowReset(false);
        setResetCode("");
        refetchStatus();
        refetchSetup();
      } else {
        toast.error(res.error || "重置失败");
      }
    },
    onError: (err: any) => {
      toast.error(`重置失败: ${err?.message || err}`);
    },
  });

  const handleCopySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      toast.success("2FA 密钥文本已复制到剪贴板");
    }
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData?.setupId) {
      toast.error("配置会话异常，请刷新重试");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("请输入 6 位纯数字动态码");
      return;
    }
    confirmMut.mutate({
      setupId: setupData.setupId,
      code: code.trim(),
    });
  };

  return (
    <div className="min-h-screen bg-[#08090b] text-foreground flex flex-col items-center justify-center p-4">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(59,130,246,0.08),transparent_50%)] pointer-events-none" />

      <div className="relative w-full max-w-lg rounded-2xl border border-border/80 bg-card/90 backdrop-blur-xl p-6 md:p-8 shadow-2xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="size-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-1">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            Google 2FA 双因素安全配置
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Robinhood Meme Scout 自动化管理端安全认证初始化
          </p>
        </div>

        {status?.isConfigured ? (
          /* ========================================================================= */
          /* Already Configured State */
          /* ========================================================================= */
          <div className="flex flex-col gap-5 py-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="size-6 text-emerald-400 shrink-0" />
              <div className="text-xs">
                <div className="font-semibold text-emerald-400 text-sm">
                  Google 2FA 已成功初始化绑定
                </div>
                <div className="text-muted-foreground mt-0.5">
                  初始化时间: {status.initializedAt?.replace("T", " ").slice(0, 19)} UTC
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
                onClick={() => navigate({ to: "/" })}
              >
                进入管理端大盘
              </Button>

              <Button
                variant="outline"
                className="w-full text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowReset(!showReset)}
              >
                {showReset ? "取消重置" : "更换设备 / 重置 2FA 密钥"}
              </Button>
            </div>

            {showReset && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex flex-col gap-3 text-xs">
                <div className="flex items-center gap-2 text-destructive font-semibold">
                  <ShieldAlert className="size-4" />
                  <span>重置 2FA 身份验证</span>
                </div>
                <p className="text-muted-foreground">
                  为防止未授权重置，请输入当前 Google Authenticator 中的 6 位动态验证码确认：
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="输入 6 位当前动态码"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                    className="flex-1 bg-secondary/80 border border-border/80 rounded-lg px-3 py-2 text-center text-sm font-mono tracking-widest text-foreground focus:outline-none focus:border-destructive"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-9 px-4 text-xs font-semibold"
                    disabled={resetCode.length !== 6 || resetMut.isPending}
                    onClick={() => resetMut.mutate(resetCode)}
                  >
                    确认重置
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* Initial Setup Flow */
          /* ========================================================================= */
          <div className="flex flex-col gap-6">
            {/* Step 1: Scan QR Code */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                <Smartphone className="size-4" />
                <span>步骤 1: 使用 Google Authenticator 扫码</span>
              </div>

              {isLoadingSetup ? (
                <div className="size-60 rounded-xl border border-dashed border-border/70 flex items-center justify-center">
                  <RefreshCw className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : setupData?.qrCodeDataUrl ? (
                <div className="p-2.5 bg-white rounded-xl shadow-lg border border-border/40 flex items-center justify-center">
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="Google 2FA QR Code"
                    className="size-56 object-contain"
                  />
                </div>
              ) : (
                <div className="text-xs text-destructive">获取二维码失败，请刷新重试</div>
              )}
            </div>

            {/* Step 2: Secret Text Copy */}
            <div className="flex flex-col gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">
                无法扫码？可手动添加账户并录入密钥：
              </span>
              <div className="flex items-center gap-2 bg-secondary/60 border border-border/70 rounded-lg px-3 py-2">
                <code className="flex-1 font-mono text-[11px] text-foreground break-all select-all">
                  {setupData?.secret || "加载中..."}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={handleCopySecret}
                >
                  <Copy className="size-3.5 mr-1" />
                  复制
                </Button>
              </div>
            </div>

            {/* Step 3: Enter Code & Activate */}
            <form onSubmit={handleConfirm} className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-foreground">步骤 2: 输入 App 产生的 6 位验证码</span>
                <span className="text-muted-foreground font-mono">{code.length}/6</span>
              </div>

              <input
                type="text"
                maxLength={6}
                autoFocus
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-secondary/80 border border-blue-500/40 focus:border-blue-500 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] font-bold text-foreground focus:outline-none transition-all shadow-inner"
              />

              <Button
                type="submit"
                disabled={code.length !== 6 || confirmMut.isPending}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-11 text-sm rounded-xl mt-1 shadow-lg shadow-blue-500/20"
              >
                {confirmMut.isPending ? "正在验证密钥..." : "绑定并激活 2FA"}
              </Button>
            </form>
          </div>
        )}

        {/* Footer info */}
        <div className="border-t border-border/40 pt-4 text-center text-[11px] text-muted-foreground/80 flex items-center justify-center gap-1.5">
          <ShieldCheck className="size-3.5 text-blue-400 shrink-0" />
          <span>TOTP RFC 6238 工业级动态口令协议 · 密钥本地安全加密存储</span>
        </div>
      </div>
    </div>
  );
}
