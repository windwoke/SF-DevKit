import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildPackageCoverage,
  coverageTier,
  filterCoverage,
  formatCoverage,
} from "./filters";
import { useToggleSet } from "./useApexTestRun";
import type { ApexCoverageResult, ApexTestClass } from "./types";

/**
 * Coverage rows can be plain run results or package-merged rows that carry
 * `in_package` (touched by this run vs. merely present in the package).
 * Coverage always refers to non-test classes — the classes exercised BY the
 * selected tests.
 */
type PackageCoverageRow = ApexCoverageResult & { in_package: boolean };

type PackageFilter = "all" | "inPackage";

export function CoverageTable({
  coverage,
  packageClasses,
}: {
  coverage: ApexCoverageResult[];
  /** Package mode only: every class in the scanned retrieve package. */
  packageClasses?: ApexTestClass[];
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [packageFilter, setPackageFilter] = useState<PackageFilter>("all");
  const { expanded, toggle: toggleRow } = useToggleSet();

  const packageMode = !!packageClasses && packageClasses.length > 0;

  const allRows: Array<ApexCoverageResult | PackageCoverageRow> = useMemo(
    () =>
      packageMode
        ? buildPackageCoverage(packageClasses!, coverage, search)
        : filterCoverage(coverage, search),
    [packageMode, packageClasses, coverage, search],
  );

  const rows = useMemo(
    () =>
      packageMode && packageFilter === "inPackage"
        ? allRows.filter((r) => (r as PackageCoverageRow).in_package)
        : allRows,
    [packageMode, packageFilter, allRows],
  );

  return (
    <div className="apex-test-table-wrap">
      <div className="apex-test-table-toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("apexTestRunner.searchCoverage")}
        />
        {packageMode ? (
          <>
            <div className="apex-test-filter-toggle">
              <button
                type="button"
                className={packageFilter === "all" ? "active" : ""}
                onClick={() => setPackageFilter("all")}
              >
                {t("apexTestRunner.coverage.filterAll")}
              </button>
              <button
                type="button"
                className={packageFilter === "inPackage" ? "active" : ""}
                onClick={() => setPackageFilter("inPackage")}
              >
                {t("apexTestRunner.coverage.filterInPackage")}
              </button>
            </div>
            <span className="apex-test-cov-legend">
              <span className="apex-test-cov-dot tier-green" />≥90
              <span className="apex-test-cov-dot tier-yellow" />75–90
              <span className="apex-test-cov-dot tier-red" />&lt;75
              <span className="apex-test-cov-dot tier-none" />
              {t("apexTestRunner.coverage.notRun")}
            </span>
          </>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="apex-test-empty">{t("apexTestRunner.empty.noCoverage")}</div>
      ) : (
        <div className="apex-test-rows">
          {rows.map((row) => {
            const rowKey = `${row.id}-${row.name}`;
            const isOpen = expanded.has(rowKey);
            const pct = row.covered_percent;
            const tier = coverageTier(pct, row.total_lines);
            const barWidth = pct === null ? 0 : Math.max(0, Math.min(100, pct));
            const pkgRow = row as PackageCoverageRow;
            return (
              <div key={rowKey} className={`apex-test-cov-row tier-${tier}`}>
                <button
                  type="button"
                  className="apex-test-cov-main"
                  onClick={() => toggleRow(rowKey)}
                  aria-expanded={isOpen}
                >
                  <span className="apex-test-cov-name mono" title={row.name}>
                    {row.name}
                  </span>
                  <span className="apex-test-cov-bar">
                    <span className={`apex-test-cov-bar-fill tier-${tier}`} style={{ width: `${barWidth}%` }} />
                  </span>
                  <span className={`apex-test-cov-percent mono tier-${tier}`}>
                    {formatCoverage(pct, row.total_lines)}%
                  </span>
                  <span className="apex-test-cov-lines mono">
                    {row.total_lines > 0 ? `${row.covered_lines}/${row.total_lines}` : ""}
                  </span>
                  <span className="apex-test-cov-uncovered-count mono">
                    {row.uncovered_lines.length > 0
                      ? t("apexTestRunner.columns.uncoveredCount", { count: row.uncovered_lines.length })
                      : packageMode && !pkgRow.in_package
                        ? t("apexTestRunner.coverage.outsidePackage")
                        : ""}
                  </span>
                </button>
                {isOpen ? (
                  <div className="apex-test-cov-detail">
                    <span className="apex-test-detail-label">
                      {t("apexTestRunner.columns.uncoveredLines")}
                    </span>
                    {row.uncovered_lines.length === 0 ? (
                      <span className="apex-test-muted">{t("apexTestRunner.empty.noUncovered")}</span>
                    ) : (
                      <div className="apex-test-line-chips">
                        {row.uncovered_lines.map((n) => (
                          <span key={n} className="apex-test-line-chip mono">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
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
