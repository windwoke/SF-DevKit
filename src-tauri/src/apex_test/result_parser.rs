//! Pure parser for `sf apex run test --json` / `sf apex get test --json`
//! stdout. No I/O — fully covered by fixtures in `fixtures/`.
//!
//! Wire format (verified against @salesforce/apex-node, the plugin's engine):
//! ```json
//! {
//!   "status": 0,
//!   "result": {
//!     "summary": {
//!       "outcome": "Passed", "testsRan": 3, "passing": 3, "failing": 0,
//!       "skipped": 0, "testExecutionTimeInMs": 2456,
//!       "testRunCoverage": "82%", "orgWideCoverage": "91%", "testRunId": "707…"
//!     },
//!     "tests": [
//!       { "id": "…", "stackTrace": null, "message": null, "methodName": "…",
//!         "outcome": "Pass", "runTime": 412,
//!         "apexClass": { "id": "…", "name": "FooTest", "namespacePrefix": null } }
//!     ],
//!     "codecoverage": [
//!       { "apexId": "01p…", "name": "Foo", "type": "ApexClass",
//!         "numLinesCovered": 10, "numLinesUncovered": 1, "percentage": "91%",
//!         "coveredLines": [1,2], "uncoveredLines": [42] }
//!     ]
//!   }
//! }
//! ```
//! When `--wait` expires before completion, `result` is just
//! `{ "testRunId": "707…" }` (no summary/tests). Older CLI builds used
//! PascalCase test fields and a nested `coverage.coverage` array — both are
//! tolerated below.

use anyhow::{bail, Context};

use super::models::{ApexCoverageResult, ApexTestRunResult, ApexTestSummary, ApexTestMethodResult};

fn opt_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn num_u64(v: &serde_json::Value, key: &str) -> u64 {
    match v.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
        // Fields arrive as strings, sometimes with units ("1234", "2456 ms").
        Some(serde_json::Value::String(s)) => s
            .trim()
            .split(|c: char| !c.is_ascii_digit())
            .find(|part| !part.is_empty())
            .and_then(|part| part.parse().ok())
            .unwrap_or(0),
        _ => 0,
    }
}

fn num_u32(v: &serde_json::Value, key: &str) -> u32 {
    u32::try_from(num_u64(v, key)).unwrap_or(0)
}

/// Numbers or percentage strings: `82`, `"82"`, `"82%"` → 82.0.
fn opt_f64(v: &serde_json::Value, key: &str) -> Option<f64> {
    match v.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.trim().trim_end_matches('%').parse().ok(),
        _ => None,
    }
}

fn parse_summary(v: &serde_json::Value) -> ApexTestSummary {
    ApexTestSummary {
        outcome: opt_str(v, "outcome").unwrap_or_default(),
        tests_ran: num_u32(v, "testsRan"),
        passing: num_u32(v, "passing"),
        failing: num_u32(v, "failing"),
        skipped: num_u32(v, "skipped"),
        // Human result-format keys (`testExecutionTime`, "1417 ms") vs the
        // programmatic ones (`testExecutionTimeInMs`, 1417).
        test_execution_time_ms: num_u64(v, "testExecutionTimeInMs")
            + num_u64(v, "testExecutionTime"),
        test_run_coverage: opt_f64(v, "testRunCoverage"),
        org_wide_coverage: opt_f64(v, "orgWideCoverage"),
    }
}

fn parse_tests(v: &serde_json::Value) -> Vec<ApexTestMethodResult> {
    let arr = match v.get("tests").and_then(|t| t.as_array()) {
        Some(a) => a,
        None => return vec![],
    };
    arr.iter()
        .map(|t| {
            // Current CLI wraps class info in `apexClass`; older builds
            // flatten it as PascalCase `ApexClass`/`ClassName` fields.
            let nested = t.get("apexClass");
            let nested_pascal = t.get("ApexClass");
            let class_name = opt_str(t, "ClassName")
                .or_else(|| nested.and_then(|c| opt_str(c, "name")))
                .or_else(|| nested.and_then(|c| opt_str(c, "Name")))
                .or_else(|| nested_pascal.and_then(|c| opt_str(c, "Name")))
                .unwrap_or_default();
            let namespace_prefix = opt_str(t, "NamespacePrefix")
                .or_else(|| nested.and_then(|c| opt_str(c, "namespacePrefix")))
                .or_else(|| nested.and_then(|c| opt_str(c, "NamespacePrefix")));
            ApexTestMethodResult {
                id: opt_str(t, "id").or_else(|| opt_str(t, "Id")),
                class_name,
                namespace_prefix,
                method_name: opt_str(t, "methodName")
                    .or_else(|| opt_str(t, "MethodName"))
                    .unwrap_or_default(),
                outcome: opt_str(t, "outcome")
                    .or_else(|| opt_str(t, "Outcome"))
                    .unwrap_or_default(),
                run_time_ms: num_u64(t, "runTime").max(num_u64(t, "RunTime")),
                message: opt_str(t, "message").or_else(|| opt_str(t, "Message")),
                stack_trace: opt_str(t, "stackTrace").or_else(|| opt_str(t, "StackTrace")),
            }
        })
        .collect()
}

/// Line-number arrays: `[1, 2]` or `["1", "2"]`.
fn parse_line_array(v: Option<&serde_json::Value>) -> Vec<u32> {
    let arr = match v.and_then(|x| x.as_array()) {
        Some(a) => a,
        None => return vec![],
    };
    let mut out: Vec<u32> = arr
        .iter()
        .filter_map(|x| match x {
            serde_json::Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
            serde_json::Value::String(s) => s.trim().parse().ok(),
            _ => None,
        })
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// One entry of the apex-node programmatic shape (`result.codecoverage[]`):
/// `apexId`/`numLinesCovered`/`numLinesUncovered`/`percentage`/line arrays.
fn parse_coverage_entry_programmatic(c: &serde_json::Value) -> ApexCoverageResult {
    let covered = num_u32(c, "numLinesCovered");
    let uncovered = num_u32(c, "numLinesUncovered");
    let uncovered_lines = parse_line_array(c.get("uncoveredLines"));
    // Derive counts from line arrays when numeric fields are absent.
    let (covered, uncovered_lines) = if covered == 0 && uncovered == 0 {
        let covered_lines = parse_line_array(c.get("coveredLines"));
        (
            covered_lines.len() as u32,
            parse_line_array(c.get("uncoveredLines")),
        )
    } else {
        (covered, uncovered_lines)
    };
    let total_lines = covered + uncovered_lines.len() as u32;
    let covered_percent = if total_lines == 0 {
        None
    } else {
        opt_f64(c, "percentage").or(Some(covered as f64 * 100.0 / total_lines as f64))
    };
    ApexCoverageResult {
        id: opt_str(c, "apexId")
            .or_else(|| opt_str(c, "id"))
            .unwrap_or_default(),
        name: opt_str(c, "name").unwrap_or_default(),
        covered_percent,
        total_lines,
        covered_lines: covered,
        uncovered_lines,
    }
}

/// One entry of the observed-by-default human-JSON shape
/// (`result.coverage.coverage[]`): `id`/`totalLines`/`totalCovered`/
/// `coveredPercent` (number) + `lines: {"12": 1, "14": 0}`.
fn parse_coverage_entry_human(c: &serde_json::Value) -> ApexCoverageResult {
    let total = num_u32(c, "totalLines");
    let covered = num_u32(c, "totalCovered");
    // `lines`: object keyed by line number, value 1 covered / 0 not.
    let mut uncovered: Vec<u32> = Vec::new();
    if let Some(lines) = c.get("lines").and_then(|l| l.as_object()) {
        for (line_no, state) in lines {
            let is_uncovered = state.as_u64() == Some(0)
                || state.as_i64() == Some(0)
                || state.as_str() == Some("0");
            if is_uncovered {
                if let Ok(n) = line_no.parse::<u32>() {
                    uncovered.push(n);
                }
            }
        }
    }
    uncovered.sort_unstable();
    // Fallbacks for sibling shapes that use different count field names.
    let covered = if covered == 0 {
        num_u32(c, "coveredLines")
    } else {
        covered
    };
    let covered_percent = opt_f64(c, "coveredPercent")
        .or_else(|| opt_f64(c, "percentage"))
        .or(if total == 0 {
            None
        } else {
            Some(covered as f64 * 100.0 / total as f64)
        });
    ApexCoverageResult {
        id: opt_str(c, "id").unwrap_or_default(),
        name: opt_str(c, "name").unwrap_or_default(),
        covered_percent,
        total_lines: total,
        covered_lines: covered,
        uncovered_lines: uncovered,
    }
}

fn parse_coverage(payload: &serde_json::Value) -> Vec<ApexCoverageResult> {
    // Default (observed, sf 2.147.x with --result-format json):
    // nested `coverage.coverage` array with human-ish field names.
    if let Some(arr) = payload.pointer("/coverage/coverage").and_then(|c| c.as_array()) {
        return arr.iter().map(parse_coverage_entry_human).collect();
    }
    // Programmatic apex-node shape: top-level `codecoverage` array.
    if let Some(arr) = payload.get("codecoverage").and_then(|c| c.as_array()) {
        return arr.iter().map(parse_coverage_entry_programmatic).collect();
    }
    // Some builds used `coverage` as a bare array.
    if let Some(arr) = payload.get("coverage").and_then(|c| c.as_array()) {
        return arr.iter().map(parse_coverage_entry_programmatic).collect();
    }
    vec![]
}

/// Extract the payload object from the CLI JSON envelope. Supports:
/// - standard `{ status, result: {...} }`
/// - bare payload object without envelope
fn payload_of(json: &serde_json::Value) -> Option<&serde_json::Value> {
    if let Some(result) = json.get("result") {
        if result.is_object() {
            return Some(result);
        }
    }
    if json.get("summary").is_some() || json.get("tests").is_some() {
        return Some(json);
    }
    None
}

/// Parse raw CLI stdout into an [`ApexTestRunResult`]. Returns an error when
/// the stdout does not contain a recognizable test result payload — callers
/// then fall back to reporting the CLI failure itself.
pub fn parse_apex_test_output(stdout: &str) -> anyhow::Result<ApexTestRunResult> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        bail!("empty CLI stdout");
    }
    let json: serde_json::Value =
        serde_json::from_str(trimmed).context("CLI stdout is not valid JSON")?;

    let payload = payload_of(&json)
        .ok_or_else(|| anyhow::anyhow!("no test result payload in CLI stdout"))?;

    let test_run_id = payload
        .get("testRunId")
        .or_else(|| payload.pointer("/summary/testRunId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let summary = payload
        .get("summary")
        .filter(|s| s.is_object())
        .map(parse_summary);
    let tests = parse_tests(payload);
    let coverage = parse_coverage(payload);

    // Completed runs always carry a summary; otherwise treat as pending as
    // long as we at least have a Test Run ID to poll with.
    let status = if summary.is_some() {
        "completed"
    } else if !test_run_id.is_empty() {
        "pending"
    } else {
        bail!("CLI stdout has neither summary nor test run id");
    };

    Ok(ApexTestRunResult {
        status: status.to_string(),
        test_run_id,
        summary,
        tests,
        coverage,
        raw_stdout: stdout.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/apex_test/fixtures")
            .join(name);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("fixture {}: {}", name, e))
    }

    #[test]
    fn parses_passed_run_with_coverage() {
        let out = parse_apex_test_output(&fixture("passed-with-coverage.json")).unwrap();
        assert_eq!(out.status, "completed");
        assert!(out.test_run_id.starts_with("707"));
        let s = out.summary.unwrap();
        assert_eq!(s.outcome, "Passed");
        assert_eq!(s.tests_ran, 3);
        assert_eq!(s.passing, 3);
        assert_eq!(s.failing, 0);
        assert_eq!(s.skipped, 0);
        // "2456 ms" string → 2456
        assert_eq!(s.test_execution_time_ms, 2456);
        assert_eq!(s.test_run_coverage, Some(24.0));
        assert_eq!(s.org_wide_coverage, Some(45.0));
        assert_eq!(out.tests.len(), 3);
        assert_eq!(out.tests[0].class_name, "AccountServiceSpec");
        assert_eq!(out.tests[0].method_name, "itCreatesAccounts");
        assert_eq!(out.tests[0].outcome, "Pass");
        assert!(out.tests.iter().all(|t| t.message.is_none()));

        let cov = &out.coverage;
        assert_eq!(cov.len(), 2);
        let account = cov.iter().find(|c| c.name == "AccountService").unwrap();
        assert_eq!(account.id, "01pFAKECLASSID003");
        assert_eq!(account.total_lines, 11);
        assert_eq!(account.covered_lines, 10);
        assert_eq!(account.covered_percent, Some(91.0));
        assert_eq!(account.uncovered_lines, vec![42]);
        let trigger = cov.iter().find(|c| c.name == "AccountTrigger").unwrap();
        assert_eq!(trigger.covered_percent, Some(100.0));
        assert!(trigger.uncovered_lines.is_empty());
    }

    /// End-to-end check against a sanitized subset of real sf 2.147.7 output
    /// captured from a sandbox run (fixtures/observed-real-output.json).
    #[test]
    fn parses_observed_real_output() {
        let out = parse_apex_test_output(&fixture("observed-real-output.json")).unwrap();
        assert_eq!(out.status, "completed");
        let s = out.summary.unwrap();
        assert_eq!(s.outcome, "Passed");
        assert_eq!(s.tests_ran, 14);
        assert_eq!(s.test_run_coverage, Some(24.0));
        assert_eq!(s.org_wide_coverage, Some(45.0));
        // "1417 ms" string
        assert_eq!(s.test_execution_time_ms, 1417);
        assert!(!out.tests.is_empty());
        assert!(!out.tests[0].class_name.is_empty());
        assert!(!out.coverage.is_empty());
        for c in &out.coverage {
            assert!(c.total_lines > 0, "{} should have lines", c.name);
            assert!(c.covered_percent.is_some(), "{} should have percent", c.name);
            assert!(
                c.covered_lines + c.uncovered_lines.len() as u32 <= c.total_lines,
                "{} counts must not exceed total",
                c.name
            );
        }
        // Spot-check the first real entry: 66 lines, 32 covered, 34 uncovered.
        let first = &out.coverage[0];
        assert_eq!(first.total_lines, 66);
        assert_eq!(first.covered_lines, 32);
        assert_eq!(first.uncovered_lines.len(), 34);
        assert_eq!(first.covered_percent, Some(48.0));
    }

    #[test]
    fn parses_failed_run_with_stack_trace() {
        let out = parse_apex_test_output(&fixture("failed-with-stack.json")).unwrap();
        assert_eq!(out.status, "completed");
        let s = out.summary.unwrap();
        assert_eq!(s.outcome, "Failed");
        assert_eq!(s.failing, 1);
        assert_eq!(s.passing, 1);
        let failed = out.tests.iter().find(|t| t.outcome == "Fail").unwrap();
        assert_eq!(failed.class_name, "OrderServiceSpec");
        assert_eq!(failed.method_name, "itRejectsBadInput");
        assert!(failed.message.as_deref().unwrap().contains("System.AssertException"));
        assert!(failed
            .stack_trace
            .as_deref()
            .unwrap()
            .contains("Class.OrderServiceSpec"));
        let cov = out.coverage.iter().find(|c| c.name == "OrderService").unwrap();
        assert_eq!(cov.total_lines, 25);
        assert_eq!(cov.covered_lines, 16);
        assert_eq!(cov.covered_percent, Some(64.0));
        assert_eq!(cov.uncovered_lines.len(), 9);
    }

    #[test]
    fn parses_pending_run() {
        let out = parse_apex_test_output(&fixture("pending.json")).unwrap();
        assert_eq!(out.status, "pending");
        assert_eq!(out.test_run_id, "7079z0000AAAAAAA1");
        assert!(out.summary.is_none());
        assert!(out.tests.is_empty());
        assert!(out.coverage.is_empty());
    }

    #[test]
    fn parses_completed_run_without_coverage() {
        let out = parse_apex_test_output(&fixture("completed-no-coverage.json")).unwrap();
        assert_eq!(out.status, "completed");
        assert!(out.coverage.is_empty());
        let s = out.summary.unwrap();
        assert_eq!(s.test_run_coverage, None);
        assert_eq!(s.org_wide_coverage, None);
    }

    #[test]
    fn malformed_json_is_rejected() {
        let out = parse_apex_test_output(&fixture("malformed.json"));
        assert!(out.is_err());
    }

    #[test]
    fn empty_stdout_is_rejected() {
        assert!(parse_apex_test_output("").is_err());
        assert!(parse_apex_test_output("   \n").is_err());
    }

    #[test]
    fn accepts_string_numbers_and_null_fields() {
        let raw = r#"{
            "status": 0,
            "result": {
                "testRunId": "707abc",
                "summary": {
                    "outcome": "Passed",
                    "testsRan": "2",
                    "passing": "2",
                    "failing": "0",
                    "skipped": "0",
                    "testExecutionTimeInMs": "1234",
                    "testRunCoverage": "85%",
                    "orgWideCoverage": null
                },
                "tests": [
                    {
                        "id": null,
                        "ClassName": "FooTest",
                        "NamespacePrefix": null,
                        "MethodName": "t1",
                        "Outcome": "Pass",
                        "RunTime": "88",
                        "Message": null,
                        "StackTrace": null
                    }
                ],
                "codecoverage": [],
                "unknownFutureField": { "x": 1 }
            }
        }"#;
        let out = parse_apex_test_output(raw).unwrap();
        let s = out.summary.unwrap();
        assert_eq!(s.tests_ran, 2);
        assert_eq!(s.test_execution_time_ms, 1234);
        assert_eq!(s.test_run_coverage, Some(85.0));
        assert_eq!(s.org_wide_coverage, None);
        assert_eq!(out.tests.len(), 1);
        assert_eq!(out.tests[0].run_time_ms, 88);
        assert!(out.tests[0].namespace_prefix.is_none());
    }

    #[test]
    fn derives_counts_from_line_arrays_when_missing() {
        let raw = r#"{
            "status": 0,
            "result": {
                "testRunId": "707zz",
                "summary": { "outcome": "Passed", "testsRan": 1, "passing": 1 },
                "tests": [],
                "codecoverage": [
                    {
                        "apexId": "01pAAA",
                        "name": "NoCounts",
                        "type": "ApexClass",
                        "coveredLines": ["1", 3],
                        "uncoveredLines": [2, "4", 4]
                    }
                ]
            }
        }"#;
        let out = parse_apex_test_output(raw).unwrap();
        assert_eq!(out.coverage.len(), 1);
        let c = &out.coverage[0];
        assert_eq!(c.total_lines, 4);
        assert_eq!(c.covered_lines, 2);
        assert_eq!(c.uncovered_lines, vec![2, 4]);
        assert_eq!(c.covered_percent, Some(50.0));
    }

    #[test]
    fn zero_total_lines_has_no_percent() {
        let raw = r#"{
            "status": 0,
            "result": {
                "testRunId": "707q",
                "summary": { "outcome": "Passed", "testsRan": 1, "passing": 1 },
                "tests": [],
                "codecoverage": [
                    { "apexId": "01pB", "name": "Empty", "numLinesCovered": 0, "numLinesUncovered": 0 }
                ]
            }
        }"#;
        let out = parse_apex_test_output(raw).unwrap();
        assert_eq!(out.coverage[0].covered_percent, None);
        assert!(out.coverage[0].uncovered_lines.is_empty());
    }

    #[test]
    fn parses_legacy_coverage_shape() {
        let raw = r#"{
            "status": 0,
            "result": {
                "testRunId": "707lg",
                "summary": { "outcome": "Passed", "testsRan": 1, "passing": 1 },
                "tests": [],
                "coverage": {
                    "coverage": [
                        {
                            "id": "01pC",
                            "name": "Legacy",
                            "totalLines": 3,
                            "coveredLines": 1,
                            "lines": { "1": "1", "2": "0", "3": "0" }
                        }
                    ]
                }
            }
        }"#;
        let out = parse_apex_test_output(raw).unwrap();
        assert_eq!(out.coverage.len(), 1);
        assert_eq!(out.coverage[0].total_lines, 3);
        assert_eq!(out.coverage[0].covered_lines, 1);
        assert_eq!(out.coverage[0].uncovered_lines, vec![2, 3]);
    }
}

#[cfg(test)]
mod e2e_tests {
    use super::*;

    /// Full unsanitized real capture (local only, not committed): set
    /// SFDEVKIT_REAL_TEST_JSON=/tmp/apex-test-real.json to run.
    #[test]
    fn parses_full_real_capture() {
        let path = match std::env::var("SFDEVKIT_REAL_TEST_JSON") {
            Ok(p) if !p.is_empty() => p,
            _ => return, // skip silently when not provided
        };
        let raw = std::fs::read_to_string(&path).expect("real capture file readable");
        let out = parse_apex_test_output(&raw).expect("real output parses");
        assert_eq!(out.status, "completed");
        let s = out.summary.expect("summary present");
        assert_eq!(s.outcome, "Passed");
        assert_eq!(s.tests_ran, 14);
        assert_eq!(s.test_run_coverage, Some(24.0));
        assert_eq!(out.coverage.len(), 21);
        let first = &out.coverage[0];
        assert_eq!(first.total_lines, 66);
        assert_eq!(first.covered_lines, 32);
        assert_eq!(first.covered_percent, Some(48.0));
        assert_eq!(first.uncovered_lines.len(), 34);
    }
}
