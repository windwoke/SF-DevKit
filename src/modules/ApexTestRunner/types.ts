/** Wire format of the Rust `apex_test` module DTOs (snake_case). */

export interface ApexTestClass {
  id: string | null;
  name: string;
  namespace_prefix: string | null;
  /** "org" | "retrieve" */
  source: string;
  file_path: string | null;
  /** True when the body is a test class. Package scans also return
   *  non-test classes (false) for the package coverage view. */
  is_test: boolean;
  /** "ApexClass" (default) | "ApexTrigger" — triggers only come from package
   *  scans; they're coverable but never runnable test classes. */
  member_type: string;
}

/** Result of scanning a retrieve package. */
export interface ApexPackageScan {
  test_classes: ApexTestClass[];
  all_classes: ApexTestClass[];
}

export interface ApexTestSummary {
  outcome: string;
  tests_ran: number;
  passing: number;
  failing: number;
  skipped: number;
  test_execution_time_ms: number;
  test_run_coverage: number | null;
  org_wide_coverage: number | null;
}

export interface ApexTestMethodResult {
  id: string | null;
  class_name: string;
  namespace_prefix: string | null;
  method_name: string;
  outcome: string;
  run_time_ms: number;
  message: string | null;
  stack_trace: string | null;
}

export interface ApexCoverageResult {
  id: string;
  name: string;
  covered_percent: number | null;
  total_lines: number;
  covered_lines: number;
  uncovered_lines: number[];
}

export interface ApexTestRunResult {
  /** "completed" | "pending" */
  status: string;
  test_run_id: string;
  summary: ApexTestSummary | null;
  tests: ApexTestMethodResult[];
  coverage: ApexCoverageResult[];
  raw_stdout: string;
}

export type ApexTestSourceMode = "org" | "retrieve";
