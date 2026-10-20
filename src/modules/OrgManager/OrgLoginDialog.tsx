import { useTranslation } from "react-i18next";
import type { AuthMethod, LoginDomain } from "../../lib/tauri";
import { loginFormValid, type LoginForm } from "./loginForm";
import type { JwtKeyRoute } from "./JwtSetupGuide";

interface Props {
  form: LoginForm;
  reauthorizing: boolean;
  busy: boolean;
  cancelling: boolean;
  loadingProfile: boolean;
  error: string | null;
  onChange: (form: LoginForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPickKey: () => void;
  onPrepareKey: (route: JwtKeyRoute) => void;
}

export function OrgLoginDialog({
  form,
  reauthorizing,
  busy,
  cancelling,
  loadingProfile,
  error,
  onChange,
  onSubmit,
  onCancel,
  onPickKey,
  onPrepareKey,
}: Props) {
  const { t } = useTranslation();
  const jwt = form.authMethod === "jwt";
  const update = (patch: Partial<LoginForm>) => onChange({ ...form, ...patch });
  const showUrl =
    jwt ||
    form.domain === "custom" ||
    form.domain === "alibaba" ||
    reauthorizing;
  return (
    <div className="org-login-modal-backdrop">
      <form
        className="org-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-login-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !loadingProfile && loginFormValid(form)) onSubmit();
        }}
      >
        <h3 className="org-login-title" id="org-login-title">
          {t(
            reauthorizing
              ? "orgManager.reauthorizeTitle"
              : "orgManager.modalTitle",
          )}
        </h3>
        <fieldset
          className="org-login-fields"
          disabled={busy || loadingProfile}
        >
          <label className="org-form-label" htmlFor="org-auth-method">
            {t("orgManager.authMethodLabel")}
          </label>
          <select
            id="org-auth-method"
            className="org-form-select"
            value={form.authMethod}
            onChange={(e) =>
              update({ authMethod: e.target.value as AuthMethod })
            }
          >
            <option value="web">{t("orgManager.authWeb")}</option>
            <option value="jwt">{t("orgManager.authJwt")}</option>
          </select>
          <label className="org-form-label" htmlFor="org-login-alias">
            {t("orgManager.aliasLabel")}
          </label>
          <input
            id="org-login-alias"
            className="org-form-input"
            value={form.alias}
            onChange={(e) => update({ alias: e.target.value })}
            placeholder={t("orgManager.aliasPlaceholder")}
          />
          <label className="org-form-label" htmlFor="org-login-domain">
            {t("orgManager.domainLabel")}
          </label>
          <select
            id="org-login-domain"
            className="org-form-select"
            value={form.domain}
            disabled={reauthorizing}
            onChange={(e) => {
              const domain = e.target.value as LoginDomain;
              update({
                domain,
                instanceUrl:
                  domain === "production"
                    ? "https://login.salesforce.com"
                    : domain === "sandbox"
                      ? "https://test.salesforce.com"
                      : "",
              });
            }}
          >
            <option value="production">
              {t("orgManager.domainProduction")}
            </option>
            <option value="sandbox">{t("orgManager.domainSandbox")}</option>
            <option value="custom">{t("orgManager.domainCustom")}</option>
            <option value="alibaba">{t("orgManager.domainAlibaba")}</option>
          </select>
          {showUrl && (
            <>
              <label className="org-form-label" htmlFor="org-login-url">
                {t("orgManager.instanceUrlLabel")}
              </label>
              <input
                id="org-login-url"
                type="url"
                className="org-form-input"
                required
                value={form.instanceUrl}
                onChange={(e) => update({ instanceUrl: e.target.value })}
                placeholder={t(
                  form.domain !== "alibaba"
                    ? "orgManager.jwtUrlPlaceholder"
                    : "orgManager.instanceUrlPlaceholder",
                )}
                readOnly={reauthorizing && !jwt}
              />
            </>
          )}
          {jwt && (
            <>
              <p className="org-login-hint">{t("orgManager.jwtSetupHint")}</p>
              <label className="org-form-label" htmlFor="org-login-username">
                {t("orgManager.usernameLabel")}
              </label>
              <input
                id="org-login-username"
                className="org-form-input"
                required
                value={form.username}
                readOnly={reauthorizing}
                onChange={(e) => update({ username: e.target.value })}
                placeholder={t("orgManager.usernamePlaceholder")}
                autoComplete="off"
              />
            </>
          )}
          {(jwt || form.domain === "alibaba") && (
            <>
              <label className="org-form-label" htmlFor="org-login-client">
                {t(
                  jwt
                    ? "orgManager.clientIdLabel"
                    : "orgManager.consumerKeyLabel",
                )}
              </label>
              <input
                id="org-login-client"
                className="org-form-input"
                required
                value={form.clientId}
                onChange={(e) => update({ clientId: e.target.value })}
                placeholder={t(
                  jwt
                    ? "orgManager.clientIdPlaceholder"
                    : "orgManager.consumerKeyPlaceholder",
                )}
                autoComplete="off"
              />
            </>
          )}
          {jwt && (
            <>
              <label className="org-form-label" htmlFor="org-login-key">
                {t("orgManager.jwtKeyLabel")}
              </label>
              <div className="org-login-key-row">
                <input
                  id="org-login-key"
                  className="org-form-input"
                  required
                  value={form.keyFile}
                  onChange={(e) => update({ keyFile: e.target.value })}
                  placeholder={t("orgManager.jwtKeyPlaceholder")}
                  aria-describedby="org-key-hint"
                />
                <button type="button" onClick={onPickKey}>
                  {t("orgManager.pickJwtKey")}
                </button>
              </div>
              <p id="org-key-hint" className="org-login-hint">
                {t("orgManager.jwtKeyHint")}
              </p>
              <div
                className="jwt-prepare-actions"
                aria-label={t("orgManager.keySetup.prepareLabel")}
              >
                <button type="button" onClick={() => onPrepareKey("generate")}>
                  {t("orgManager.keySetup.generateEntry")}
                </button>
                <button type="button" onClick={() => onPrepareKey("import")}>
                  {t("orgManager.keySetup.importEntry")}
                </button>
              </div>
            </>
          )}
          {!jwt && form.domain === "alibaba" && (
            <>
              <label className="org-form-label" htmlFor="org-login-secret">
                {t("orgManager.consumerSecretLabel")}
              </label>
              <input
                id="org-login-secret"
                type="password"
                className="org-form-input"
                required
                value={form.consumerSecret}
                onChange={(e) => update({ consumerSecret: e.target.value })}
                placeholder={t("orgManager.consumerSecretPlaceholder")}
                autoComplete="off"
              />
              <label className="org-form-label" htmlFor="org-login-port">
                {t("orgManager.portLabel")}
              </label>
              <input
                id="org-login-port"
                type="number"
                min="1"
                max="65535"
                required
                className="org-form-input"
                value={form.port}
                onChange={(e) => update({ port: e.target.value })}
                placeholder={t("orgManager.portPlaceholder")}
              />
            </>
          )}
          {jwt && form.domain === "alibaba" && (
            <p className="org-login-hint">{t("orgManager.jwtAlibabaHint")}</p>
          )}
          {!reauthorizing && (
            <label className="org-login-default-option" htmlFor="org-login-set-default">
              <input
                id="org-login-set-default"
                type="checkbox"
                checked={form.setDefault}
                onChange={(e) => update({ setDefault: e.target.checked })}
              />
              {t("orgManager.setDefaultOnLogin")}
            </label>
          )}
        </fieldset>
        {error && (
          <div className="org-login-error" role="alert">
            {error}
          </div>
        )}
        <div className="org-login-modal-actions">
          <button type="button" disabled={cancelling} onClick={onCancel}>
            {t(cancelling ? "orgManager.cancelling" : "orgManager.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || loadingProfile || !loginFormValid(form)}
          >
            {t(
              loadingProfile
                ? "orgManager.loadingLoginProfile"
                : busy
                  ? jwt
                    ? "orgManager.loginWaitingJwt"
                    : "orgManager.loginWaitingBrowser"
                  : reauthorizing
                    ? "orgManager.reauthorize"
                    : "orgManager.login",
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
