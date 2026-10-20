import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  tauriApi,
  type JwtCertificateTools,
  type JwtKeyMaterial,
} from "../../lib/tauri";
import { loginErrorKey } from "./loginForm";
import { JwtSetupGuide, jwtHelpLinks, type JwtKeyRoute } from "./JwtSetupGuide";

interface Props {
  route: JwtKeyRoute;
  alibaba?: boolean;
  onClose: () => void;
  onComplete: (material: JwtKeyMaterial) => void;
}

export function JwtKeyWizard({
  route,
  alibaba = false,
  onClose,
  onComplete,
}: Props) {
  const { t } = useTranslation();
  const prefix = "orgManager.keySetup.";
  const [step, setStep] = useState(0);
  const [tools, setTools] = useState<JwtCertificateTools | null>(null);
  const [checkingTools, setCheckingTools] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState("");
  const [commonName, setCommonName] = useState("SF-DevKit");
  const [days, setDays] = useState(365);
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [alias, setAlias] = useState("");
  const [material, setMaterial] = useState<JwtKeyMaterial | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const message = (value: unknown) => {
    const raw = value instanceof Error ? value.message : String(value);
    const key = loginErrorKey(raw);
    return key ? t(key) : t(`${prefix}errors.unexpected`);
  };
  useEffect(() => {
    let active = true;
    tauriApi
      .getJwtCertificateTools()
      .then((value) => {
        if (active) setTools(value);
      })
      .catch((value) => {
        if (active) setError(message(value));
      })
      .finally(() => {
        if (active) setCheckingTools(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const action = async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (value) {
      setError(message(value));
    } finally {
      setBusy(false);
    }
  };
  const openHelp = (url: string) =>
    void action(async () => {
      await tauriApi.openExternal({ kind: "url", target: url });
    });
  const chooseDirectory = () =>
    void action(async () => {
      const selected = await tauriApi.pickProjectDirectory();
      if (selected) setDirectory(selected);
    });
  const chooseKeystore = () =>
    void action(async () => {
      const selected = await tauriApi.pickJwtKeystore();
      if (selected) {
        setPath(selected);
        setEntries([]);
        setAlias("");
        setPassword("");
        setKeyPassword("");
      }
    });
  const generate = () =>
    void action(async () => {
      const value = await tauriApi.generateJwtCertificate({
        commonName,
        days,
        directory,
      });
      setMaterial(value);
      setStep(1);
    });
  const inspect = () =>
    void action(async () => {
      setEntries([]);
      setAlias("");
      try {
        const value = await tauriApi.listJwtKeystoreEntries(path, password);
        setEntries(value);
        setAlias(value[0] ?? "");
      } catch (value) {
        setPassword("");
        setKeyPassword("");
        throw value;
      }
    });
  const extract = () =>
    void action(async () => {
      const value = await tauriApi.importJwtKeystore({
        path,
        password,
        alias,
        keyPassword,
        directory,
      });
      setPassword("");
      setKeyPassword("");
      setMaterial(value);
      setStep(2);
    });
  const exportCertificate = () =>
    void action(async () => {
      if (material) {
        const saved = await tauriApi.exportJwtPublicCertificate(
          material.certificateFile,
        );
        if (saved) setExportedPath(saved);
      }
    });

  const stepLabels = (
    route === "generate"
      ? ["generateStep", "configureStep", "loginStep"]
      : ["exportStep", "extractStep", "verifyStep"]
  ).map((key) => t(`${prefix}${key}`));
  const toolsReady = Boolean(
    tools?.openssl && (route === "generate" || tools.keytool),
  );
  const validName =
    Boolean(commonName.trim()) &&
    commonName.trim().length <= 64 &&
    !/[\x00-\x1f\x7f/\\=+]/.test(commonName);

  const storage = (
    <div className="jwt-storage">
      <span className="org-form-label">{t(`${prefix}storageLabel`)}</span>
      <div className="org-login-key-row">
        <code className="jwt-path">
          {directory || tools?.storageDirectory || t(`${prefix}managedStorage`)}
        </code>
        <button type="button" onClick={chooseDirectory} disabled={busy}>
          {t(`${prefix}changeFolder`)}
        </button>
      </div>
      <p className="org-login-hint">{t(`${prefix}storageHint`)}</p>
    </div>
  );

  const dependencies = (
    <>
      {checkingTools && (
        <p className="org-login-hint" role="status">
          {t(`${prefix}checkingTools`)}
        </p>
      )}
      {!checkingTools && !toolsReady && (
        <div className="jwt-dependencies" role="status">
          <p>{t(`${prefix}dependenciesIntro`)}</p>
          {!tools?.openssl && (
            <p>
              {t(`${prefix}opensslHelp`)}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => openHelp(jwtHelpLinks.openssl)}
              >
                {t(`${prefix}opensslLink`)}
              </button>
            </p>
          )}
          {route === "import" && !tools?.keytool && (
            <p>
              {t(`${prefix}javaHelp`)}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => openHelp(jwtHelpLinks.java)}
              >
                {t(`${prefix}javaLink`)}
              </button>
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setTools(await tauriApi.getJwtCertificateTools()),
              )
            }
          >
            {t(`${prefix}recheckTools`)}
          </button>
        </div>
      )}
    </>
  );

  const files = material && (
    <div className="jwt-material">
      <div className="jwt-file-card jwt-file-certificate">
        <strong>{t(`${prefix}publicCertificateTitle`)}</strong>
        <code className="jwt-path">{material.certificateFile}</code>
        <p>{t(`${prefix}publicCertificateHint`)}</p>
        <button type="button" disabled={busy} onClick={exportCertificate}>
          {t(`${prefix}exportCertificate`)}
        </button>
        {exportedPath && (
          <p className="jwt-export-success" role="status">
            {t(`${prefix}exported`, { path: exportedPath })}
          </p>
        )}
      </div>
      <div className="jwt-file-card">
        <strong>{t(`${prefix}privateKeyTitle`)}</strong>
        <code className="jwt-path">{material.keyFile}</code>
        <p>{t(`${prefix}privateKeyHint`)}</p>
      </div>
      <details className="jwt-certificate-details">
        <summary>{t(`${prefix}certificateDetails`)}</summary>
        <dl>
          <dt>{t(`${prefix}subjectLabel`)}</dt>
          <dd>{material.subject}</dd>
          <dt>{t(`${prefix}expiresLabel`)}</dt>
          <dd>{material.expiresAt}</dd>
          <dt>SHA-256</dt>
          <dd className="jwt-fingerprint">{material.fingerprintSha256}</dd>
        </dl>
      </details>
    </div>
  );

  return (
    <div className="org-login-modal-backdrop">
      <section
        className="org-login-modal jwt-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jwt-wizard-title"
        aria-busy={busy}
      >
        <div className="jwt-wizard-heading">
          <span className="jwt-route-label">{t(`${prefix}routeLabel`)}</span>
          <h3 className="org-login-title" id="jwt-wizard-title">
            {t(`${prefix}${route}Title`)}
          </h3>
        </div>
        <ol className="jwt-stepper" aria-label={t(`${prefix}progressLabel`)}>
          {stepLabels.map((label, index) => (
            <li
              key={label}
              className={
                index === step
                  ? "is-current"
                  : index < step
                    ? "is-complete"
                    : ""
              }
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <h4 className="jwt-step-title">{stepLabels[step]}</h4>

        {route === "generate" && step === 0 && (
          <>
            <JwtSetupGuide stage="generate" />
            {dependencies}
            <label className="org-form-label" htmlFor="jwt-cert-name">
              {t(`${prefix}commonNameLabel`)}
            </label>
            <input
              className="org-form-input"
              id="jwt-cert-name"
              value={commonName}
              onChange={(event) => setCommonName(event.target.value)}
              disabled={busy}
              maxLength={64}
            />
            <label className="org-form-label" htmlFor="jwt-cert-days">
              {t(`${prefix}validityLabel`)}
            </label>
            <select
              className="org-form-select"
              id="jwt-cert-days"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              disabled={busy}
            >
              {[365, 730, 1095].map((value) => (
                <option key={value} value={value}>
                  {t(`${prefix}validityDays`, { count: value })}
                </option>
              ))}
            </select>
            {storage}
          </>
        )}
        {route === "import" && step === 0 && (
          <>
            <JwtSetupGuide stage="export" />
            <button
              type="button"
              className="jwt-help-link"
              disabled={busy}
              onClick={() => openHelp(jwtHelpLinks.keystore)}
            >
              {t(`${prefix}salesforceExportHelp`)}
            </button>
          </>
        )}
        {route === "import" && step === 1 && (
          <>
            <p className="jwt-guide-intro">{t(`${prefix}extractIntro`)}</p>
            {dependencies}
            <label className="org-form-label" htmlFor="jwt-keystore-path">
              {t(`${prefix}keystoreLabel`)}
            </label>
            <div className="org-login-key-row">
              <input
                className="org-form-input"
                id="jwt-keystore-path"
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setEntries([]);
                  setAlias("");
                }}
                disabled={busy}
                placeholder={t(`${prefix}keystorePlaceholder`)}
              />
              <button type="button" onClick={chooseKeystore} disabled={busy}>
                {t(`${prefix}chooseKeystore`)}
              </button>
            </div>
            <label className="org-form-label" htmlFor="jwt-store-password">
              {t(`${prefix}storePasswordLabel`)}
            </label>
            <input
              className="org-form-input"
              type="password"
              id="jwt-store-password"
              value={password}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => {
                setPassword(event.target.value);
                setEntries([]);
                setAlias("");
              }}
            />
            <p className="org-login-hint">{t(`${prefix}passwordHint`)}</p>
            <button
              type="button"
              disabled={
                busy ||
                checkingTools ||
                !toolsReady ||
                !path.trim() ||
                !password
              }
              onClick={inspect}
            >
              {t(`${prefix}readEntries`)}
            </button>
            {entries.length > 0 && (
              <>
                <label className="org-form-label" htmlFor="jwt-keystore-alias">
                  {t(`${prefix}entryLabel`)}
                </label>
                <select
                  className="org-form-select"
                  id="jwt-keystore-alias"
                  disabled={busy}
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                >
                  {entries.map((entry) => (
                    <option key={entry}>{entry}</option>
                  ))}
                </select>
                <p className="org-login-hint">{t(`${prefix}entryHint`)}</p>
                <details className="jwt-key-password">
                  <summary>{t(`${prefix}separatePasswordTitle`)}</summary>
                  <label className="org-form-label" htmlFor="jwt-key-password">
                    {t(`${prefix}keyPasswordLabel`)}
                  </label>
                  <input
                    className="org-form-input"
                    type="password"
                    id="jwt-key-password"
                    value={keyPassword}
                    onChange={(event) => setKeyPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={busy}
                  />
                  <p className="org-login-hint">
                    {t(`${prefix}keyPasswordHint`)}
                  </p>
                </details>
                {storage}
              </>
            )}
          </>
        )}
        {route === "generate" && step === 1 && (
          <>
            {files}
            <JwtSetupGuide stage="configure" alibaba={alibaba} />
            <button
              type="button"
              className="jwt-help-link"
              disabled={busy}
              onClick={() =>
                openHelp(alibaba ? jwtHelpLinks.alibaba : jwtHelpLinks.app)
              }
            >
              {t(
                `${prefix}${alibaba ? "alibabaAppHelp" : "salesforceAppHelp"}`,
              )}
            </button>
          </>
        )}
        {step === 2 && material && (
          <>
            <p className="jwt-guide-intro">
              {t(
                `${prefix}${route === "generate" ? "readyIntro" : "verifyIntro"}`,
              )}
            </p>
            {files}
            {route === "import" ? (
              <JwtSetupGuide stage="configure" alibaba={alibaba} />
            ) : (
              <p className="jwt-guide-note">{t(`${prefix}loginReminder`)}</p>
            )}
          </>
        )}
        {error && (
          <div className="org-login-error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <p className="org-login-hint" role="status">
            {t(`${prefix}processing`)}
          </p>
        )}
        <div className="org-login-modal-actions jwt-wizard-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t(`${prefix}returnToLogin`)}
          </button>
          {step === 0 && route === "generate" && (
            <button
              type="button"
              className="jwt-primary"
              disabled={busy || checkingTools || !toolsReady || !validName}
              onClick={generate}
            >
              {t(`${prefix}generateAction`)}
            </button>
          )}
          {step === 0 && route === "import" && (
            <button
              type="button"
              className="jwt-primary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              {t(`${prefix}exportedNext`)}
            </button>
          )}
          {step === 1 && route === "generate" && (
            <button
              type="button"
              className="jwt-primary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(2);
              }}
            >
              {t(`${prefix}configuredNext`)}
            </button>
          )}
          {step === 1 && route === "import" && (
            <button
              type="button"
              className="jwt-primary"
              disabled={busy || !toolsReady || !entries.includes(alias)}
              onClick={extract}
            >
              {t(`${prefix}extractAction`)}
            </button>
          )}
          {step === 2 && material && (
            <button
              type="button"
              className="jwt-primary"
              disabled={busy}
              onClick={() => onComplete(material)}
            >
              {t(`${prefix}useKey`)}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
