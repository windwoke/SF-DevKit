import { useTranslation } from "react-i18next";

export type JwtKeyRoute = "generate" | "import";

export const jwtHelpLinks = {
  certificate:
    "https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-key-and-cert.html",
  app: "https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-eca.html",
  keystore:
    "https://help.salesforce.com/s/articleView?id=xcloud.security_keys_export_import_certs_with_a_keystore.htm&language=en_US&type=5",
  openssl: "https://openssl-library.org/source/",
  java: "https://adoptium.net/temurin/releases/",
  alibaba:
    "https://help.aliyun.com/zh/sfoa/user-guide/best-practices-for-calling-the-bailian-agent-in-salesforce-on-alibaba-cloud-org-obtaining-access-token-and-passing-it-to-the-bailian-agent-api",
} as const;

/** One guide per stage so export, extraction and application setup stay separate. */
export function JwtSetupGuide({
  stage,
  alibaba = false,
}: {
  stage: "generate" | "export" | "configure";
  alibaba?: boolean;
}) {
  const { t } = useTranslation();
  const guide = stage === "configure" && alibaba ? "configureAlibaba" : stage;
  const steps = t(`orgManager.keySetup.guides.${guide}.steps`, {
    returnObjects: true,
  }) as string[];
  return (
    <div className="jwt-guide">
      <p className="jwt-guide-intro">
        {t(`orgManager.keySetup.guides.${guide}.intro`)}
      </p>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="jwt-guide-note">
        {t(`orgManager.keySetup.guides.${guide}.note`)}
      </p>
      {stage === "configure" && (
        <details>
          <summary>{t("orgManager.keySetup.connectedAppTitle")}</summary>
          <p>{t("orgManager.keySetup.connectedAppHelp")}</p>
        </details>
      )}
    </div>
  );
}
