//! Resolve the same tool PATH for discovery, execution, and environment checks.
//! GUI applications do not inherit the interactive shell's version-manager setup.
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static PATH_CACHE: Mutex<Option<(Instant, OsString)>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(300);

pub fn runtime_path() -> OsString {
    resolve_path(false)
}

pub fn refresh_runtime_path() -> OsString {
    resolve_path(true)
}

fn resolve_path(refresh: bool) -> OsString {
    let mut cache = PATH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if !refresh {
        if let Some((created, path)) = cache.as_ref() {
            if created.elapsed() < CACHE_TTL {
                return path.clone();
            }
        }
    }
    let path = build_path();
    *cache = Some((Instant::now(), path.clone()));
    path
}

fn build_path() -> OsString {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let mut sources = Vec::new();
    #[cfg(unix)]
    {
        let shell = std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute() && p.is_file())
            .unwrap_or_else(|| {
                PathBuf::from(if cfg!(target_os = "macos") {
                    "/bin/zsh"
                } else {
                    "/bin/sh"
                })
            });
        if let Some(path) = shell_path(&shell, Duration::from_secs(5)) {
            sources.push(path);
        }
    }
    sources.push(inherited.clone());
    #[cfg(unix)]
    {
        for key in [
            "NVM_BIN",
            "VOLTA_HOME",
            "ASDF_DATA_DIR",
            "FNM_MULTISHELL_PATH",
        ] {
            if let Some(value) = std::env::var_os(key) {
                let path = PathBuf::from(value);
                sources.push(
                    match key {
                        "VOLTA_HOME" | "FNM_MULTISHELL_PATH" => path.join("bin"),
                        "ASDF_DATA_DIR" => path.join("shims"),
                        _ => path,
                    }
                    .into_os_string(),
                );
            }
        }
        if let Some(home) = std::env::var_os("HOME") {
            for relative in [
                ".volta/bin",
                ".asdf/shims",
                ".local/share/mise/shims",
                ".local/bin",
            ] {
                sources.push(PathBuf::from(&home).join(relative).into_os_string());
            }
        }
        sources.push(OsString::from(
            "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        ));
    }
    merge_paths(&sources).unwrap_or(inherited)
}

fn merge_paths(sources: &[OsString]) -> Option<OsString> {
    let mut seen = HashSet::new();
    let paths = sources
        .iter()
        .flat_map(std::env::split_paths)
        .filter(|path| {
            // Never implicitly search the app's current working directory.
            path.is_absolute() && seen.insert(path.clone())
        });
    std::env::join_paths(paths).ok()
}

pub fn find_on_path(name: &str, path: &OsStr) -> Option<PathBuf> {
    which::which_in(name, Some(path), std::env::current_dir().ok()?).ok()
}

#[cfg(unix)]
fn parse_shell_path(output: &str) -> Option<OsString> {
    let (_, tail) = output.rsplit_once("\u{1e}SF_DEVKIT_PATH\u{1f}")?;
    let path = tail.split('\u{1e}').next()?.trim_end_matches(['\r', '\n']);
    (!path.is_empty()).then(|| OsString::from(path))
}

#[cfg(unix)]
fn shell_path(shell: &Path, timeout: Duration) -> Option<OsString> {
    use std::io::{Read, Seek, SeekFrom};
    use std::process::{Command, Stdio};

    // A file avoids deadlocking on verbose shell startup scripts. Mark the value
    // so banners and prompt integrations cannot be mistaken for PATH entries.
    let mut output = tempfile::tempfile().ok()?;
    let mut child = Command::new(shell)
        .args(["-ilc", "printf '\\036SF_DEVKIT_PATH\\037'; /usr/bin/printenv PATH; printf '\\036SF_DEVKIT_END\\037'"])
        .stdin(Stdio::null())
        .stdout(Stdio::from(output.try_clone().ok()?))
        .stderr(Stdio::null())
        .spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    output.seek(SeekFrom::Start(0)).ok()?;
    let mut text = String::new();
    output.take(1024 * 1024).read_to_string(&mut text).ok()?;
    parse_shell_path(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_each_directory_even_when_homebrew_is_already_present() {
        let sources = [
            OsString::from("/opt/homebrew/sbin:/custom/node/bin"),
            OsString::from("/usr/bin:/bin"),
            OsString::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin"),
        ];
        #[cfg(unix)]
        assert_eq!(
            merge_paths(&sources).unwrap(),
            "/opt/homebrew/sbin:/custom/node/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin"
        );
    }

    #[cfg(unix)]
    #[test]
    fn ignores_shell_banners_and_empty_or_relative_paths() {
        assert_eq!(
            parse_shell_path("welcome\n\u{1e}SF_DEVKIT_PATH\u{1f}/node/bin:/usr/bin\n").unwrap(),
            "/node/bin:/usr/bin"
        );
        assert!(parse_shell_path("welcome\n").is_none());
        assert_eq!(
            parse_shell_path("\u{1e}SF_DEVKIT_PATH\u{1f}/node/bin:/usr/bin\n\u{1e}SF_DEVKIT_END\u{1f}logout banner").unwrap(),
            "/node/bin:/usr/bin"
        );
        assert_eq!(
            merge_paths(&[OsString::from(":.:/usr/bin:relative:/usr/bin")]).unwrap(),
            "/usr/bin"
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovered_path_finds_cli_and_its_node_interpreter() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let node_dir = dir.path().join("nvm version/bin");
        let cli_dir = dir.path().join("cli/bin");
        std::fs::create_dir_all(&node_dir).unwrap();
        std::fs::create_dir_all(&cli_dir).unwrap();
        for (file, text) in [
            (node_dir.join("node"), "#!/bin/sh\nprintf 'v24.18.0\\n'\n"),
            (cli_dir.join("sf"), "#!/usr/bin/env node\n"),
        ] {
            std::fs::write(&file, text).unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let shell = dir.path().join("shell");
        std::fs::write(
            &shell,
            format!(
                "#!/bin/sh\nprintf 'banner\\n\\036SF_DEVKIT_PATH\\037%s\\n' '{}'\n",
                std::env::join_paths([&node_dir, &cli_dir])
                    .unwrap()
                    .to_string_lossy()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let recovered = shell_path(&shell, Duration::from_secs(5)).unwrap();
        let path = merge_paths(&[recovered, OsString::from("/usr/bin:/bin")]).unwrap();
        let sf = find_on_path("sf", &path).unwrap();
        let output = std::process::Command::new(sf)
            .env("PATH", path)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "v24.18.0");
    }

    #[cfg(unix)]
    #[test]
    fn shell_startup_has_a_deadline() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("slow-shell");
        std::fs::write(&shell, "#!/bin/sh\nexec /bin/sleep 10\n").unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let start = Instant::now();
        assert!(shell_path(&shell, Duration::from_millis(50)).is_none());
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_interactive_zsh_configuration_from_a_minimal_gui_path() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("gui-shell");
        // Isolate startup configuration; do not modify the user's shell files.
        std::fs::write(
            dir.path().join(".zshrc"),
            "export PATH='/test/nvm/node/bin:/usr/bin:/bin'\n",
        )
        .unwrap();
        std::fs::write(
            &shell,
            format!(
                "#!/bin/sh\nexec /usr/bin/env PATH=/usr/bin:/bin ZDOTDIR='{}' /bin/zsh \"$@\"\n",
                dir.path().display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = shell_path(&shell, Duration::from_secs(5)).unwrap();
        assert_eq!(path, "/test/nvm/node/bin:/usr/bin:/bin");
    }
}
