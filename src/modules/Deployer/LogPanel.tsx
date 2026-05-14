import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDeployStore } from "./store";

export function LogPanel() {
  const { t } = useTranslation();
  const { logs, isDeploying } = useDeployStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="deployer-log-panel-wrap">
      <div className="deployer-log-header">
        <span>{t("deployer.logTitle")}</span>
        {isDeploying && <span className="deployer-running-badge">{t("deployer.running")}</span>}
      </div>
      <div className="deployer-log-panel" ref={ref}>
        {logs.length === 0 ? (
          <div className="metadata-muted">{t("deployer.logEmpty")}</div>
        ) : (
          logs.map((line, i) => <div key={i} className="metadata-log-line">{line}</div>)
        )}
      </div>
    </div>
  );
}
