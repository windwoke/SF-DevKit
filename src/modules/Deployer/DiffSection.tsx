import { useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useDeployStore } from "./store";
import { buildDiffCommand } from "./diffRunner";

interface StreamEvent {
  event_type: string;
  data: string;
}

export function DiffSection() {
  const { t } = useTranslation();
  const {
    workingDir,
    targetOrgId,
    referenceDir,
    setReferenceDir,
    isDiffRetrieving,
    setIsDiffRetrieving,
  } = useDeployStore();

  const [diffLogs, setDiffLogs] = useState<string[]>([]);

  const handleRetrieveAndDiff = async () => {
    if (!workingDir || !targetOrgId) return;

    setIsDiffRetrieving(true);
    setDiffLogs([]);

    const eventId = `diff-retrieve-${Date.now()}`;
    const unlisten = await listen<StreamEvent>(eventId, ({ payload }) => {
      setDiffLogs((prev) => [...prev.slice(-100), payload.data]);
    });

    try {
      const refDir = await invoke<string>("retrieve_for_diff", {
        orgId: targetOrgId,
        workingDir,
        eventId,
      });
      setReferenceDir(refDir);

      const command = buildDiffCommand(workingDir, refDir);
      await invoke("open_diff_tool", { command });
    } catch (e: unknown) {
      setDiffLogs((prev) => [...prev, `${t("deployer.error")}: ${String(e)}`]);
    } finally {
      unlisten();
      setIsDiffRetrieving(false);
    }
  };

  const handleOpenDiffOnly = async () => {
    if (!workingDir || !referenceDir) return;
    const command = buildDiffCommand(workingDir, referenceDir);
    try {
      await invoke("open_diff_tool", { command });
    } catch (e) {
      setDiffLogs((prev) => [...prev, `${t("deployer.error")}: ${String(e)}`]);
    }
  };

  return (
    <div className="deployer-diff-section">
      <div className="deployer-diff-row">
        <span className="deployer-diff-label">{t("deployer.diffOptional")}</span>

        <button
          onClick={() => void handleRetrieveAndDiff()}
          disabled={!workingDir || !targetOrgId || isDiffRetrieving}
        >
          {isDiffRetrieving ? t("deployer.retrieving") : t("deployer.retrieveAndDiff")}
        </button>

        {referenceDir && (
          <button className="deployer-outline-btn" onClick={() => void handleOpenDiffOnly()}>
            {t("deployer.reopenDiff")}
          </button>
        )}

        {referenceDir && (
          <span className="deployer-diff-hint">{t("deployer.referenceReady")}</span>
        )}
      </div>

      {diffLogs.length > 0 && (
        <div className="deployer-diff-logs">
          {diffLogs.slice(-10).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
