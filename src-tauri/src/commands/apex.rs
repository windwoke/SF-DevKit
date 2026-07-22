use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;

use crate::cli::runner::run_command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompileProblem {
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApexRunResult {
    pub success: bool,
    pub compiled: bool,
    pub compile_problem: Option<CompileProblem>,
    pub exception_message: Option<String>,
    pub exception_stack_trace: Option<String>,
    pub logs: Option<String>,
    pub exit_code: i32,
    pub raw_stdout: String,
}

fn parse_line_col(msg: &str) -> (Option<u32>, Option<u32>) {
    let re = Regex::new(r"line\s+(\d+)[,:\s]*\s*column\s+(\d+)").unwrap();
    if let Some(caps) = re.captures(msg) {
        let line = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
        let col = caps.get(2).and_then(|m| m.as_str().parse::<u32>().ok());
        (line, col)
    } else {
        (None, None)
    }
}

fn parse_apex_output(stdout: &str, exit_code: i32) -> Result<ApexRunResult, String> {
    let parsed: Value =
        serde_json::from_str(stdout).map_err(|e| format!("Failed to parse CLI output: {}", e))?;

    let result = &parsed["result"];
    let success = result["success"].as_bool().unwrap_or(false);
    let compiled = result["compiled"].as_bool().unwrap_or(true);

    let compile_problem = if !compiled {
        let msg = result["compileProblem"]
            .as_str()
            .unwrap_or("Unknown compile error")
            .to_string();
        let (line, column) = parse_line_col(&msg);
        Some(CompileProblem {
            message: msg,
            line,
            column,
        })
    } else {
        None
    };

    let exception_message = result["exceptionMessage"].as_str().map(|s| s.to_string());
    let exception_stack_trace = result["exceptionStackTrace"]
        .as_str()
        .map(|s| s.to_string());
    let logs = result["logs"].as_str().map(|s| s.to_string());

    Ok(ApexRunResult {
        success,
        compiled,
        compile_problem,
        exception_message,
        exception_stack_trace,
        logs,
        exit_code,
        raw_stdout: stdout.to_string(),
    })
}

#[tauri::command]
pub async fn run_apex(org_id: String, code: String) -> Result<ApexRunResult, String> {
    let mut temp = tempfile::Builder::new()
        .suffix(".apex")
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    temp.write_all(code.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    temp.flush()
        .map_err(|e| format!("Failed to flush temp file: {}", e))?;

    let file_path = temp.path().to_string_lossy().to_string();

    let output = run_command(
        &["apex", "run", "--target-org", &org_id, "--file", &file_path],
        true,
    )
    .await
    .map_err(|e| e.to_string())?;

    drop(temp);

    parse_apex_output(&output.stdout, output.exit_code)
}
