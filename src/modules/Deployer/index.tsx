import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useOrgStore } from "../../store/org";
import { useWorkspaceStore } from "../../store/workspace";
import { useDeployStore } from "./store";
import { WorkingDirBar } from "./WorkingDirBar";
import { DiffSection } from "./DiffSection";
import { DeployConfig } from "./DeployConfig";
import { LogPanel } from "./LogPanel";
import { DeployHistory } from "./DeployHistory";

interface StreamEvent {
  event_type: string;
  data: string;
}

export function Deployer() {
  const { t } = useTranslation();
  const { currentOrg } = useOrgStore();
  const { lastRetrieveDir } = useWorkspaceStore();
  const {
    workingDir,
    setWorkingDir,
    targetOrgId,
    setTargetOrgId,
    config,
    isDeploying,
    setIsDeploying,
    appendLog,
    clearLogs,
  } = useDeployStore();

  const unlistenRef = useRef<(() => void) | null>(null);
  const [pkgXmlMissing, setPkgXmlMissing] = useState(false);

  // Auto-fill from Metadata Browser
  useEffect(() => {
    if (lastRetrieveDir && !workingDir) {
      setWorkingDir(lastRetrieveDir);
    }
  }, [lastRetrieveDir]);

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

  const handleDeploy = async () => {
    if (!workingDir || !targetOrgId) return;

    if (pkgXmlMissing) {
      appendLog(t("deployer.errorNoPackageXml"));
      return;
    }

    clearLogs();
    setIsDeploying(true);

    const eventId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const unlisten = await listen<StreamEvent>(eventId, ({ payload }) =>
      appendLog(payload.data),
    );
    unlistenRef.current = unlisten;

    try {
      await invoke("deploy_metadata", {
        options: {
          orgId: targetOrgId,
          workingDir,
          mode: config.mode,
          testLevel: config.testLevel,
          testClasses: config.testClasses,
          eventId,
        },
      });
    } finally {
      unlisten();
      unlistenRef.current = null;
      setIsDeploying(false);
    }
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
        <div className="deployer-setup-bar">
          <WorkingDirBar />
          <DiffSection />
          <DeployConfig onDeploy={() => void handleDeploy()} />
        </div>
        <div className="deployer-output-layout">
          <LogPanel />
          <DeployHistory orgId={targetOrgId ?? ""} />
        </div>
      </div>
    </section>
  );
}
