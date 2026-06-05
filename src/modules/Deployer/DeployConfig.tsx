import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useDeployStore, type DeployMode, type TestLevel } from "./store";
import { useOrgStore } from "../../store/org";

interface ApexClass {
  id: string;
  name: string;
}

export function DeployConfig({ onDeploy }: { onDeploy: () => void }) {
  const { t } = useTranslation();
  const orgs = useOrgStore((s) => s.orgs);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const {
    config,
    setConfig,
    addTestClass,
    removeTestClass,
    workingDir,
    targetOrgId,
    isDeploying,
  } = useDeployStore();

  const [classInput, setClassInput] = useState("");
  const [classSearch, setClassSearch] = useState<ApexClass[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [testOnlyFilter, setTestOnlyFilter] = useState(true);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const targetOrg = orgs.find((o) => o.id === targetOrgId);
  const isProduction = targetOrg?.org_type === "production";
  const isNoTestOnProd = isProduction && config.testLevel === "no_test_run";

  const handleClassInput = (val: string) => {
    setClassInput(val);
    clearTimeout(searchTimer.current);
    if (val.length < 2) {
      setClassSearch([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      if (!currentOrg) return;
      setIsSearching(true);
      try {
        const results = await invoke<ApexClass[]>("search_apex_test_classes", {
          orgId: currentOrg,
          keyword: val,
        });
        setClassSearch(results);
      } catch (e) {
        console.error("Test class search failed:", e);
        setClassSearch([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const addClass = (name: string) => {
    addTestClass(name);
    setClassInput("");
    setClassSearch([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && classInput.trim()) {
      e.preventDefault();
      addClass(classInput.trim());
    }
  };

  const canDeploy = !!workingDir && !!targetOrgId && !isDeploying && !isNoTestOnProd;

  // Auto-scan local working directory for test classes when switching to SpecifiedTests
  useEffect(() => {
    if (config.testLevel !== "run_specified_tests" || !workingDir) return;
    if (config.testClasses.length > 0) return; // Already has classes
    invoke<ApexClass[]>("scan_local_test_classes", { workingDir })
      .then((classes) => {
        classes.forEach((c) => addTestClass(c.name));
      })
      .catch(() => {});
  }, [config.testLevel, workingDir]);

  const modeOptions: [DeployMode, string][] = [
    ["deploy", t("deployer.modeDeploy")],
    ["validate_and_deploy", t("deployer.modeValidateDeploy")],
    ["validate_only", t("deployer.modeValidateOnly")],
  ];

  const testOptions: [TestLevel, string][] = [
    ["default", t("deployer.testDefault")],
    ["no_test_run", t("deployer.testNoRun")],
    ["run_local_tests", t("deployer.testLocal")],
    ["run_specified_tests", t("deployer.testSpecified")],
  ];

  return (
    <div className="deployer-config-section">
      {/* Mode */}
      <div className="deployer-config-row">
        <span className="deployer-config-label">{t("deployer.mode")}</span>
        <div className="deployer-toggle-group">
          {modeOptions.map(([value, label]) => (
            <button
              key={value}
              className={`deployer-toggle-btn ${config.mode === value ? "active-green" : ""}`}
              onClick={() => setConfig({ mode: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Test Level */}
      <div className="deployer-config-row">
        <span className="deployer-config-label">{t("deployer.testLevel")}</span>
        <div className="deployer-config-col">
          <div className="deployer-toggle-group">
            {testOptions.map(([value, label]) => (
              <button
                key={value}
                className={`deployer-toggle-btn ${config.testLevel === value ? "active-blue" : ""}`}
                onClick={() => setConfig({ testLevel: value })}
              >
                {label}
              </button>
            ))}
          </div>

          {isNoTestOnProd && (
            <div className="deployer-warning-inline">
              {t("deployer.productionNoTestWarning")}
            </div>
          )}

          {/* Test class input (SpecifiedTests only) */}
          {config.testLevel === "run_specified_tests" && (
            <div className="deployer-test-input-wrap">
              <div className="deployer-test-input-row">
                <label className="deployer-test-only-toggle">
                  <input
                    type="checkbox"
                    checked={testOnlyFilter}
                    onChange={(e) => setTestOnlyFilter(e.target.checked)}
                  />
                  <span>{t("deployer.testOnlyFilter")}</span>
                </label>
                <input
                  placeholder={t("deployer.testClassPlaceholder")}
                  value={classInput}
                  onChange={(e) => handleClassInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                {isSearching && (
                  <span className="deployer-searching">{t("deployer.searching")}</span>
                )}
              </div>

              {classSearch.length > 0 && (
                <div className="deployer-test-dropdown">
                  {classSearch
                    .filter((cls) => !testOnlyFilter || cls.name.includes("Test"))
                    .map((cls) => (
                    <div
                      key={cls.id}
                      className="deployer-test-dropdown-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addClass(cls.name)}
                    >
                      {cls.name}
                    </div>
                  ))}
                </div>
              )}

              {config.testClasses.length > 0 && (
                <div className="deployer-test-tags">
                  {config.testClasses.map((cls) => (
                    <span key={cls} className="deployer-test-tag">
                      {cls}
                      <button onClick={() => removeTestClass(cls)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Deploy button */}
      <div className="deployer-config-actions">
        <button
          className={`deployer-primary-btn ${canDeploy ? "" : "disabled"}`}
          onClick={onDeploy}
          disabled={!canDeploy}
        >
          {isDeploying
            ? t("deployer.deploying")
            : config.mode === "validate_only"
              ? t("deployer.startValidate")
              : t("deployer.startDeploy")}
        </button>
      </div>
    </div>
  );
}
