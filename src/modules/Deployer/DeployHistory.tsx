import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useDeployStore, type DeployResult } from "./store";
import type { OrgAuth } from "../../store/org";
import { ConfirmModal, type ConfirmAction } from "./ConfirmModal";

interface HistoryRecord {
  id: number;
  org_id: string;
  working_dir: string;
  mode: string;
  test_level: string;
  success: number;
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
  used: number;
  created_at: string | null;
}

interface StreamEvent {
  event_type: string;
  data: string;
}

export function DeployHistory({ orgId, targetOrgId, setTargetOrgId, orgs }: {
  orgId: string;
  targetOrgId: string | null;
  setTargetOrgId: (id: string) => void;
  orgs: OrgAuth[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { appendLogs, clearLogs, setIsDeploying, setLastDeployResult } = useDeployStore();
  const [quickDeployingId, setQuickDeployingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["deploy-history", orgId],
    queryFn: () => invoke<HistoryRecord[]>("list_deploy_history", { orgId, limit: 20 }),
    enabled: !!orgId,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: quickDeploys = [] } = useQuery({
    queryKey: ["quick-deploys", orgId],
    queryFn: () => invoke<QuickDeployRecord[]>("list_quick_deploys", { orgId }),
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 0,
  });

  const doQuickDeploy = async (record: QuickDeployRecord) => {
    setQuickDeployingId(record.deploy_id);
    clearLogs();
    setIsDeploying(true);

    const eventId = `quick-deploy-${Date.now()}`;
    let batchBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (batchBuffer.length > 0) {
        appendLogs(batchBuffer);
        batchBuffer = [];
      }
    };
    const unlisten = await listen<StreamEvent>(eventId, ({ payload }) => {
      const lines = payload.data.split("\n");
      for (const line of lines) batchBuffer.push(line);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 100);
    });

    try {
      const result = await invoke<DeployResult>("quick_deploy", {
        orgId,
        deployId: record.deploy_id,
        eventId,
      });
      setLastDeployResult({ ...result, mode: "quick_deploy" });
      void qc.refetchQueries({ queryKey: ["deploy-history", orgId] });
      void qc.refetchQueries({ queryKey: ["quick-deploys", orgId] });
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      unlisten();
      setIsDeploying(false);
      setQuickDeployingId(null);
    }
  };

  const handleQuickDeploy = (record: QuickDeployRecord) => {
    const targetOrg = orgs.find((o) => o.id === targetOrgId);
    setConfirmAction({
      title: t("deployer.confirmTitle"),
      items: [
        { label: t("deployer.targetOrg"), value: targetOrg?.alias ?? targetOrgId! },
        { label: t("deployer.mode"), value: t("deployer.modeQuickDeploy") },
        { label: t("deployer.components"), value: String(record.component_count) },
      ],
      onConfirm: () => void doQuickDeploy(record),
    });
  };

  const selectedOrg = orgs.find((o) => o.id === targetOrgId);

  return (
    <div className="deployer-history-panel">
      <div className="deployer-target-org-bar">
        <label>{t("deployer.targetOrg")}</label>
        <select
          value={targetOrgId ?? ""}
          onChange={(e) => setTargetOrgId(e.target.value)}
        >
          <option value="">{t("deployer.selectOrg")}</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.alias ?? org.id}
            </option>
          ))}
        </select>
        {selectedOrg && (
          <div className="deployer-target-org-info">
            {selectedOrg.alias && <span className="deployer-target-org-alias">{selectedOrg.alias}</span>}
            <span className="deployer-target-org-id">{selectedOrg.id}</span>
          </div>
        )}
      </div>

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
      {confirmAction && (
        <ConfirmModal action={confirmAction} onClose={() => setConfirmAction(null)} />
      )}
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
    ? (() => {
        // Handle both old format (no TZ, stored as UTC) and new ISO 8601 format
        const s = record.executed_at!;
        const date = s.includes("T") ? new Date(s) : new Date(s.replace(" ", "T") + "Z");
        return date.toLocaleTimeString(i18n.language === "zh-CN" ? "zh-CN" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
      })()
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
