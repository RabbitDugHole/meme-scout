import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export type TwoFactorConfig = {
  isConfigured: boolean;
  secret: string;
  issuer: string;
  account: string;
  initializedAt: string | null;
};

export type TwoFactorStatus = {
  isConfigured: boolean;
  initializedAt: string | null;
  account: string;
  issuer: string;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const TWO_FACTOR_CONFIG_FILE = path.resolve(DATA_DIR, "2fa-config.json");
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.BETTER_AUTH_SECRET ||
  "rh-meme-scout-google-2fa-token-signature-key-2026";

// Active setup sessions cache: setupId -> { secret, expiresAt }
const activeSetups = new Map<string, { secret: string; expiresAt: number }>();

export class TwoFactorService {
  private static instance: TwoFactorService | null = null;

  private config: TwoFactorConfig = {
    isConfigured: false,
    secret: "",
    issuer: "RH-Meme-Scout",
    account: "admin",
    initializedAt: null,
  };

  public constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): TwoFactorService {
    if (!TwoFactorService.instance) {
      TwoFactorService.instance = new TwoFactorService();
    }
    return TwoFactorService.instance;
  }

  private loadFromStorage(): void {
    try {
      if (fs.existsSync(TWO_FACTOR_CONFIG_FILE)) {
        const raw = fs.readFileSync(TWO_FACTOR_CONFIG_FILE, "utf8");
        const data = JSON.parse(raw);
        if (data && typeof data.secret === "string" && data.isConfigured) {
          this.config = {
            ...this.config,
            ...data,
          };
          console.log(
            `🔐 [TwoFactorService] 2FA 配置已载入 (初始化时间: ${this.config.initializedAt})`,
          );
        }
      }
    } catch (err: any) {
      console.warn("[TwoFactorService] 载入 2FA 存储配置失败:", err?.message || err);
    }
  }

  private saveToStorage(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(
        TWO_FACTOR_CONFIG_FILE,
        JSON.stringify(this.config, null, 2),
        "utf8",
      );
    } catch (err: any) {
      console.warn("[TwoFactorService] 保存 2FA 配置失败:", err?.message || err);
    }
  }

  public getStatus(): TwoFactorStatus {
    return {
      isConfigured: this.config.isConfigured,
      initializedAt: this.config.initializedAt,
      account: this.config.account,
      issuer: this.config.issuer,
    };
  }

  /**
   * Generate temporary 2FA secret and QR code for /init-meme initialization page.
   */
  public async createSetupSession(): Promise<{
    setupId: string;
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
    isAlreadyConfigured: boolean;
  }> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      secret,
      label: this.config.account,
      issuer: this.config.issuer,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      margin: 2,
      width: 280,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    const setupId = `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Expire setup session after 15 minutes
    activeSetups.set(setupId, {
      secret,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    // Clean old setups
    const now = Date.now();
    for (const [id, item] of activeSetups.entries()) {
      if (item.expiresAt < now) {
        activeSetups.delete(id);
      }
    }

    return {
      setupId,
      secret,
      otpauthUrl,
      qrCodeDataUrl,
      isAlreadyConfigured: this.config.isConfigured,
    };
  }

  /**
   * Confirm initial setup by verifying the 6-digit dynamic code.
   */
  public confirmSetup(params: {
    setupId: string;
    code: string;
  }): {
    success: boolean;
    sessionToken?: string;
    error?: string;
  } {
    const setup = activeSetups.get(params.setupId);
    if (!setup || setup.expiresAt < Date.now()) {
      return {
        success: false,
        error: "初始化配置已超时，请刷新页面重新获取二维码",
      };
    }

    const cleanCode = params.code.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      return {
        success: false,
        error: "请输入 6 位纯数字动态验证码",
      };
    }

    const verifyResult = verifySync({
      token: cleanCode,
      secret: setup.secret,
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        error: "动态验证码错误，请确保已正确扫描并同步手机时间",
      };
    }

    // Success: activate 2FA
    this.config.secret = setup.secret;
    this.config.isConfigured = true;
    this.config.initializedAt = new Date().toISOString();
    this.saveToStorage();

    activeSetups.delete(params.setupId);

    const sessionToken = this.createSessionToken();
    console.log("🎉 [TwoFactorService] Google 2FA 初始化并首次验证成功！");

    return {
      success: true,
      sessionToken,
    };
  }

  /**
   * Verify dynamic code to log in to dashboard.
   */
  public verifyLogin(code: string): {
    success: boolean;
    sessionToken?: string;
    error?: string;
  } {
    if (!this.config.isConfigured || !this.config.secret) {
      return {
        success: false,
        error: "系统尚未配置 Google 2FA，请先访问 /init-meme 进行初始化配置",
      };
    }

    const cleanCode = code.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      return {
        success: false,
        error: "请输入 6 位纯数字动态验证码",
      };
    }

    const verifyResult = verifySync({
      token: cleanCode,
      secret: this.config.secret,
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        error: "动态验证码无效或已过期，请重新核对输入",
      };
    }

    const sessionToken = this.createSessionToken();
    return {
      success: true,
      sessionToken,
    };
  }

  /**
   * Reset 2FA with current valid 6-digit code.
   */
  public resetConfig(currentCode: string): {
    success: boolean;
    error?: string;
  } {
    if (!this.config.isConfigured) {
      return { success: true };
    }

    const cleanCode = currentCode.trim().replace(/\s+/g, "");
    const verifyResult = verifySync({
      token: cleanCode,
      secret: this.config.secret,
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        error: "当前动态验证码错误，无法重置 2FA",
      };
    }

    this.config.isConfigured = false;
    this.config.secret = "";
    this.config.initializedAt = null;
    this.saveToStorage();

    console.log("⚠️ [TwoFactorService] Google 2FA 已重置");
    return { success: true };
  }

  /**
   * Issue signed 30-day session token.
   */
  public createSessionToken(): string {
    const expiresAt = Date.now() + 30 * 24 * 3600 * 1000; // 30 days
    const payload = JSON.stringify({
      role: "admin",
      exp: expiresAt,
      iat: Date.now(),
    });
    const b64Payload = Buffer.from(payload).toString("base64url");
    const hmac = createHmac("sha256", SESSION_SECRET)
      .update(b64Payload)
      .digest("base64url");
    return `${b64Payload}.${hmac}`;
  }

  /**
   * Validate session token authenticity and expiry.
   */
  public validateSession(token?: string | null): boolean {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [b64Payload, hmac] = parts;
    try {
      const expectedHmac = createHmac("sha256", SESSION_SECRET)
        .update(b64Payload)
        .digest("base64url");

      const hmacBuf = Buffer.from(hmac);
      const expectedBuf = Buffer.from(expectedHmac);
      if (hmacBuf.length !== expectedBuf.length) return false;
      if (!timingSafeEqual(hmacBuf, expectedBuf)) return false;

      const payload = JSON.parse(
        Buffer.from(b64Payload, "base64url").toString("utf8"),
      );
      if (!payload.exp || Date.now() > payload.exp) return false;

      return true;
    } catch {
      return false;
    }
  }
}

export const twoFactorService = TwoFactorService.getInstance();
