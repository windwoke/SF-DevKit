import type {
  ApexCoverageResult,
  ApexTestClass,
  ApexTestMethodResult,
} from "./types";

/** Unique per-class key across sources: namespace + name. */
export function classKey(cls: ApexTestClass): string {
  return `${cls.namespace_prefix ?? ""}:${cls.name}`;
}

/** Full run name with namespace: `ns.Class` or `Class`. */
export function fullClassName(namespacePrefix: string | null, name: string): string {
  return namespacePrefix ? `${namespacePrefix}.${name}` : name;
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

/** Case-insensitive local filter over name and namespace. */
export function filterTestClasses(
  classes: ApexTestClass[],
  search: string,
): ApexTestClass[] {
  const q = norm(search);
  if (!q) return classes;
  return classes.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.namespace_prefix ?? "").toLowerCase().includes(q),
  );
}

/** Coverage tier thresholds. ≥90 green, ≥75 yellow, below red. */
export const COVERAGE_GREEN = 90;
export const COVERAGE_YELLOW = 75;

export type CoverageTier = "green" | "yellow" | "red" | "none";

export function coverageTier(percent: number | null, totalLines: number): CoverageTier {
  if (percent === null || !Number.isFinite(percent) || totalLines === 0) return "none";
  if (percent >= COVERAGE_GREEN) return "green";
  if (percent >= COVERAGE_YELLOW) return "yellow";
  return "red";
}

/** Coverage: name search + DESCENDING covered_percent (nulls last). */
export function filterCoverage(
  coverage: ApexCoverageResult[],
  search: string,
): ApexCoverageResult[] {
  const q = norm(search);
  return coverage
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const pa = a.covered_percent;
      const pb = b.covered_percent;
      if (pa === null && pb === null) return a.name.localeCompare(b.name);
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa === pb) return a.name.localeCompare(b.name);
      return pb - pa;
    });
}

/**
 * Package coverage view: merge run coverage with every coverable member
 * (non-test classes + triggers) in the scanned package. Package test classes
 * are excluded — coverage is about the code UNDER test, not the tests. Run-
 * touched classes outside the package are kept but flagged. Classes the run
 * didn't touch get percent=null ("—" + not run). Sorted descending.
 */
export function buildPackageCoverage(
  allClasses: ApexTestClass[],
  coverage: ApexCoverageResult[],
  search: string,
): Array<ApexCoverageResult & { in_package: boolean }> {
  // Coverable package members: non-test classes + triggers.
  const coverable = allClasses.filter((k) => !k.is_test);
  const coverableNames = new Set(coverable.map((k) => k.name));
  const byName = new Map(coverage.map((c) => [c.name, c]));
  const rows: Array<ApexCoverageResult & { in_package: boolean }> = [
    ...coverage.map((c) => ({ ...c, in_package: coverableNames.has(c.name) })),
    ...coverable
      .filter((k) => !byName.has(k.name))
      .map((k) => ({
        id: k.id ?? k.name,
        name: k.name,
        covered_percent: null,
        total_lines: 0,
        covered_lines: 0,
        uncovered_lines: [],
        in_package: true,
      })),
  ];
  return filterCoverage(rows, search) as Array<ApexCoverageResult & { in_package: boolean }>;
}

/** Test results: failures first, then by Class.Method. */
export function sortTestResults(
  tests: ApexTestMethodResult[],
  search: string,
): ApexTestMethodResult[] {
  const q = norm(search);
  const rank = (t: ApexTestMethodResult) => (t.outcome === "Fail" ? 0 : 1);
  return tests
    .filter(
      (t) =>
        !q ||
        t.class_name.toLowerCase().includes(q) ||
        t.method_name.toLowerCase().includes(q),
    )
    .slice()
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const cls = fullClassName(a.namespace_prefix, a.class_name).localeCompare(
        fullClassName(b.namespace_prefix, b.class_name),
      );
      if (cls !== 0) return cls;
      return a.method_name.localeCompare(b.method_name);
    });
}

/** "82.5" | "—" — never NaN: zero total lines or null percent → "—". */
export function formatCoverage(percent: number | null, totalLines: number): string {
  if (percent === null || !Number.isFinite(percent) || totalLines === 0) return "—";
  return `${Math.round(percent * 10) / 10}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * URL of the setup page for async Apex test runs (fixed destination — the
 * queue view itself, not a per-run deep link). `instanceUrl` is the org's
 * my-domain URL.
 */
export function testRunUrl(instanceUrl: string): string {
  const base = instanceUrl.replace(/\/+$/, "");
  return `${base}/lightning/setup/ApexTestQueue/home`;
}
