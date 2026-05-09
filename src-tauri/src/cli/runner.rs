use std::path::PathBuf;
use std::process::Stdio;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

/// Common install paths for the `sf` CLI on macOS (Homebrew, npm, sf installer).
const COMMON_SF_PATHS: &[&str] = &[
    "/opt/homebrew/bin/sf",
    "/usr/local/bin/sf",
    "/usr/local/lib/node_modules/@salesforce/cli/bin/sf",
    "/usr/local/bin/sfdx",
    "/opt/homebrew/bin/sfdx",
];

fn find_sf() -> Option<PathBuf> {
    // 1. Try PATH lookup first (works in dev mode).
    if let Ok(path) = which::which("sf") {
        return Some(path);
    }
    if let Ok(path) = which::which("sfdx") {
        return Some(path);
    }
    // 2. Fallback: check common install paths (for bundled macOS app).
    for &p in COMMON_SF_PATHS {
        let candidate = PathBuf::from(p);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub async fn run_command(args: &[&str], force_json: bool) -> anyhow::Result<CliOutput> {
    let sf_path = find_sf()
        .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

    let mut cmd = Command::new(&sf_path);
    cmd.args(args);
    if force_json {
        cmd.arg("--json");
    }

    // Bundle macOS GUI apps lack user shell PATH – inject common Homebrew paths.
    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("failed to capture stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("failed to capture stderr"))?;

    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    loop {
        tokio::select! {
            line = stdout_lines.next_line() => {
                match line? {
                    Some(l) => {
                        stdout_buf.push_str(&l);
                        stdout_buf.push('\n');
                    }
                    None => break,
                }
            }
            line = stderr_lines.next_line() => {
                if let Some(l) = line? {
                    stderr_buf.push_str(&l);
                    stderr_buf.push('\n');
                }
            }
        }
    }

    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(-1);
    Ok(CliOutput {
        stdout: stdout_buf,
        stderr: stderr_buf,
        exit_code,
        success: exit_code == 0,
    })
}
