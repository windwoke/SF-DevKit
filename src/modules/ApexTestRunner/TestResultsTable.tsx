import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration, fullClassName, sortTestResults } from "./filters";
import { useToggleSet } from "./useApexTestRun";
import type { ApexTestMethodResult } from "./types";

type ResultFilter = "all" | "failed";

export function TestResultsTable({ tests }: { tests: ApexTestMethodResult[] }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const { expanded, toggle: toggleRow } = useToggleSet();

  const rows = useMemo(() => {
    const scoped = filter === "failed" ? tests.filter((x) => x.outcome === "Fail") : tests;
    return sortTestResults(scoped, search);
  }, [tests, search, filter]);

  return (
    <div className="apex-test-table-wrap">
      <div className="apex-test-table-toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("apexTestRunner.searchResults")}
        />
        <div className="apex-test-filter-toggle">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            {t("apexTestRunner.filterAll")}
          </button>
          <button
            type="button"
            className={filter === "failed" ? "active" : ""}
            onClick={() => setFilter("failed")}
          >
            {t("apexTestRunner.filterFailed")}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="apex-test-empty">{t("apexTestRunner.empty.noResults")}</div>
      ) : (
        <div className="apex-test-rows">
          {rows.map((row) => {
            const key = `${row.class_name}.${row.method_name}`;
            const isFail = row.outcome === "Fail";
            const isOpen = expanded.has(key);
            return (
              <div key={key} className={`apex-test-row ${isFail ? "row-fail" : "row-pass"}`}>
                <button
                  type="button"
                  className="apex-test-row-main"
                  onClick={() => isFail && toggleRow(key)}
                  aria-expanded={isFail ? isOpen : undefined}
                >
                  <span className={`apex-test-outcome-badge outcome-${row.outcome.toLowerCase()}`}>
                    {row.outcome}
                  </span>
                  <span className="apex-test-row-class mono">
                    {fullClassName(row.namespace_prefix, row.class_name)}
                  </span>
                  <span className="apex-test-row-method">{row.method_name}</span>
                  <span className="apex-test-row-time mono">{formatDuration(row.run_time_ms)}</span>
                </button>
                {isFail && isOpen ? (
                  <div className="apex-test-row-detail">
                    {row.message ? (
                      <div className="apex-test-detail-block">
                        <span className="apex-test-detail-label">{t("apexTestRunner.columns.message")}</span>
                        <pre>{row.message}</pre>
                      </div>
                    ) : null}
                    {row.stack_trace ? (
                      <div className="apex-test-detail-block">
                        <span className="apex-test-detail-label">
                          {t("apexTestRunner.columns.stackTrace")}
                        </span>
                        <pre>{row.stack_trace}</pre>
                      </div>
                    ) : null}
                    {!row.message && !row.stack_trace ? (
                      <div className="apex-test-muted">{t("apexTestRunner.empty.noDetail")}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
