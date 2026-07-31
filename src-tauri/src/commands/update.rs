use serde::{Deserialize, Serialize};

const RELEASE_API: &str = "https://api.github.com/repos/windwoke/SF-DevKit/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

/// Fetch the latest public GitHub release. This only checks metadata; it never
/// downloads or installs an app update.
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(concat!("SF-DevKit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("创建更新检查请求失败: {e}"))?;
    let response = client
        .get(RELEASE_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("检查更新失败: GitHub 返回 {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("解析更新信息失败: {e}"))?;
    let current_version = env!("CARGO_PKG_VERSION").to_owned();
    let latest_version = release.tag_name.trim_start_matches('v').to_owned();
    let update_available = version_is_newer(&latest_version, &current_version)?;

    Ok(UpdateInfo {
        current_version,
        latest_version,
        download_url: release.html_url,
        update_available,
    })
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    check_for_update().await
}

fn version_is_newer(candidate: &str, current: &str) -> Result<bool, String> {
    let candidate = parse_version(candidate)?;
    let current = parse_version(current)?;
    let length = candidate.len().max(current.len());
    for index in 0..length {
        let candidate_part = candidate.get(index).copied().unwrap_or_default();
        let current_part = current.get(index).copied().unwrap_or_default();
        if candidate_part != current_part {
            return Ok(candidate_part > current_part);
        }
    }
    Ok(false)
}

fn parse_version(value: &str) -> Result<Vec<u64>, String> {
    let normalized = value.trim_start_matches('v').split('-').next().unwrap_or_default();
    let parts: Result<Vec<_>, _> = normalized.split('.').map(str::parse::<u64>).collect();
    let parts = parts.map_err(|_| format!("无法比较版本号: {value}"))?;
    if parts.is_empty() {
        return Err(format!("无法比较版本号: {value}"));
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::version_is_newer;

    #[test]
    fn compares_semantic_versions() {
        assert!(version_is_newer("v0.7.1", "0.7.0").unwrap());
        assert!(version_is_newer("1.0.0", "0.9.9").unwrap());
        assert!(!version_is_newer("0.7.0", "0.7.0").unwrap());
        assert!(!version_is_newer("0.6.9", "0.7.0").unwrap());
    }
}
