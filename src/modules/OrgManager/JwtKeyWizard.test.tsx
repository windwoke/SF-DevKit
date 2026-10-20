import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en-US.json";
import zh from "../../i18n/locales/zh-CN.json";
import { JwtSetupGuide } from "./JwtSetupGuide";
import { JwtKeyWizard } from "./JwtKeyWizard";
import { loginErrorKey } from "./loginForm";

function render(content: React.ReactNode, language = "zh-CN") {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    initAsync: false,
    resources: { "en-US": { translation: en }, "zh-CN": { translation: zh } },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>{content}</I18nextProvider>,
  );
}

describe("JWT setup guidance", () => {
  it("keeps local generation steps separate from Salesforce keystore export", () => {
    const html = render(<JwtSetupGuide stage="generate" />);
    expect(html).toContain("server.key");
    expect(html).toContain("server.crt");
    expect(html).not.toContain("Export to Keystore");
    expect(html).not.toContain("密钥库导出密码");
    expect(html).not.toContain("Consumer Key and Secret");
  });

  it("distinguishes Download Certificate from Export to Keystore before import", () => {
    const html = render(<JwtSetupGuide stage="export" />);
    expect(html).toContain("Exportable Private Key");
    expect(html).toContain("Export to Keystore");
    expect(html).toContain("Download Certificate");
    expect(html).toContain("不能转换或恢复私钥");
    expect(html).not.toContain("Consumer Key and Secret");
    expect(html).not.toContain("生成文件");
  });

  it("explains app certificate upload and Client ID only at the configuration stage", () => {
    const html = render(<JwtSetupGuide stage="configure" />);
    expect(html).toContain("Enable JWT Bearer Flow");
    expect(html).toContain("server.crt");
    expect(html).toContain("Client ID 就是 Consumer Key");
    expect(html).toContain("JWT 登录不需要 Consumer Secret");
    expect(html).not.toContain("密钥库导出密码");
  });

  it("provides Alibaba-specific configuration guidance in both languages", () => {
    for (const language of ["en-US", "zh-CN"]) {
      const html = render(
        <JwtSetupGuide stage="configure" alibaba />,
        language,
      );
      expect(html).toContain("Use digital signatures");
      expect(html).toContain("My Domain");
      expect(html).not.toContain("orgManager.keySetup");
    }
    expect(render(<JwtSetupGuide stage="configure" alibaba />)).toContain(
      "JWT 不需要 Consumer Secret",
    );
  });

  it("shows only the selected workflow's initial controls", () => {
    const noop = () => {};
    const generate = render(
      <JwtKeyWizard route="generate" onClose={noop} onComplete={noop} />,
    );
    expect(generate).toContain('id="jwt-cert-name"');
    expect(generate).not.toContain('id="jwt-store-password"');
    expect(generate).not.toContain("Export to Keystore");
    const importing = render(
      <JwtKeyWizard route="import" onClose={noop} onComplete={noop} />,
    );
    expect(importing).toContain("Export to Keystore");
    expect(importing).not.toContain('id="jwt-cert-name"');
    expect(importing).not.toContain('id="jwt-store-password"');
  });

  it("has complete help and actionable error messages in both languages", () => {
    for (const language of ["en-US", "zh-CN"]) {
      for (const stage of ["generate", "export", "configure"] as const) {
        const html = render(<JwtSetupGuide stage={stage} />, language);
        expect(html).not.toContain("orgManager.keySetup");
        expect(html).toContain("<ol>");
      }
    }
    for (const code of [
      "JWT_OPENSSL_MISSING",
      "JWT_KEYTOOL_MISSING",
      "JWT_CERT_TOOL_TIMEOUT",
      "JWT_CERT_STORAGE_FAILED",
      "JWT_CERT_INVALID_OPTIONS",
      "JWT_CERT_GENERATE_FAILED",
      "JWT_KEYSTORE_PUBLIC_ONLY",
      "JWT_KEYSTORE_INVALID",
      "JWT_KEYSTORE_UNREADABLE",
      "JWT_KEYSTORE_READ_FAILED",
      "JWT_KEYSTORE_NO_PRIVATE_KEY",
      "JWT_KEYSTORE_ALIAS_INVALID",
      "JWT_CERT_IMPORT_FAILED",
      "JWT_CERT_RSA_REQUIRED",
      "JWT_CERT_EXPIRED",
      "JWT_CERT_KEY_MISMATCH",
      "JWT_CERT_EXPORT_FAILED",
      "JWT_CERT_EXPORT_PATH",
    ]) {
      const key = loginErrorKey(code);
      expect(key).toBeDefined();
      for (const locale of [en, zh]) {
        const text = key!
          .split(".")
          .reduce<unknown>(
            (value, part) => (value as Record<string, unknown>)[part],
            locale,
          );
        expect(typeof text).toBe("string");
      }
    }
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("certificate commands", () => {
  it("preserves password whitespace and keeps source selection separate from org alias", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { tauriApi } = await import("../../lib/tauri");
    await tauriApi.importJwtKeystore({
      path: "/keys/source.jks",
      password: " password with spaces ",
      alias: "certificate-entry",
      keyPassword: " separate ",
      directory: "/output",
    });
    expect(invoke).toHaveBeenLastCalledWith("import_jwt_keystore", {
      path: "/keys/source.jks",
      password: " password with spaces ",
      alias: "certificate-entry",
      keyPassword: " separate ",
      directory: "/output",
    });
    await tauriApi.generateJwtCertificate({
      commonName: "SF-DevKit",
      days: 365,
    });
    expect(invoke).toHaveBeenLastCalledWith("generate_jwt_certificate", {
      commonName: "SF-DevKit",
      days: 365,
      directory: null,
    });
  });
});
