import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getTwoFactorStatus,
  validateTwoFactorSession,
  verifyTwoFactorLogin,
} from "@/lib/scout/actions";

export function TwoFactorGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [hasCheckedLocal, setHasCheckedLocal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("rh_meme_2fa_token");
    setToken(saved);
    setHasCheckedLocal(true);
  }, []);

  // Validate session on server
  const { data: sessionCheck, isLoading: isCheckingSession, refetch: recheckSession } = useQuery({
    queryKey: ["twoFactorSession", token],
    queryFn: () => validateTwoFactorSession({ data: { token } }),
    enabled: hasCheckedLocal,
    refetchInterval: 30_000,
  });

  // Verify Login Mutation
  const loginMut = useMutation({
    mutationFn: (loginCode: string) => verifyTwoFactorLogin({ data: { code: loginCode } }),
    onSuccess: (res) => {
      if (res.success && res.sessionToken) {
        localStorage.setItem("rh_meme_2fa_token", res.sessionToken);
        setToken(res.sessionToken);
        setCode("");
        toast.success("🔓 身份验证成功，欢迎回来！");
        recheckSession();
      } else {
        toast.error(res.error || "验证码错误，请重新输入");
      }
    },
    onError: (err: any) => {
      toast.error(`登录失败: ${err?.message || err}`);
    },
  });

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      toast.error("请输入 6 位动态验证码");
      return;
    }
    loginMut.mutate(code.trim());
  };

  // Loading state
  if (!hasCheckedLocal || isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#08090b] flex flex-col items-center justify-center gap-3">
        <div className="size-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
          <RefreshCw className="size-5 animate-spin" />
        </div>
        <span className="text-xs text-muted-foreground">正在验证安全会话状态...</span>
      </div>
    );
  }

  // 1. Not Configured: guide user to /init-meme
  if (!sessionCheck?.isConfigured) {
    return (
      <div className="min-h-screen bg-[#08090b] text-foreground flex flex-col items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-amber-500/40 bg-card/90 backdrop-blur-xl p-6 md:p-8 shadow-2xl flex flex-col items-center text-center gap-5">
          <div className="size-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <ShieldAlert className="size-7" />
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-bold text-foreground">
              Google 2FA 尚未初始化
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              为了确保 Robinhood Meme Scout 自动化做市与交易控制台的安全，首次启动必须先完成 Google 2FA 密钥绑定。
            </p>
          </div>

          <Button
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold h-11 rounded-xl"
            onClick={() => (window.location.href = "/init-meme")}
          >
            前往初始化 2FA 密钥 (/init-meme)
          </Button>

          <span className="text-[11px] text-muted-foreground/70">
            导入 Google Authenticator 后即可解锁全量功能
          </span>
        </div>
      </div>
    );
  }

  // 2. Configured but session is invalid/expired: Lock Screen Login
  if (!sessionCheck?.valid) {
    return (
      <div className="min-h-screen bg-[#08090b] text-foreground flex flex-col items-center justify-center p-4">
        {/* Background glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(59,130,246,0.08),transparent_50%)] pointer-events-none" />

        <div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card/90 backdrop-blur-xl p-6 md:p-8 shadow-2xl flex flex-col gap-6">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="size-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-1 shadow-lg shadow-blue-500/10">
              <Lock className="size-7" />
            </div>
            <h1 className="text-xl font-bold text-foreground">
              管理员身份验证
            </h1>
            <p className="text-xs text-muted-foreground">
              请输入手机 Google Authenticator 上的 6 位动态验证码
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                maxLength={6}
                autoFocus
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setCode(val);
                  if (val.length === 6) {
                    loginMut.mutate(val);
                  }
                }}
                className="w-full bg-secondary/80 border border-blue-500/40 focus:border-blue-500 rounded-xl px-4 py-3 text-center text-3xl font-mono tracking-[0.3em] font-bold text-foreground focus:outline-none transition-all shadow-inner"
              />
              <span className="text-[11px] text-muted-foreground text-center">
                支持输入满 6 位自动提交验证
              </span>
            </div>

            <Button
              type="submit"
              disabled={code.length !== 6 || loginMut.isPending}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-11 text-sm rounded-xl shadow-lg shadow-blue-500/20"
            >
              {loginMut.isPending ? "正在核验动态口令..." : "验证并进入管理端"}
            </Button>
          </form>

          <div className="border-t border-border/40 pt-4 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-blue-400" />
              2FA 已生效保护
            </span>
            <a
              href="/init-meme"
              className="text-blue-400 hover:underline hover:text-blue-300"
            >
              更换设备 / 重新初始化
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 3. Valid session: render protected children with global topbar indicator
  return (
    <>
      {children}
    </>
  );
}
