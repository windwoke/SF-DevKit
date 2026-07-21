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

/// Windows process creation flag that prevents the child from inheriting
/// (or flashing) a console window. Without it, GUI apps that shell out to
/// `sf` CLI pop a black `cmd.exe` window on every spawn — e.g. the LogViewer
/// polls `sf apex list log` every 10s, which would flash a window each time.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Extension trait that suppresses child console windows on Windows.
/// On non-Windows platforms it is a no-op, so call sites stay portable.
pub trait SuppressConsole {
    fn suppress_console(&mut self) -> &mut Self;
}

impl SuppressConsole for tokio::process::Command {
    #[inline]
    fn suppress_console(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl SuppressConsole for std::process::Command {
    #[inline]
    fn suppress_console(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

/// Common install paths for the `sf` CLI on macOS (Homebrew, npm, sf installer).
const COMMON_SF_PATHS: &[&str] = &[
    "/opt/homebrew/bin/sf",
    "/usr/local/bin/sf",
    "/usr/local/lib/node_modules/@salesforce/cli/bin/sf",
    "/usr/local/bin/sfdx",
    "/opt/homebrew/bin/sfdx",
];

pub fn find_sf() -> Option<PathBuf> {
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

/// Resolve a CLI binary with PATH lookup + macOS hardcoded fallbacks.
/// Useful for bundled macOS apps where user shell PATH is not inherited.
pub fn find_binary(name: &str, macos_fallbacks: &[&str]) -> Option<PathBuf> {
    if let Ok(path) = which::which(name) {
        return Some(path);
    }
    #[cfg(target_os = "macos")]
    {
        for &p in macos_fallbacks {
            let candidate = PathBuf::from(p);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Common macOS fallback paths for VSCode / Cursor editor CLIs.
#[cfg(target_os = "macos")]
const EDITOR_FALLBACKS: &[(&str, &[&str])] = &[
    (
        "code",
        &[
            "/usr/local/bin/code",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        ],
    ),
    (
        "cursor",
        &[
            "/usr/local/bin/cursor",
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
            "/Applications/Cursor.app/Contents/MacOS/Cursor",
        ],
    ),
];

/// Resolve an editor binary (`code`, `cursor`, etc.) with macOS fallbacks.
pub fn find_editor(name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        for (editor, fallbacks) in EDITOR_FALLBACKS {
            if name == *editor {
                return find_binary(name, fallbacks);
            }
        }
    }
    find_binary(name, &[])
}

pub async fn run_command(args: &[&str], force_json: bool) -> anyhow::Result<CliOutput> {
    let sf_path =
        find_sf().ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

    let mut cmd = Command::new(&sf_path);
    cmd.suppress_console();
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
