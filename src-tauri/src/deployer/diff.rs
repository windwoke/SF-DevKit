use std::path::PathBuf;
use std::process::Stdio;

use chrono::Local;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::models::RetrieveEvent;

fn strip_ansi(text: &str) -> String {
    String::from_utf8(strip_ansi_escapes::strip(text)).unwrap_or_else(|_| text.to_string())
}

/// Create a minimal temp SFDX workspace with a `force-app` package directory.
/// The retrieve output goes to a separate `.sfdevkit-output` dir inside the workspace
/// (relative path, so sf CLI accepts it).
async fn prepare_temp_workspace(event_id: &str) -> anyhow::Result<PathBuf> {
    let workspace =
        std::env::temp_dir().join(format!("sfdevkit-diff-workspace-{}", event_id));
    tokio::fs::create_dir_all(&workspace).await?;
    tokio::fs::create_dir_all(workspace.join("force-app")).await?;
    tokio::fs::create_dir_all(workspace.join(".sfdevkit-output")).await?;
    let project_json = r#"{
  "packageDirectories": [
    { "path": "force-app", "default": true }
  ],
  "namespace": "",
  "sourceApiVersion": "62.0"
}"#;
    tokio::fs::write(workspace.join("sfdx-project.json"), project_json).await?;
    Ok(workspace)
}

/// Retrieve target org content into a reference directory for diff comparison.
pub async fn retrieve_for_diff(
    app: AppHandle,
    org_id: &str,
    working_dir: &str,
    event_id: &str,
) -> anyhow::Result<String> {
    let pkg_xml = format!("{}/package.xml", working_dir);

    let workspace = prepare_temp_workspace(event_id).await?;

    let sf_path = crate::cli::runner::find_sf()
        .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI"))?;

    let mut cmd = Command::new(&sf_path);
    cmd.args([
        "project",
        "retrieve",
        "start",
        "--manifest",
        &pkg_xml,
        "--target-org",
        org_id,
        "--output-dir",
        ".sfdevkit-output",
        "--json",
    ]);
    // Run from temp workspace so sf CLI finds sfdx-project.json
    cmd.current_dir(&workspace);

    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn()?;

    let _ = app.emit(
        event_id,
        RetrieveEvent {
            event_type: "start".to_string(),
            data: "开始 retrieve 目标 Org 内容…".to_string(),
        },
    );

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("无法读取 stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("无法读取 stderr"))?;
    let mut out_lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();

    loop {
        tokio::select! {
            line = out_lines.next_line() => {
                match line? {
                    Some(text) => {
                        let clean = strip_ansi(&text);
                        let _ = app.emit(event_id, RetrieveEvent {
                            event_type: "stdout".to_string(),
                            data: clean,
                        });
                    }
                    None => break,
                }
            }
            line = err_lines.next_line() => {
                if let Some(text) = line? {
                    let clean = strip_ansi(&text);
                    let _ = app.emit(event_id, RetrieveEvent {
                        event_type: "stderr".to_string(),
                        data: clean,
                    });
                }
            }
        }
    }

    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(-1);

    let _ = app.emit(
        event_id,
        RetrieveEvent {
            event_type: "exit".to_string(),
            data: format!("退出码: {}", exit_code),
        },
    );

    if exit_code != 0 {
        let _ = tokio::fs::remove_dir_all(&workspace).await;
        anyhow::bail!("Retrieve 失败，请查看日志");
    }

    // Move retrieved content from temp .sfdevkit-output to a stable reference dir.
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let working_path = PathBuf::from(working_dir);
    let parent = working_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("无法获取工作目录父路径"))?;
    let reference_dir = parent.join(format!("reference-{}", timestamp));
    tokio::fs::create_dir_all(&reference_dir).await?;

    // Same copy logic as metadata retrieve: copy entire .sfdevkit-output contents
    let internal_output = workspace.join(".sfdevkit-output");
    copy_dir_recursive(&internal_output, &reference_dir).await?;

    // Copy package.xml into reference dir
    let _ = tokio::fs::copy(&pkg_xml, reference_dir.join("package.xml")).await;

    // Clean up temp workspace
    let _ = tokio::fs::remove_dir_all(&workspace).await;

    Ok(reference_dir.to_string_lossy().into_owned())
}

/// macOS fallback paths for common diff tools when CLI is not in PATH.
#[cfg(target_os = "macos")]
const BC4_APP_FALLBACK: &str = "/Applications/Beyond Compare.app/Contents/MacOS/bcompare";

/// Open an external diff tool with the given command string.
/// Parses binary + args from the command string to avoid shell quoting issues.
pub async fn open_diff_tool(command: &str) -> anyhow::Result<()> {
    let cmd = command.to_string();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let path_env = std::env::var("PATH").unwrap_or_default();
        let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
        let full_path = if path_env.contains("/opt/homebrew") {
            path_env
        } else {
            format!("{}:{}", extra, path_env)
        };

        let parts = parse_command(&cmd);
        if parts.is_empty() {
            anyhow::bail!("空命令");
        }

        let binary = &parts[0];
        let args = &parts[1..];

        // Try running directly
        let result = std::process::Command::new(binary)
            .args(args)
            .env("PATH", &full_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        match result {
            Ok(_) => return Ok(()),
            Err(e) if is_not_found(&e) => {
                // Binary not found — try macOS app bundle fallbacks
                #[cfg(target_os = "macos")]
                {
                    let fallback_binary = find_fallback_binary(binary);
                    if let Some(fb) = fallback_binary {
                        match std::process::Command::new(&fb)
                            .args(args)
                            .env("PATH", &full_path)
                            .stdin(std::process::Stdio::null())
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .spawn()
                        {
                            Ok(_) => return Ok(()),
                            Err(fe) => anyhow::bail!("Diff 工具启动失败: {}", fe),
                        }
                    }
                }
                anyhow::bail!("未找到 Diff 工具: {}", binary);
            }
            Err(e) => anyhow::bail!("Diff 工具启动失败: {}", e),
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("Diff 工具任务失败: {}", e))??;

    Ok(())
}

/// Parse a command string like `bcompare "/path1" "/path2"` into binary + args.
/// Handles double-quoted arguments.
fn parse_command(cmd: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut i = 0;
    let bytes = cmd.as_bytes();
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' => i += 1,
            b'"' => {
                let start = i + 1;
                let end = cmd[start..].find('"').map(|p| start + p).unwrap_or(cmd.len());
                parts.push(cmd[start..end].to_string());
                i = end + 1;
            }
            b'\'' => {
                let start = i + 1;
                let end = cmd[start..].find('\'').map(|p| start + p).unwrap_or(cmd.len());
                parts.push(cmd[start..end].to_string());
                i = end + 1;
            }
            _ => {
                let start = i;
                while i < bytes.len() && bytes[i] != b' ' && bytes[i] != b'\t' {
                    i += 1;
                }
                parts.push(cmd[start..i].to_string());
            }
        }
    }
    parts
}

fn is_not_found(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::NotFound
}

/// On macOS, if the CLI binary isn't in PATH, try common app bundle locations.
#[cfg(target_os = "macos")]
fn find_fallback_binary(binary: &str) -> Option<&'static str> {
    let fallbacks: &[(&str, &str)] = &[
        ("bcompare", BC4_APP_FALLBACK),
        ("bcomp", BC4_APP_FALLBACK),
        ("code", "/usr/local/bin/code"),
    ];
    for (name, path) in fallbacks {
        if binary == *name && std::path::Path::new(path).exists() {
            return Some(path);
        }
    }
    None
}

async fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> anyhow::Result<()> {
    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(src.clone(), dst.clone())];
    while let Some((from_dir, to_dir)) = stack.pop() {
        tokio::fs::create_dir_all(&to_dir).await?;
        let mut entries = tokio::fs::read_dir(&from_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let src_path = entry.path();
            let dst_path = to_dir.join(entry.file_name());
            if entry.file_type().await?.is_dir() {
                stack.push((src_path, dst_path));
            } else {
                tokio::fs::copy(src_path, dst_path).await?;
            }
        }
    }
    Ok(())
}

async fn dir_has_entries(path: &PathBuf) -> anyhow::Result<bool> {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return Ok(false);
    };
    if !meta.is_dir() {
        return Ok(false);
    }
    let mut entries = tokio::fs::read_dir(path).await?;
    Ok(entries.next_entry().await?.is_some())
}
