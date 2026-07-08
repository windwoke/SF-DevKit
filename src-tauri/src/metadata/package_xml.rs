use crate::metadata::models::SelectionItem;

/// Salesforce metadata API 的 child types（来自父类型的 `childXmlNames`）。
/// 大部分 child types 可以独立 retrieve/deploy（如 `CustomField`），但下面
/// 这些**不能**作为 `package.xml` 顶级 type — deploy 时必须用父类型，
/// 否则该类型会被 Salesforce 静默忽略，依赖它的元数据（如 ApprovalProcess
/// 引用 Workflow FieldUpdate）会报「不存在」错误。
///
/// 例如用户在 retrieve 时只选了 `WorkflowFieldUpdate: ReturnApply__c.StatusComplete`，
/// sf CLI 拉到的 `workflows/ReturnApply__c.workflow` 只含这一个 fieldUpdate。
/// 但保存给用户 deploy 用的 package.xml 必须写：
///   <types><members>ReturnApply__c</members><name>Workflow</name></types>
const CHILD_TYPE_TO_PARENT: &[(&str, &str)] = &[
    // Workflow 子组件
    ("WorkflowFieldUpdate", "Workflow"),
    ("WorkflowAlert", "Workflow"),
    ("WorkflowTask", "Workflow"),
    ("WorkflowOutboundMessage", "Workflow"),
    ("WorkflowRule", "Workflow"),
    ("WorkflowSend", "Workflow"),
    ("WorkflowKnowledgePublish", "Workflow"),
    ("WorkflowFlowAction", "Workflow"),
    // SharingRules 子组件
    ("SharingCriteriaRule", "SharingRules"),
    ("SharingOwnerRule", "SharingRules"),
    ("SharingTerritoryRule", "SharingRules"),
];

fn parent_type_for(child_type: &str) -> Option<&'static str> {
    CHILD_TYPE_TO_PARENT
        .iter()
        .find(|(child, _)| *child == child_type)
        .map(|(_, parent)| *parent)
}

/// 把 selections 中需要父类型 deploy 的子组件合并到父类型。
/// 例如 `WorkflowFieldUpdate: [ReturnApply__c.StatusComplete]` →
///      `Workflow: [ReturnApply__c]`。
fn normalize_for_deploy(selections: &[SelectionItem]) -> Vec<SelectionItem> {
    use std::collections::HashMap;

    let mut merged: HashMap<String, Vec<String>> = HashMap::new();
    for item in selections {
        let target_type = parent_type_for(&item.metadata_type)
            .map(str::to_string)
            .unwrap_or_else(|| item.metadata_type.clone());

        let entry = merged.entry(target_type).or_default();
        for m in &item.members {
            // "ReturnApply__c.StatusComplete" → "ReturnApply__c"
            let parent_member = m.split('.').next().unwrap_or(m).to_string();
            if !entry.contains(&parent_member) {
                entry.push(parent_member);
            }
        }
    }

    let mut out: Vec<SelectionItem> = merged
        .into_iter()
        .map(|(metadata_type, mut members)| {
            members.sort();
            SelectionItem {
                metadata_type,
                members,
            }
        })
        .collect();
    out.sort_by(|a, b| a.metadata_type.cmp(&b.metadata_type));
    out
}

pub fn generate_package_xml(selections: &[SelectionItem], api_version: &str) -> String {
    generate_xml(selections, api_version)
}

/// 生成 deploy 用的 package.xml：子类型合并到父类型，确保 Salesforce 能正确部署。
pub fn generate_deploy_package_xml(selections: &[SelectionItem], api_version: &str) -> String {
    let normalized = normalize_for_deploy(selections);
    generate_xml(&normalized, api_version)
}

fn generate_xml(selections: &[SelectionItem], api_version: &str) -> String {
    if selections.is_empty() {
        return format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>{}</version>
</Package>"#,
            api_version
        );
    }

    let mut sorted = selections.to_vec();
    sorted.sort_by(|a, b| a.metadata_type.cmp(&b.metadata_type));

    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
"#,
    );

    for item in sorted {
        if item.members.is_empty() {
            continue;
        }
        let mut members = item.members.clone();
        members.sort();
        out.push_str("    <types>\n");
        for m in members {
            out.push_str("        <members>");
            out.push_str(&escape_xml(&m));
            out.push_str("</members>\n");
        }
        out.push_str("        <name>");
        out.push_str(&escape_xml(&item.metadata_type));
        out.push_str("</name>\n");
        out.push_str("    </types>\n");
    }

    out.push_str("    <version>");
    out.push_str(api_version);
    out.push_str("</version>\n</Package>");
    out
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
