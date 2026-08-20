//! Orchestration for `sf apex run test` / `sf apex get test`.
//!
//! Run flow (streaming):
//! 1. `run_apex_tests` submits with `--wait 0`, which returns the Test Run ID
//!    immediately, then returns a `pending` result. The frontend can show the
//!    job id + marquee right away.
//! 2. The caller then invokes [`poll_apex_test_result`], which emits Tauri
//!    events (`polling`, `completed`, `failed`) while it polls
//!    `sf apex get test` in the background until the run finishes.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::models::ApexTestRunResult;
use super::result_parser::parse_apex_test_output;

/// Max test classes per single run (mirrors Salesforce test-run limits and
/// keeps the command line sane).
const MAX_CLASSES_PER_RUN: usize = 200;
/// Interval between `sf apex get test` polls while waiting for completion.
const POLL_INTERVAL_SECS: u64 = 5;
/// Give up polling after this many attempts (30 min); the frontend keeps the
/// Test Run ID so the user can still fetch manually.
const MAX_POLL_ATTEMPTS: u32 = 360;

/// Event payload streamed to the frontend during a run (same shape idea as
/// metadata's RetrieveEvent).
#[derive(Debug, Clone, Serialize)]
pub struct ApexTestRunEvent {
    /// "submitted" | "polling" | "completed" | "failed"
    pub event_type: String,
    /// Human-oriented progress text (already i18n-free; frontend decorates).
    pub data: String,
}

/// Build the `--tests` argument list, validating each class name. Allowed:
/// plain `ClassName` or `ns.ClassName`. Rejects whitespace and characters that
/// could smuggle extra CLI flags.
fn validate_class_names(class_names: &[String]) -> anyhow::Result<Vec<String>> {
    if class_names.is_empty() {
        anyhow::bail!("no test classes selected");
    }
    if class_names.len() > MAX_CLASSES_PER_RUN {
        anyhow::bail!(
            "too many test classes selected: {} (max {})",
            class_names.len(),
            MAX_CLASSES_PER_RUN
        );
    }
    let mut cleaned = Vec::with_capacity(class_names.len());
    for name in class_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            anyhow::bail!("empty test class name");
        }
        let valid = !trimmed.starts_with('-')
            && trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
        if !valid {
            anyhow::bail!("invalid test class name: {}", name);
        }
        cleaned.push(trimmed.to_string());
    }
    // The org rejects a class listed twice ("Include the class name X only
    // once") — sort + dedup so callers can't hit it.
    cleaned.sort();
    cleaned.dedup();
    Ok(cleaned)
}

/// Salesforce Ids are alphanumeric only (15 or 18 chars). Anything else is
/// rejected before it can reach the CLI.
fn validate_test_run_id(id: &str) -> anyhow::Result<()> {
    let len_ok = id.len() == 15 || id.len() == 18;
    let chars_ok = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric());
    if !len_ok || !chars_ok {
        anyhow::bail!("invalid test run id: {}", id);
    }
    Ok(())
}

/// Extract the CLI's own error message from a JSON envelope when present.
fn cli_error_message(stdout: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    json.pointer("/error/message")
        .or_else(|| json.get("message"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Run the CLI and parse its stdout into a result. A non-zero exit does not
/// necessarily mean transport failure — failing tests still produce a full
/// structured result — so stdout is parsed first.
async fn run_and_parse(args: &[&str], command_label: &str) -> anyhow::Result<ApexTestRunResult> {
    let output = crate::cli::runner::run_command(args, true).await?;

    match parse_apex_test_output(&output.stdout) {
        Ok(result) => Ok(result),
        Err(_) => {
            let mut parts: Vec<String> = Vec::new();
            if let Some(msg) = cli_error_message(&output.stdout) {
                parts.push(msg);
            } else if !output.stderr.trim().is_empty() {
                parts.push(output.stderr.trim().to_string());
            } else if !output.stdout.trim().is_empty() {
                parts.push(output.stdout.trim().to_string());
            }
            anyhow::bail!("{} failed (exit {}): {}", command_label, output.exit_code, parts.join("; "));
        }
    }
}

/// Submit the selected test classes with `--wait 0`: returns as soon as
/// Salesforce queues the job, carrying the Test Run ID (`status: "pending"`).
pub async fn run_apex_tests(
    org_id: &str,
    class_names: &[String],
) -> anyhow::Result<ApexTestRunResult> {
    let cleaned = validate_class_names(class_names)?;

    let mut args: Vec<&str> = vec!["apex", "run", "test"];
    for class in &cleaned {
        args.push("--tests");
        args.push(class);
    }
    args.extend([
        "--code-coverage",
        "--result-format",
        "json",
        "--wait",
        "0",
        "--target-org",
        org_id,
    ]);

    run_and_parse(&args, "sf apex run test").await
}

/// Fetch the latest state of a test run in one shot (no events).
pub async fn get_apex_test_result(
    org_id: &str,
    test_run_id: &str,
) -> anyhow::Result<ApexTestRunResult> {
    validate_test_run_id(test_run_id)?;
    fetch_result(org_id, test_run_id).await
}

async fn fetch_result(org_id: &str, test_run_id: &str) -> anyhow::Result<ApexTestRunResult> {
    run_and_parse(
        &[
            "apex",
            "get",
            "test",
            "--test-run-id",
            test_run_id,
            "--code-coverage",
            "--result-format",
            "json",
            "--target-org",
            org_id,
        ],
        "sf apex get test",
    )
    .await
}

/// Poll `sf apex get test` in the background, emitting `event_id` events:
/// - `polling` after each attempt (data: attempt count)
/// - `completed` with the final result serialized in `result_json`
/// - `failed` when polling or the CLI errors (data: error message)
///
/// The returned result is the first successful poll if the run was already
/// done; otherwise `pending` and the caller should rely on the events.
pub async fn poll_apex_test_result(
    app: AppHandle,
    org_id: &str,
    test_run_id: &str,
    event_id: &str,
) -> anyhow::Result<ApexTestRunResult> {
    validate_test_run_id(test_run_id)?;
    let org_id = org_id.to_string();
    let test_run_id_owned = test_run_id.to_string();
    let event_id = event_id.to_string();

    // Fast path: the run may already be complete.
    if let Ok(result) = fetch_result(&org_id, &test_run_id_owned).await {
        if result.status == "completed" {
            let _ = app.emit(
                &event_id,
                ApexTestRunEvent {
                    event_type: "completed".to_string(),
                    data: serde_json::to_string(&result).unwrap_or_default(),
                },
            );
            return Ok(result);
        }
    }

    // Background poller: emit progress, finish when the run completes.
    let poll_org = org_id;
    let poll_run_id = test_run_id_owned.clone();
    tokio::spawn(async move {
        for attempt in 1..=MAX_POLL_ATTEMPTS {
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
            let outcome = match fetch_result(&poll_org, &poll_run_id).await {
                Ok(result) if result.status == "completed" => Some((
                    "completed",
                    serde_json::to_string(&result).unwrap_or_default(),
                )),
                // Transient CLI/org hiccups don't kill the poller; only the
                // attempt budget gives up.
                Err(e) if attempt == MAX_POLL_ATTEMPTS => {
                    Some(("failed", e.to_string()))
                }
                Err(_) | Ok(_) => None,
            };
            match outcome {
                Some((event_type, data)) => {
                    let _ = app.emit(
                        &event_id,
                        ApexTestRunEvent {
                            event_type: event_type.to_string(),
                            data,
                        },
                    );
                    return;
                }
                None => {
                    let _ = app.emit(
                        &event_id,
                        ApexTestRunEvent {
                            event_type: "polling".to_string(),
                            data: attempt.to_string(),
                        },
                    );
                }
            }
        }
        // Loop exhausted without completion.
        let _ = app.emit(
            &event_id,
            ApexTestRunEvent {
                event_type: "failed".to_string(),
                data: format!("timed out after {} polls", MAX_POLL_ATTEMPTS),
            },
        );
    });

    Ok(ApexTestRunResult {
        status: "pending".to_string(),
        test_run_id: test_run_id_owned,
        summary: None,
        tests: vec![],
        coverage: vec![],
        raw_stdout: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_selection() {
        assert!(validate_class_names(&[]).is_err());
    }

    #[test]
    fn rejects_too_many_classes() {
        let names: Vec<String> = (0..201).map(|i| format!("C{}", i)).collect();
        assert!(validate_class_names(&names).is_err());
        let ok: Vec<String> = (0..200).map(|i| format!("C{}", i)).collect();
        assert_eq!(validate_class_names(&ok).unwrap().len(), 200);
    }

    #[test]
    fn accepts_plain_and_namespaced_names() {
        let cleaned = validate_class_names(&[
            "FooTest".to_string(),
            "ns.FooTest".to_string(),
            "  Padded  ".to_string(),
        ])
        .unwrap();
        assert_eq!(cleaned.len(), 3);
        assert!(cleaned.contains(&"FooTest".to_string()));
        assert!(cleaned.contains(&"ns.FooTest".to_string()));
        assert!(cleaned.contains(&"Padded".to_string()));
    }

    #[test]
    fn dedups_duplicate_class_names() {
        let cleaned = validate_class_names(&[
            "FooTest".to_string(),
            "FooTest".to_string(),
            "  FooTest  ".to_string(),
            "BarTest".to_string(),
        ])
        .unwrap();
        assert_eq!(cleaned, vec!["BarTest", "FooTest"]);
    }

    #[test]
    fn rejects_flag_like_and_illegal_names() {
        for bad in ["", "  ", "--json", "a b", "Class;rm", "x/y"] {
            assert!(validate_class_names(&[bad.to_string()]).is_err(), "should reject {:?}", bad);
        }
    }

    #[test]
    fn validates_test_run_ids() {
        assert!(validate_test_run_id("7079z00000AAAAA").is_ok()); // 15
        assert!(validate_test_run_id("7079z00000AAAAAAA1").is_ok()); // 18
        for bad in ["", "707", "7079z00000AAAAAAA1!", "a b", "--json", "7079z00000AAAAAAA1AAQQ"] {
            assert!(validate_test_run_id(bad).is_err(), "should reject {:?}", bad);
        }
    }
}
