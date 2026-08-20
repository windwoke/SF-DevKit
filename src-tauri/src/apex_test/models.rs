use serde::{Deserialize, Serialize};

/// A discoverable Apex test class — either from the current org or from a
/// retrieved package (directory or ZIP).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexTestClass {
    pub id: Option<String>,
    pub name: String,
    pub namespace_prefix: Option<String>,
    /// "org" | "retrieve"
    pub source: String,
    pub file_path: Option<String>,
    /// True when the body is a test class (`@isTest`/`testMethod`). Package
    /// scans also return non-test classes (false) for the coverage view.
    #[serde(default)]
    pub is_test: bool,
    /// Metadata type of the member: "ApexClass" (default) or "ApexTrigger".
    /// Triggers only appear in package scans — they're coverable but never
    /// runnable test classes.
    #[serde(default = "default_member_type")]
    pub member_type: String,
}

fn default_member_type() -> String {
    "ApexClass".to_string()
}

/// Result of scanning a retrieve package: test classes for the picker plus
/// every Apex class in the package for the coverage view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexPackageScan {
    pub test_classes: Vec<ApexTestClass>,
    pub all_classes: Vec<ApexTestClass>,
}

/// Roll-up numbers from `sf apex run test --json` / `sf apex get test --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexTestSummary {
    pub outcome: String,
    pub tests_ran: u32,
    pub passing: u32,
    pub failing: u32,
    pub skipped: u32,
    pub test_execution_time_ms: u64,
    pub test_run_coverage: Option<f64>,
    pub org_wide_coverage: Option<f64>,
}

/// One test method outcome. CLI JSON uses PascalCase (`StackTrace`, `Message`,
/// `RunTime`); we normalize to snake_case on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexTestMethodResult {
    pub id: Option<String>,
    pub class_name: String,
    pub namespace_prefix: Option<String>,
    pub method_name: String,
    pub outcome: String,
    pub run_time_ms: u64,
    pub message: Option<String>,
    pub stack_trace: Option<String>,
}

/// Per-class/per-trigger coverage touched by the run. `uncovered_lines` is
/// normalized from the CLI's `lines` object (`{"12": "1", "13": "0"}` → line
/// numbers whose value is "0").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexCoverageResult {
    pub id: String,
    pub name: String,
    pub covered_percent: Option<f64>,
    pub total_lines: u32,
    pub covered_lines: u32,
    pub uncovered_lines: Vec<u32>,
}

/// Top-level result for both `run` and `get` commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexTestRunResult {
    /// "completed" | "pending"
    pub status: String,
    pub test_run_id: String,
    pub summary: Option<ApexTestSummary>,
    pub tests: Vec<ApexTestMethodResult>,
    pub coverage: Vec<ApexCoverageResult>,
    pub raw_stdout: String,
}
