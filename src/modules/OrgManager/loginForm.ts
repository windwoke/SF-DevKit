import type { AuthMethod, LoginDomain, OrgLoginRequest, OrgLoginProfile } from "../../lib/tauri";
import type { OrgAuth } from "../../store/org";
import { isAlibabaInstance } from "../../lib/isAlibabaInstance";

export interface LoginForm {
  authMethod: AuthMethod;
  setDefault: boolean;
  alias: string;
  domain: LoginDomain;
  username: string;
  clientId: string;
  keyFile: string;
  instanceUrl: string;
  consumerSecret: string;
  port: string;
}

export function newLoginForm(): LoginForm {
  return {
    authMethod: "web",
    setDefault: true,
    alias: "",
    domain: "production",
    username: "",
    clientId: "",
    keyFile: "",
    instanceUrl: "https://login.salesforce.com",
    consumerSecret: "",
    port: "1717",
  };
}

export function reauthorizeForm(org: OrgAuth, profile?: OrgLoginProfile | null): LoginForm {
  const form: LoginForm = {
    ...newLoginForm(),
    authMethod: org.auth_method === "jwt" ? "jwt" : "web",
    setDefault: false,
    alias: org.alias ?? "",
    username: org.id,
    domain: isAlibabaInstance(org.instance_url) ? "alibaba" : org.org_type === "sandbox" ? "sandbox" : "production",
    instanceUrl: org.instance_url,
  };
  if (form.authMethod === "jwt" && profile) {
    form.clientId = profile.clientId;
    form.keyFile = profile.jwtKeyFile;
    form.instanceUrl = profile.instanceUrl;
  }
  return form;
}

export function authMethodKey(method: OrgAuth["auth_method"]): string {
  return `orgManager.authMethods.${["web", "jwt", "token"].includes(method) ? method : "unknown"}`;
}

export function loginFormValid(form: LoginForm): boolean {
  const customUrl =
    form.authMethod === "jwt" ||
    form.domain === "custom" ||
    form.domain === "alibaba";
  if (customUrl) {
    try {
      const url = new URL(form.instanceUrl.trim());
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        return false;
    } catch {
      return false;
    }
  }
  if (form.authMethod === "jwt") {
    return Boolean(
      form.username.trim() && form.clientId.trim() && form.keyFile.trim(),
    );
  }
  if (form.domain === "alibaba") {
    const port = Number(form.port);
    return (
      Boolean(form.clientId.trim() && form.consumerSecret.trim()) &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535
    );
  }
  return true;
}

export function loginRequest(form: LoginForm, reauthorizing = false): OrgLoginRequest {
  const alias = form.alias.trim() || undefined;
  const setDefault = !reauthorizing && form.setDefault;
  if (form.authMethod === "jwt") {
    return {
      authMethod: "jwt",
      setDefault,
      alias,
      username: form.username.trim(),
      clientId: form.clientId.trim(),
      jwtKeyFile: form.keyFile.trim(),
      instanceUrl: form.instanceUrl.trim(),
    };
  }
  return {
    authMethod: "web",
    setDefault,
    alias,
    loginDomain: form.domain,
    instanceUrl: form.instanceUrl.trim() || undefined,
    consumerKey: form.domain === "alibaba" ? form.clientId.trim() : undefined,
    consumerSecret:
      form.domain === "alibaba" ? form.consumerSecret.trim() : undefined,
    port: form.domain === "alibaba" ? Number(form.port) : undefined,
  };
}

const loginErrorKeys: Record<string, string> = {
  LOGIN_NOT_COMPLETED: "notice.loginNotCompleted",
  LOGIN_BUSY: "loginErrors.busy",
  LOGIN_CANCELLED: "loginErrors.cancelled",
  LOGIN_USERNAME_MISMATCH: "loginErrors.usernameMismatch",
  LOGIN_DEFAULT_READ_FAILED: "loginErrors.defaultRead",
  LOGIN_DEFAULT_RESTORE_FAILED: "loginErrors.defaultRestore",
  JWT_INVALID_CREDENTIALS: "loginErrors.credentials",
  JWT_INVALID_URL: "loginErrors.url",
  JWT_KEY_UNREADABLE: "loginErrors.keyUnreadable",
  JWT_KEY_INVALID: "loginErrors.keyInvalid",
  JWT_CLI_MISSING: "loginErrors.cliMissing",
  JWT_LOGIN_TIMEOUT: "loginErrors.timeout",
  JWT_LOGIN_FAILED: "loginErrors.failed",
  JWT_NETWORK_FAILED: "loginErrors.network",
  JWT_USER_NOT_APPROVED: "loginErrors.notApproved",
  JWT_SCOPE_OR_PREAUTH_REQUIRED: "loginErrors.scopeOrPreauth",
  JWT_INVALID_AUDIENCE: "loginErrors.audience",
  JWT_INVALID_SIGNATURE: "loginErrors.signature",
  JWT_INVALID_CLIENT: "loginErrors.client",
  JWT_OPENSSL_MISSING: "keySetup.errors.opensslMissing",
  JWT_KEYTOOL_MISSING: "keySetup.errors.keytoolMissing",
  JWT_CERT_TOOL_TIMEOUT: "keySetup.errors.timeout",
  JWT_CERT_STORAGE_FAILED: "keySetup.errors.storage",
  JWT_CERT_INVALID_OPTIONS: "keySetup.errors.options",
  JWT_CERT_GENERATE_FAILED: "keySetup.errors.generate",
  JWT_KEYSTORE_PUBLIC_ONLY: "keySetup.errors.publicOnly",
  JWT_KEYSTORE_INVALID: "keySetup.errors.keystoreInvalid",
  JWT_KEYSTORE_UNREADABLE: "keySetup.errors.keystoreUnreadable",
  JWT_KEYSTORE_READ_FAILED: "keySetup.errors.read",
  JWT_KEYSTORE_NO_PRIVATE_KEY: "keySetup.errors.noPrivateKey",
  JWT_KEYSTORE_ALIAS_INVALID: "keySetup.errors.alias",
  JWT_CERT_IMPORT_FAILED: "keySetup.errors.import",
  JWT_CERT_RSA_REQUIRED: "keySetup.errors.rsa",
  JWT_CERT_EXPIRED: "keySetup.errors.expired",
  JWT_CERT_KEY_MISMATCH: "keySetup.errors.mismatch",
  JWT_CERT_EXPORT_FAILED: "keySetup.errors.export",
  JWT_CERT_EXPORT_PATH: "keySetup.errors.exportPath",
};

export function loginErrorKey(error: string): string | undefined {
  const key = loginErrorKeys[error];
  return key ? `orgManager.${key}` : undefined;
}
