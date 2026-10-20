import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en-US.json";
import zh from "../../i18n/locales/zh-CN.json";
import { OrgLoginDialog } from "./OrgLoginDialog";
import type { OrgAuth } from "../../store/org";
import {
  loginErrorKey,
  loginFormValid,
  loginRequest,
  newLoginForm,
  reauthorizeForm,
  type LoginForm,
} from "./loginForm";

const jwt: LoginForm = {
  ...newLoginForm(),
  authMethod: "jwt",
  username: " dev@example.com ",
  clientId: " client ",
  keyFile: " /keys/server key.pem ",
  consumerSecret: "leftover-browser-secret",
};

function render(
  form: LoginForm,
  language = "en-US",
  reauthorizing = false,
  busy = false,
) {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    initAsync: false,
    resources: { "en-US": { translation: en }, "zh-CN": { translation: zh } },
  });
  const noop = () => {};
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OrgLoginDialog
        form={form}
        reauthorizing={reauthorizing}
        busy={busy}
        cancelling={false}
        loadingProfile={false}
        error={null}
        onChange={noop}
        onSubmit={noop}
        onCancel={noop}
        onPickKey={noop}
        onPrepareKey={noop}
      />
    </I18nextProvider>,
  );
}

describe("org authorization", () => {
  it("keeps browser-only secrets and callback port out of JWT requests", () => {
    expect(loginRequest(jwt)).toEqual({
      authMethod: "jwt",
      setDefault: true,
      alias: undefined,
      username: "dev@example.com",
      clientId: "client",
      jwtKeyFile: "/keys/server key.pem",
      instanceUrl: "https://login.salesforce.com",
    });
    const web = loginRequest({
      ...jwt,
      authMethod: "web",
      domain: "sandbox",
      instanceUrl: "https://test.salesforce.com",
    });
    expect(web).not.toHaveProperty("jwtKeyFile");
    expect(web).toMatchObject({ authMethod: "web", consumerSecret: undefined });
  });

  it("defaults to selecting the default-org checkbox and omits it on reauthorization", () => {
    expect(newLoginForm().setDefault).toBe(true);
    for (const authMethod of ["web", "jwt"] as const) {
      const form = { ...jwt, authMethod };
      expect(render(form)).toMatch(/id="org-login-set-default"[^>]*checked/);
      expect(render({ ...form, setDefault: false })).not.toMatch(/id="org-login-set-default"[^>]*checked/);
      expect(render(form, "en-US", true)).not.toContain('id="org-login-set-default"');
      expect(loginRequest(form).setDefault).toBe(true);
      expect(loginRequest({ ...form, setDefault: false }).setDefault).toBe(false);
      expect(loginRequest(form, true).setDefault).toBe(false);
      expect(render(form)).toContain(">Sign in</button>");
    }
  });

  it("opens reauthorization with the actual method and only restores matching JWT settings", () => {
    const org: OrgAuth = { id: "dev@example.com", alias: "Dev", instance_url: "https://example.my.sfcrmproducts.cn",
      org_type: "production", auth_method: "jwt", is_default: true, expires_at: null,
      connection_status: "Connected", last_used: null, linked_project_path: null };
    const profile = { username: org.id, clientId: "client", jwtKeyFile: "/keys/private.pem", instanceUrl: org.instance_url };
    const form = reauthorizeForm(org, profile);
    expect(form).toMatchObject({ authMethod: "jwt", username: org.id, clientId: "client", keyFile: "/keys/private.pem", domain: "alibaba", setDefault: false });
    expect(reauthorizeForm({ ...org, auth_method: "web" }, profile)).toMatchObject({ authMethod: "web", keyFile: "", clientId: "" });
    expect(reauthorizeForm(org).authMethod).toBe("jwt");
    // Switching either way keeps the original username and never sets default.
    for (const authMethod of ["web", "jwt"] as const) {
      const switched = { ...form, authMethod, consumerSecret: "secret" };
      expect(loginRequest(switched, true)).toMatchObject({ authMethod, setDefault: false });
      const html = render(switched, "en-US", true);
      expect(html).toContain('<option value="web"');
      expect(html).toContain('<option value="jwt"');
      expect(html).toContain(">Reauthorize</button>");
    }
  });

  it("requires all JWT inputs and a valid HTTPS login URL", () => {
    expect(loginFormValid(jwt)).toBe(true);
    for (const field of [
      "username",
      "clientId",
      "keyFile",
      "instanceUrl",
    ] as const) {
      expect(loginFormValid({ ...jwt, [field]: " " })).toBe(false);
    }
    for (const instanceUrl of [
      "http://login.salesforce.com",
      "https://example.com/path",
      "https://example.com?access_token=secret",
      "https://user:secret@example.com",
    ]) {
      expect(loginFormValid({ ...jwt, instanceUrl })).toBe(false);
    }
    expect(
      loginFormValid({
        ...jwt,
        domain: "custom",
        instanceUrl: "https://acme--dev.sandbox.my.salesforce.com/",
      }),
    ).toBe(true);
  });

  it("allows Alibaba JWT with My Domain and no browser secret or callback port", () => {
    for (const instanceUrl of [
      "https://acme.my.sfcrmproducts.cn",
      "https://acme--dev.sandbox.my.sfcrmproducts.cn",
    ]) {
      const form: LoginForm = {
        ...jwt,
        domain: "alibaba",
        instanceUrl,
        consumerSecret: "",
        port: "",
      };
      expect(loginFormValid(form)).toBe(true);
      expect(loginRequest(form)).toMatchObject({
        authMethod: "jwt",
        instanceUrl,
      });
      expect(loginRequest(form)).not.toHaveProperty("consumerSecret");
      expect(loginRequest(form)).not.toHaveProperty("port");
      const html = render(form);
      expect(html).not.toMatch(/<option value="jwt"[^>]*disabled/);
      expect(html).not.toContain('id="org-login-secret"');
      expect(html).not.toContain('id="org-login-port"');
      expect(html).toContain("Setup → My Domain");
    }
  });

  it("preserves Alibaba browser credentials and validates its callback port", () => {
    const alibaba: LoginForm = {
      ...newLoginForm(),
      domain: "alibaba",
      instanceUrl: "https://acme.my.sfcrmproducts.cn",
      clientId: "client",
      consumerSecret: "secret",
      port: "1718",
    };
    expect(loginFormValid(alibaba)).toBe(true);
    expect(loginRequest(alibaba)).toMatchObject({
      authMethod: "web",
      consumerKey: "client",
      consumerSecret: "secret",
      port: 1718,
    });
    expect(loginFormValid({ ...alibaba, consumerSecret: "" })).toBe(false);
    for (const port of ["", "0", "65536", "1717.5"])
      expect(loginFormValid({ ...alibaba, port })).toBe(false);
    expect(loginFormValid(newLoginForm())).toBe(true);
  });

  it("renders JWT controls without browser secrets or callback ports in both languages", () => {
    for (const language of ["en-US", "zh-CN"]) {
      const html = render(jwt, language);
      expect(html).toContain('id="org-login-key"');
      expect(html).toContain('id="org-login-username"');
      expect(html).not.toContain('id="org-login-secret"');
      expect(html).not.toContain('id="org-login-port"');
      expect(html).not.toContain("leftover-browser-secret");
      expect(html).not.toContain("orgManager.jwt");
    }
    expect(render(jwt, "zh-CN")).toContain("请保留此私钥文件");
  });

  it("locks the username during reauthorization and disables inputs while authorizing", () => {
    expect(render(jwt, "en-US", true)).toMatch(
      /id="org-login-username"[^>]*readonly/,
    );
    expect(render(jwt, "en-US", false, true)).toContain(
      'class="org-login-fields" disabled=""',
    );
    expect(render(jwt, "en-US", false, true)).toContain("Authorizing with JWT");
    expect(render(newLoginForm())).not.toContain('id="org-login-key"');
  });

  it("provides actionable translated messages for every backend error", () => {
    for (const code of [
      "LOGIN_BUSY",
      "LOGIN_CANCELLED",
      "LOGIN_USERNAME_MISMATCH",
      "LOGIN_DEFAULT_READ_FAILED",
      "LOGIN_DEFAULT_RESTORE_FAILED",
      "JWT_INVALID_CREDENTIALS",
      "JWT_INVALID_URL",
      "JWT_KEY_UNREADABLE",
      "JWT_KEY_INVALID",
      "JWT_CLI_MISSING",
      "JWT_LOGIN_TIMEOUT",
      "JWT_LOGIN_FAILED",
      "JWT_NETWORK_FAILED",
      "JWT_USER_NOT_APPROVED",
      "JWT_SCOPE_OR_PREAUTH_REQUIRED",
      "JWT_INVALID_AUDIENCE",
      "JWT_INVALID_SIGNATURE",
      "JWT_INVALID_CLIENT",
    ]) {
      const key = loginErrorKey(code)!;
      expect(key).toBeDefined();
      for (const locale of [en, zh]) {
        const value = key
          .split(".")
          .reduce<unknown>(
            (object, part) => (object as Record<string, unknown>)[part],
            locale,
          );
        expect(typeof value).toBe("string");
      }
    }
    expect(loginErrorKey("unknown CLI error")).toBeUndefined();
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("Tauri authorization bridge", () => {
  it("sends the same typed request for login and reauthorization with an explicit target username", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { tauriApi } = await import("../../lib/tauri");
    const request = loginRequest(jwt);
    await tauriApi.loginOrg(request);
    expect(invoke).toHaveBeenLastCalledWith("login_org", { request });
    await tauriApi.reauthorizeOrg("dev@example.com", request);
    expect(invoke).toHaveBeenLastCalledWith("reauthorize_org", {
      username: "dev@example.com",
      request,
    });
  });
});
