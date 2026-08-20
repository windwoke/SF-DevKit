import { useTranslation } from "react-i18next";
import { tauriApi } from "../../lib/tauri";
import { formatCoverage, formatDuration, testRunUrl } from "./filters";
import type { ApexTestRunResult } from "./types";

function TestRunIdLink({
  testRunId,
  instanceUrl,
}: {
  testRunId: string;
  instanceUrl: string | null;
}) {
  const { t } = useTranslation();
  if (!instanceUrl || !testRunId) {
    return <span className="apex-test-summary-value mono">{testRunId || "—"}</span>;
  }
  return (
    <button
      type="button"
      className="apex-test-id-link mono"
      title={t("apexTestRunner.summary.openRunInBrowser")}
      onClick={() =>
        void tauriApi
          .openExternal({ kind: "url", target: testRunUrl(instanceUrl) })
          .catch(console.warn)
      }
    >
      {testRunId}
    </button>
  );
}

export function TestRunSummary({
  result,
  instanceUrl,
}: {
  result: ApexTestRunResult;
  instanceUrl: string | null;
}) {
  const { t } = useTranslation();

  if (result.status === "pending") {
    // Waiting state is rendered by the parent's progress/marquee area.
    return null;
  }

  const s = result.summary;
  if (!s) return null;

  const items: Array<[string, React.ReactNode]> = [
    [t("apexTestRunner.summary.testsRan"), String(s.tests_ran)],
    [t("apexTestRunner.summary.passing"), String(s.passing)],
    [t("apexTestRunner.summary.failing"), String(s.failing)],
    [t("apexTestRunner.summary.skipped"), String(s.skipped)],
    [t("apexTestRunner.summary.executionTime"), formatDuration(s.test_execution_time_ms)],
    [
      t("apexTestRunner.summary.testRunCoverage"),
      s.test_run_coverage === null
        ? "—"
        : `${formatCoverage(s.test_run_coverage, 1)}%`,
    ],
    [
      t("apexTestRunner.summary.orgWideCoverage"),
      s.org_wide_coverage === null
        ? "—"
        : `${formatCoverage(s.org_wide_coverage, 1)}%`,
    ],
    [
      t("apexTestRunner.summary.testRunId"),
      <TestRunIdLink key="runid" testRunId={result.test_run_id} instanceUrl={instanceUrl} />,
    ],
  ];

  return (
    <div className="apex-test-summary">
      <div className={`apex-test-summary-outcome outcome-${s.outcome.toLowerCase()}`}>
        {s.outcome}
      </div>
      <div className="apex-test-summary-grid">
        {items.map(([label, value]) => (
          <div className="apex-test-summary-item" key={label}>
            <span className="apex-test-summary-label">{label}</span>
            <span className="apex-test-summary-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
