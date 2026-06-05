import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgStore } from "../../store/org";
import { useWorkspaceStore } from "../../store/workspace";
import { useDeployStore, type DeployResult } from "./store";
import { WorkingDirBar } from "./WorkingDirBar";
import { DiffSection } from "./DiffSection";
import { DeployConfig } from "./DeployConfig";
import { LogPanel } from "./LogPanel";
import { DeployHistory } from "./DeployHistory";
import { ConfirmModal, type ConfirmAction } from "./ConfirmModal";

interface StreamEvent {
  event_type: string;
  data: string;
}

export function Deployer() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentOrg, orgs } = useOrgStore();
  const { lastRetrieveDir, lastRetrieveAt } = useWorkspaceStore();
  const {
    workingDir,
    setWorkingDir,
    targetOrgId,
    setTargetOrgId,
    config,
    isDeploying,
    setIsDeploying,
    appendLog,
    appendLogs,
    clearLogs,
    setLastDeployResult,
  } = useDeployStore();

  const unlistenRef = useRef<(() => void) | null>(null);
  const [pkgXmlMissing, setPkgXmlMissing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // Auto-fill from Metadata Browser — update on every new retrieve
  useEffect(() => {
    if (lastRetrieveDir) {
      setWorkingDir(lastRetrieveDir);
    }
  }, [lastRetrieveAt]);

  // Default target org = current org
  useEffect(() => {
    if (!targetOrgId && currentOrg) {
      setTargetOrgId(currentOrg);
    }
  }, [currentOrg]);

  // Check package.xml when working dir changes
  useEffect(() => {
    if (!workingDir) {
      setPkgXmlMissing(false);
      return;
    }
    invoke<boolean>("check_package_xml", { workingDir })
      .then((exists) => setPkgXmlMissing(!exists))
      .catch(() => setPkgXmlMissing(false));
  }, [workingDir]);

  const doDeploy = async () => {
    clearLogs();
    setIsDeploying(true);

    const eventId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Batch log lines to reduce React re-renders
    let batchBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (batchBuffer.length > 0) {
        appendLogs(batchBuffer);
        batchBuffer = [];
      }
    };
    const unlisten = await listen<StreamEvent>(eventId, ({ payload }) => {
      // Push lines (single or multi-line batches from Rust)
      const lines = payload.data.split("\n");
      for (const line of lines) batchBuffer.push(line);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 100);
    });
    unlistenRef.current = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      unlisten();
    };

    try {
      const result = await invoke<DeployResult>("deploy_metadata", {
        options: {
          orgId: targetOrgId!,
          workingDir: workingDir!,
          mode: config.mode,
          testLevel: config.testLevel,
          testClasses: config.testClasses,
          eventId,
        },
      });
      setLastDeployResult({ ...result, mode: config.mode });
    } catch (e) {
      appendLog(`${t("deployer.error")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setIsDeploying(false);
      void qc.refetchQueries({ queryKey: ["deploy-history", targetOrgId!] });
      void qc.refetchQueries({ queryKey: ["quick-deploys", targetOrgId!] });
    }
  };

  const handleDeploy = () => {
    if (!workingDir || !targetOrgId) return;

    if (pkgXmlMissing) {
      appendLog(t("deployer.errorNoPackageXml"));
      return;
    }

    const targetOrg = orgs.find((o) => o.id === targetOrgId);
    const modeLabel =
      config.mode === "validate_only"
        ? t("deployer.modeValidateOnly")
        : config.mode === "validate_and_deploy"
          ? t("deployer.modeValidateDeploy")
          : t("deployer.modeDeploy");

    setConfirmAction({
      title: t("deployer.confirmTitle"),
      items: [
        { label: t("deployer.targetOrg"), value: targetOrg?.alias ?? targetOrgId! },
        { label: t("deployer.mode"), value: modeLabel },
        { label: t("deployer.testLevel"), value: t(`deployer.test${config.testLevel === "default" ? "Default" : config.testLevel === "no_test_run" ? "NoRun" : config.testLevel === "run_local_tests" ? "Local" : "Specified"}`) },
        { label: t("deployer.workingDir"), value: workingDir! },
      ],
      onConfirm: doDeploy,
    });
  };

  return (
    <section className="module deployer-module">
      <div className="module-header module-header--compact">
        <h2>{t("modules.deployer")}</h2>
      </div>
      {pkgXmlMissing && (
        <div className="deployer-warning-banner">
          {t("deployer.warningNoPackageXml")}
        </div>
      )}
      <div className="deployer-body">
        <div className="deployer-left">
          <div className="deployer-setup-bar">
            <WorkingDirBar />
            <DiffSection />
            <DeployConfig onDeploy={handleDeploy} />
          </div>
          <LogPanel />
        </div>
        <div className="deployer-right">
          <DeployHistory
            orgId={targetOrgId ?? ""}
            targetOrgId={targetOrgId}
            setTargetOrgId={setTargetOrgId}
            orgs={useOrgStore((s) => s.orgs)}
          />
        </div>
      </div>
      {confirmAction && (
        <ConfirmModal action={confirmAction} onClose={() => setConfirmAction(null)} />
      )}
    </section>
  );
}
