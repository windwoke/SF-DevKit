import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";
import { useUiStore } from "../../store/ui";
import { useWorkspaceStore } from "../../store/workspace";
import { TestClassPicker } from "./TestClassPicker";
import { TestResultsTable } from "./TestResultsTable";
import { CoverageTable } from "./CoverageTable";
import { TestRunSummary } from "./TestRunSummary";
import { useApexTestRunnerStore } from "./store";
import { classKey, filterTestClasses, testRunUrl } from "./filters";
import { useApexTestRun } from "./useApexTestRun";
import type { ApexTestClass } from "./types";

type ResultTab = "tests" | "coverage";

export function ApexTestRunner() {
  const { t } = useTranslation();
  const { currentOrg, orgs } = useOrgStore();
  const currentOrgInfo = orgs.find((o) => o.id === currentOrg) ?? null;
  const activeModule = useUiStore((s) => s.activeModule);
  const queryClient = useQueryClient();
  const { sourceMode, packagePath, openRetrievePackage, setSourceMode } = useApexTestRunnerStore();
  const lastRetrieveDir = useWorkspaceStore((s) => s.lastRetrieveDir);
  const lastRetrieveOrgId = useWorkspaceStore((s) => s.lastRetrieveOrgId);

  // Page-local selection/search state (never persisted)
  const [selectedClassKeys, setSelectedClassKeys] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState("");
  const [activeResultTab, setActiveResultTab] = useState<ResultTab>("tests");

  const isModuleActive = activeModule === "apex_tests";
  // Load org test classes whenever the module is active (both modes use
  // them: org mode lists them alone; retrieve mode merges them into the
  // picker as extra choices).
  const orgQuery = useQuery({
    queryKey: ["apex-test-classes", currentOrg],
    enabled: !!currentOrg && isModuleActive,
    queryFn: () => tauriApi.listApexTestClasses({ orgId: currentOrg! }),
    staleTime: 10 * 60 * 1000,
  });

  // Package scan runs as a mutation-like effect on path change.
  const [packageTests, setPackageTests] = useState<ApexTestClass[]>([]);
  const [packageAllClasses, setPackageAllClasses] = useState<ApexTestClass[]>([]);
  const [packageScanError, setPackageScanError] = useState<string | null>(null);
  const [scanningPackage, setScanningPackage] = useState(false);

  const effectivePackagePath = packagePath ?? lastRetrieveDir;

  const scanPackage = useCallback(async (path: string) => {
    setScanningPackage(true);
    setPackageScanError(null);
    try {
      const scan = await tauriApi.scanApexTestPackage(path);
      setPackageTests(scan.test_classes);
      setPackageAllClasses(scan.all_classes);
      // Package source: select all parsed test classes by default.
      setSelectedClassKeys(new Set(scan.test_classes.map((c) => classKey(c))));
    } catch (e) {
      setPackageTests([]);
      setPackageAllClasses([]);
      setSelectedClassKeys(new Set());
      setPackageScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanningPackage(false);
    }
  }, []);

  // (Re)scan when entering retrieve mode or when the path changes. The
  // cross-module hand-off (Metadata Browser) writes packagePath + switches
  // the active module; this effect picks the path up either way.
  useEffect(() => {
    if (sourceMode !== "retrieve") return;
    if (!effectivePackagePath) {
      setPackageTests([]);
      setPackageAllClasses([]);
      setPackageScanError(null);
      return;
    }
    void scanPackage(effectivePackagePath);
  }, [sourceMode, effectivePackagePath, scanPackage]);

  const switchSource = (mode: "org" | "retrieve") => {
    setSourceMode(mode);
    setSelectedClassKeys(new Set());
    setClassSearch("");
  };

  // Retrieve mode: package test classes PLUS current-org test classes — the
  // run target is always the current org, so org classes are valid choices
  // alongside the package's own tests. Duplicates (same class in both lists,
  // e.g. a package test that also exists in the org) resolve to the package
  // entry first — `sf apex run test` rejects a class listed twice.
  const classes = useMemo(() => {
    if (sourceMode === "org") return orgQuery.data ?? [];
    const merged = new Map<string, ApexTestClass>();
    for (const c of packageTests) merged.set(classKey(c), c);
    for (const c of orgQuery.data ?? []) {
      const key = classKey(c);
      if (!merged.has(key)) merged.set(key, { ...c, source: "org" });
    }
    return [...merged.values()];
  }, [sourceMode, orgQuery.data, packageTests]);

  const visibleClasses = useMemo(
    () => filterTestClasses(classes, classSearch),
    [classes, classSearch],
  );

  const selectedClasses = useMemo(
    () => classes.filter((c) => selectedClassKeys.has(classKey(c))),
    [classes, selectedClassKeys],
  );

  const {
    runResult,
    runError,
    runStartedAt,
    pollingRunId,
    submitting,
    waiting,
    busy,
    runMutation,
    fetchResultMutation,
  } = useApexTestRun(currentOrg, selectedClasses, {
    noOrg: t("apexTestRunner.errors.noOrg"),
    noSelection: t("apexTestRunner.errors.noSelection"),
  });

  const loadingClasses = sourceMode === "org" ? orgQuery.isLoading : scanningPackage;
  const loadError = packageScanError
    ? packageScanError
    : orgQuery.error instanceof Error
      ? orgQuery.error.message
      : orgQuery.error
        ? String(orgQuery.error)
        : null;

  const refreshClasses = async () => {
    if (!currentOrg) return;
    await queryClient.fetchQuery({
      queryKey: ["apex-test-classes", currentOrg],
      queryFn: () => tauriApi.listApexTestClasses({ orgId: currentOrg, forceRefresh: true }),
    });
  };

  const chooseOtherPackage = async () => {
    const picked = await tauriApi.pickApexTestPackage();
    if (picked) openRetrievePackage(picked);
  };

  // Switching org invalidates the selection made against the old org's
  // class list (also stale for retrieve-mode runs — the run target changed).
  useEffect(() => {
    setSelectedClassKeys(new Set());
  }, [currentOrg]);

  // Lock source switching / selection while submitting or waiting on a run.
  const lockUi = busy || waiting;

  const pendingRunId = pollingRunId ?? runResult?.test_run_id ?? "";

  return (
    <div className="apex-test-module">
      <div className="apex-test-toolbar">
        <div className="apex-test-source-toggle">
          <button
            type="button"
            className={sourceMode === "org" ? "active" : ""}
            onClick={() => switchSource("org")}
            disabled={lockUi}
          >
            {t("apexTestRunner.source.org")}
          </button>
          <button
            type="button"
            className={sourceMode === "retrieve" ? "active" : ""}
            onClick={() => switchSource("retrieve")}
            disabled={lockUi}
          >
            {t("apexTestRunner.source.retrieve")}
          </button>
        </div>
      </div>

      {sourceMode === "retrieve" ? (
        <div className="apex-test-package-bar">
          <span className="apex-test-package-path mono" title={effectivePackagePath ?? ""}>
            {effectivePackagePath ?? t("apexTestRunner.empty.noPackage")}
          </span>
          <button type="button" onClick={() => void chooseOtherPackage()} disabled={lockUi}>
            {t("apexTestRunner.choosePackage")}
          </button>
          <button
            type="button"
            onClick={() => effectivePackagePath && void scanPackage(effectivePackagePath)}
            disabled={lockUi || !effectivePackagePath}
          >
            {t("apexTestRunner.parsePackage")}
          </button>
        </div>
      ) : null}

      {sourceMode === "retrieve" &&
      lastRetrieveOrgId &&
      currentOrg &&
      lastRetrieveOrgId !== currentOrg ? (
        <div className="apex-test-warning">
          {t("apexTestRunner.warnings.orgMismatch", {
            retrieveOrg: orgs.find((o) => o.id === lastRetrieveOrgId)?.alias ?? lastRetrieveOrgId,
            currentOrgName: orgs.find((o) => o.id === currentOrg)?.alias ?? currentOrg,
          })}
        </div>
      ) : null}

      <div className="apex-test-body">
        <section className="apex-test-left">
          <header className="apex-test-pane-header">
            <h3>{t("apexTestRunner.testClasses")}</h3>
            {sourceMode === "org" ? (
              <button
                type="button"
                onClick={() => void refreshClasses()}
                disabled={lockUi || orgQuery.isFetching}
              >
                {t("apexTestRunner.refresh")}
              </button>
            ) : null}
          </header>

          {!currentOrg && sourceMode === "org" ? (
            <div className="apex-test-empty">{t("apexTestRunner.empty.noOrg")}</div>
          ) : loadingClasses ? (
            <div className="apex-test-loading">{t("apexTestRunner.loadingClasses")}</div>
          ) : loadError ? (
            <div className="apex-test-error">
              <div>{loadError}</div>
              {sourceMode === "org" ? (
                <button type="button" onClick={() => void refreshClasses()}>
                  {t("apexTestRunner.refresh")}
                </button>
              ) : null}
            </div>
          ) : sourceMode === "retrieve" && classes.length === 0 && !packageScanError ? (
            <div className="apex-test-empty">
              {orgQuery.data && orgQuery.data.length === 0
                ? t("apexTestRunner.empty.noPackageTests")
                : t("apexTestRunner.loadingOrgClasses")}
            </div>
          ) : (
            <TestClassPicker
              classes={classes}
              visibleClasses={visibleClasses}
              selectedKeys={selectedClassKeys}
              search={classSearch}
              onSearchChange={setClassSearch}
              onToggle={(key) =>
                setSelectedClassKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              onSelectVisible={() => {
                const next = new Set(selectedClassKeys);
                visibleClasses.forEach((c) => next.add(classKey(c)));
                setSelectedClassKeys(next);
              }}
              onClearSelection={() => setSelectedClassKeys(new Set())}
              disabled={lockUi}
              sourceMode={sourceMode}
            />
          )}

          <div className="apex-test-run-bar">
            <button
              type="button"
              className="apex-test-run-btn"
              onClick={() => void runMutation.mutateAsync()}
              disabled={lockUi || selectedClassKeys.size === 0 || !currentOrg}
            >
              {submitting
                ? t("apexTestRunner.running")
                : t("apexTestRunner.runSelected", { count: selectedClassKeys.size })}
            </button>
          </div>
        </section>

        <section className="apex-test-right">
          <header className="apex-test-pane-header">
            <h3>{t("apexTestRunner.results")}</h3>
            {waiting ? (
              <button
                type="button"
                onClick={() => void fetchResultMutation.mutateAsync()}
                disabled={fetchResultMutation.isPending}
              >
                {fetchResultMutation.isPending
                  ? t("apexTestRunner.fetchingResult")
                  : t("apexTestRunner.fetchResult")}
              </button>
            ) : null}
          </header>

          {runError ? <div className="apex-test-error">{runError}</div> : null}

          {submitting ? (
            <div className="apex-test-progress">
              <div className="apex-test-progress-track">
                <div className="apex-test-progress-indeterminate" />
              </div>
              <span className="apex-test-progress-label">
                {t("apexTestRunner.submitting", {
                  count: selectedClassKeys.size,
                })}
              </span>
            </div>
          ) : waiting ? (
            <div className="apex-test-progress" data-testid="apex-test-waiting">
              <div className="apex-test-progress-track">
                <div className="apex-test-progress-indeterminate" />
              </div>
              <span className="apex-test-progress-label">
                {t("apexTestRunner.waiting", { id: pendingRunId })}
              </span>
              {currentOrgInfo?.instance_url && pendingRunId ? (
                <button
                  type="button"
                  className="apex-test-id-link mono"
                  title={t("apexTestRunner.summary.openRunInBrowser")}
                  onClick={() =>
                    void tauriApi
                      .openExternal({
                        kind: "url",
                        target: testRunUrl(currentOrgInfo.instance_url),
                      })
                      .catch(console.warn)
                  }
                >
                  {pendingRunId}
                </button>
              ) : null}
              <span className="apex-test-progress-sub mono">
                {t("apexTestRunner.startedAt", {
                  time: runStartedAt
                    ? runStartedAt.toLocaleTimeString(undefined, { hour12: false })
                    : "",
                })}
              </span>
            </div>
          ) : runResult ? (
            <>
              <TestRunSummary result={runResult} instanceUrl={currentOrgInfo?.instance_url ?? null} />
              <div className="apex-test-tabs">
                <button
                  type="button"
                  className={activeResultTab === "tests" ? "active" : ""}
                  onClick={() => setActiveResultTab("tests")}
                >
                  {t("apexTestRunner.tabs.tests")}
                </button>
                <button
                  type="button"
                  className={activeResultTab === "coverage" ? "active" : ""}
                  onClick={() => setActiveResultTab("coverage")}
                >
                  {t("apexTestRunner.tabs.coverage")}
                </button>
              </div>
              {activeResultTab === "tests" ? (
                <TestResultsTable tests={runResult.tests} />
              ) : (
                <CoverageTable
                  coverage={runResult.coverage}
                  packageClasses={
                    sourceMode === "retrieve" && packageAllClasses.length > 0
                      ? packageAllClasses
                      : undefined
                  }
                />
              )}
            </>
          ) : (
            <div className="apex-test-empty">{t("apexTestRunner.empty.noRun")}</div>
          )}
        </section>
      </div>
    </div>
  );
}
