use anyhow::Context;

use super::models::ApexClassMeta;

async fn get_org_auth(org_id: &str) -> anyhow::Result<(String, String)> {
    let output = crate::cli::runner::run_command(
        &["org", "display", "--target-org", org_id],
        true,
    )
    .await?;

    if !output.success {
        anyhow::bail!("无法获取 Org 认证信息: {}", output.stderr);
    }

    // sf org display --json output has result.accessToken and result.instanceUrl
    let json: serde_json::Value =
        serde_json::from_str(&output.stdout).context("解析 org display 输出失败")?;

    let result = json
        .get("result")
        .ok_or_else(|| anyhow::anyhow!("org display 输出缺少 result 字段"))?;

    let access_token = result
        .get("accessToken")
        .or_else(|| result.get("access_token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("无法提取 access_token"))?
        .to_string();

    let instance_url = result
        .get("instanceUrl")
        .or_else(|| result.get("instance_url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("无法提取 instanceUrl"))?
        .to_string();

    Ok((access_token, instance_url))
}

pub async fn search_apex_test_classes(
    org_id: &str,
    keyword: &str,
) -> anyhow::Result<Vec<ApexClassMeta>> {
    let (access_token, instance_url) = get_org_auth(org_id).await?;

    // Don't filter by "Test" in the class name — let the user find any class.
    // The SOQL LIKE operator doesn't need manual escaping for single quotes
    // inside urlencoding — we use String.escapeSingleQuotes pattern.
    let escaped = keyword.replace('\'', "\\'");
    let query = format!(
        "SELECT Id, Name FROM ApexClass \
         WHERE Name LIKE '%{}%' \
           AND Status = 'Active' \
         ORDER BY Name LIMIT 20",
        escaped
    );

    let url = format!(
        "{}/services/data/v62.0/tooling/query?q={}",
        instance_url,
        urlencoding::encode(&query)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .context("请求 Salesforce API 失败")?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Tooling API 请求失败 ({}): {}", status, body);
    }

    let resp: serde_json::Value = resp
        .json()
        .await
        .context("解析 API 响应失败")?;

    // Check for API error
    if let Some(err) = resp.get(0).and_then(|v| v.get("message")) {
        anyhow::bail!("Tooling API 错误: {}", err);
    }

    let classes = resp["records"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    // Prefer classes that have test methods (SymbolTable.methods with @IsTest)
                    let name = v.get("Name").and_then(|v| v.as_str())?;
                    let id = v.get("Id").and_then(|v| v.as_str())?;
                    Some(ApexClassMeta {
                        id: id.to_string(),
                        name: name.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(classes)
}
