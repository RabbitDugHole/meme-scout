import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateSync } from "otplib";
import { twoFactorService } from "./two-factor.server";

const DATA_DIR = path.resolve(process.cwd(), "data");
const TEST_CONFIG_FILE = path.resolve(DATA_DIR, "2fa-config.json");
let backupConfig: string | null = null;

before(() => {
  if (fs.existsSync(TEST_CONFIG_FILE)) {
    backupConfig = fs.readFileSync(TEST_CONFIG_FILE, "utf8");
  }
});

after(() => {
  if (backupConfig !== null) {
    fs.writeFileSync(TEST_CONFIG_FILE, backupConfig, "utf8");
  } else if (fs.existsSync(TEST_CONFIG_FILE)) {
    fs.unlinkSync(TEST_CONFIG_FILE);
  }
});

describe("Google 2FA Service Suite", () => {
  test("createSetupSession should generate secret and valid QR code data URL", async () => {
    const setup = await twoFactorService.createSetupSession();
    assert.ok(setup.setupId.startsWith("setup-"));
    assert.ok(setup.secret.length >= 16, "Secret should be at least 16 chars");
    assert.ok(
      setup.qrCodeDataUrl.startsWith("data:image/png;base64,"),
      "QR code should be a base64 PNG data URL",
    );
    assert.ok(
      setup.otpauthUrl.includes("otpauth://totp/"),
      "OTPAuth URL should follow standard format",
    );
  });

  test("confirmSetup should reject incorrect 6-digit codes", async () => {
    const setup = await twoFactorService.createSetupSession();
    const result = twoFactorService.confirmSetup({
      setupId: setup.setupId,
      code: "000000",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("动态验证码错误"));
  });

  test("confirmSetup should succeed with valid TOTP code and issue session token", async () => {
    const setup = await twoFactorService.createSetupSession();
    const validCode = generateSync({ secret: setup.secret });

    const result = twoFactorService.confirmSetup({
      setupId: setup.setupId,
      code: validCode,
    });

    assert.equal(result.success, true);
    assert.ok(result.sessionToken);

    // Verify status is now configured
    const status = twoFactorService.getStatus();
    assert.equal(status.isConfigured, true);
    assert.ok(status.initializedAt);

    // Validate the issued session token
    const isValidSession = twoFactorService.validateSession(result.sessionToken);
    assert.equal(isValidSession, true);
  });

  test("verifyLogin should validate correct dynamic code and reject wrong code", () => {
    const status = twoFactorService.getStatus();
    assert.equal(status.isConfigured, true);

    // Wrong code
    const wrong = twoFactorService.verifyLogin("999999");
    assert.equal(wrong.success, false);

    // Valid code using the internal secret
    // Note: in confirmSetup, secret was saved
    // Let's test login with newly generated code
    const raw = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, "utf8"));
    const currentCode = generateSync({ secret: raw.secret });

    const correct = twoFactorService.verifyLogin(currentCode);
    assert.equal(correct.success, true);
    assert.ok(correct.sessionToken);
    assert.equal(twoFactorService.validateSession(correct.sessionToken), true);
  });

  test("validateSession should reject forged or tampered tokens", () => {
    assert.equal(twoFactorService.validateSession(null), false);
    assert.equal(twoFactorService.validateSession(""), false);
    assert.equal(twoFactorService.validateSession("invalid.token"), false);

    const validToken = twoFactorService.createSessionToken();
    const tampered = validToken.slice(0, -4) + "XXXX";
    assert.equal(twoFactorService.validateSession(tampered), false);
  });

  test("resetConfig should allow resetting with valid code", () => {
    const raw = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, "utf8"));
    const currentCode = generateSync({ secret: raw.secret });

    // Wrong code fails
    const badReset = twoFactorService.resetConfig("111111");
    assert.equal(badReset.success, false);

    // Correct code succeeds
    const goodReset = twoFactorService.resetConfig(currentCode);
    assert.equal(goodReset.success, true);
    assert.equal(twoFactorService.getStatus().isConfigured, false);
  });
});
