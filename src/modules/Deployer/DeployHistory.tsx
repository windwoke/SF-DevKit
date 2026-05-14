import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useDeployStore } from "./store";

interface HistoryRecord {
  id: number;
  org_id: string;
  working_dir: string;
  mode: string;
  test_level: string;
  success: boolean;
  deploy_id: string | null;
  component_count: number;
  error_count: number;
  duration_ms: number | null;
  errors_json: string;
  executed_at: string | null;
}

interface QuickDeployRecord {
  deploy_id: string;
  org_id: string;
  working_dir: string;
  component_count: number;
  expires_at: string;
  used: boolean;
  created_at: string | null;
}

interface StreamEvent {
  event_type: string;
  data: string;
}

export function DeployHistory({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { appendLog, clearLogs, setIsDeploying } = useDeployStore();
  const [quickDeployingId, setQuickDeployingId] = useState<string | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["deploy-history", orgId],
    queryFn: () => invoke<HistoryRecord[]>("list_deploy_history", { orgId, limit: 20 }),
    enabled: !!orgId,
  });

  const { data: quickDeploys = [] } = useQuery({
    queryKey: ["quick-deploys", orgId],
    queryFn: () => invoke<QuickDeployRecord[]>("list_quick_deploys", { orgId }),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const handleQuickDeploy = async (record: QuickDeployRecord) => {
    setQuickDeployingId(record.deploy_id);
    clearLogs();
    setIsDeploying(true);

    const eventId = `quick-deploy-${Date.now()}`;
    const unlisten = await listen<StreamEvent>(eventId, ({ payload }) =>
      appendLog(payload.data),
    );

    try {
      await invoke("quick_deploy", {
        orgId,
        deployId: record.deploy_id,
        eventId,
      });
      qc.invalidateQueries({ queryKey: ["deploy-history", orgId] });
      qc.invalidateQueries({ queryKey: ["quick-deploys", orgId] });
    } finally {
      unlisten();
      setIsDeploying(false);
      setQuickDeployingId(null);
    }
  };

  return (
    <div className="deployer-history-panel">
      <div className="deployer-history-title">{t("deployer.deployHistory")}</div>

      {quickDeploys.length > 0 && (
        <div className="deployer-quick-section">
          <div className="deployer-quick-label">★ {t("deployer.quickDeployAvailable")}</div>
          {quickDeploys.map((qd) => {
            const daysLeft = Math.ceil(
              (new Date(qd.expires_at).getTime() - Date.now()) / 86400000,
            );
            return (
              <div key={qd.deploy_id} className="deployer-quick-row">
                <div>
                  <div className="deployer-quick-count">
                    {qd.component_count} {t("deployer.components")}
                  </div>
                  <div className="deployer-quick-expire">
                    {daysLeft} {t("deployer.daysToExpire")}
                  </div>
                </div>
                <button
                  className="deployer-quick-btn"
                  onClick={() => void handleQuickDeploy(qd)}
                  disabled={quickDeployingId === qd.deploy_id}
                >
                  {quickDeployingId === qd.deploy_id
                    ? t("deployer.deploying")
                    : t("deployer.quickDeploy")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="deployer-history-list">
        {history.map((record) => (
          <HistoryRow key={record.id} record={record} />
        ))}
        {history.length === 0 && (
          <div className="deployer-history-empty">{t("deployer.noHistory")}</div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ record }: { record: HistoryRecord }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const errors: Array<{
    file_name: string;
    line_number?: number;
    column_number?: number;
    message: string;
    error_type: string;
  }> = JSON.parse(record.errors_json || "[]");

  const time = record.executed_at
    ? new Date(record.executed_at).toLocaleTimeString(i18n.language === "zh-CN" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="deployer-history-row-wrap">
      <div
        className="deployer-history-row"
        onClick={() => errors.length > 0 && setExpanded((v) => !v)}
      >
        <span className={record.success ? "deployer-success-icon" : "deployer-error-icon"}>
          {record.success ? "✓" : "✗"}
        </span>
        <div className="deployer-history-info">
          <div className="deployer-history-main">
            {record.mode === "validate"
              ? t("deployer.modeValidateOnlyShort")
              : record.mode === "quick_deploy"
                ? t("deployer.modeQuickDeploy")
                : t("deployer.modeDeployShort")}
            {" · "}
            {record.component_count}{" "}
            {record.mode === "quick_deploy" ? "" : t("deployer.components")}
          </div>
          <div className="deployer-history-sub">
            {time}
            {record.duration_ms != null && ` · ${(record.duration_ms / 1000).toFixed(1)}s`}
            {record.error_count > 0 && (
              <span className="deployer-error-text">
                {" "}
                · {t("deployer.errorCount", { count: record.error_count })}
              </span>
            )}
          </div>
        </div>
        {errors.length > 0 && (
          <span className="deployer-expand-icon">{expanded ? "▲" : "▼"}</span>
        )}
      </div>

      {expanded && errors.length > 0 && (
        <div className="deployer-error-detail">
          {errors.map((err, i) => (
            <div key={i} className="deployer-error-item">
              <div className="deployer-error-file">
                {err.file_name}
                {err.line_number && ` [${err.line_number}]`}
              </div>
              <div className="deployer-error-msg">{err.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
