//! Deploy-time manifest normalization.
//!
//! Salesforce Metadata API only accepts certain "child" component types as
//! members of their parent type in `package.xml`, not as top-level `<types>`.
//! When a user authors a manifest with child types listed directly (e.g.
//! `WorkflowFieldUpdate`, `WorkflowTask`), `sf project deploy start` fails
//! with errors like "命名字段更新操作在包里... 部署报错".
//!
//! This module reads the user's manifest, folds any child type into its
//! parent (using the referenced parent's fullName), and returns a new
//! manifest string for use as the deploy-time manifest. When no child types
//! are present, [`normalize_manifest`] returns `None` so callers can skip
//! writing a temp file entirely.

/// Maps a child metadata type → its parent type that the Metadata API
/// accepts in `package.xml`.
///
/// Source: Salesforce Metadata API > Supported Metadata Types.
/// Workflow sub-components are the well-known offenders. Each `Workflow*`
/// child lives inside `*.workflow` so in package.xml it must be referenced
/// as `<type><name>Workflow</name>` with the workflow's fullName as member.
const CHILD_TO_PARENT: &[(&str, &str)] = &[
    ("WorkflowAlert", "Workflow"),
    ("WorkflowFieldUpdate", "Workflow"),
    ("WorkflowKnowledgePublish", "Workflow"),
    ("WorkflowOutboundMessage", "Workflow"),
    ("WorkflowSend", "Workflow"),
    ("WorkflowTask", "Workflow"),
    ("WorkflowFlowAction", "Workflow"),
    ("ApprovalStep", "ApprovalProcess"),
    ("AssignmentRule", "AssignmentRules"),
    ("AutoResponseRule", "AutoResponseRules"),
    ("EscalationRule", "EscalationRules"),
    ("MatchingRule", "MatchingRules"),
    ("SharingOwnerRule", "SharingRules"),
    ("SharingCriteriaRule", "SharingRules"),
    ("SharingGuestRule", "SharingRules"),
    ("SharingTerritoryRule", "SharingRules"),
];

fn parent_of(child: &str) -> Option<&'static str> {
    CHILD_TO_PARENT
        .iter()
        .find(|(c, _)| *c == child)
        .map(|(_, p)| *p)
}

#[derive(Debug, Default)]
struct TypeBlock {
    name: Option<String>,
    members: Vec<String>,
}

/// Parse a manifest string into a list of `<types>` blocks plus a version
/// string. Uses a tiny hand-rolled scanner — package.xml is regular enough
/// that we don't want to pull in a full XML crate.
fn parse_manifest(xml: &str) -> Option<(Vec<TypeBlock>, String)> {
    let mut blocks: Vec<TypeBlock> = Vec::new();
    let mut current: Option<TypeBlock> = None;
    let mut version = String::from("62.0");

    let mut chars = xml.char_indices().peekable();
    let bytes = xml.as_bytes();
    while let Some((i, c)) = chars.next() {
        if c != '<' {
            continue;
        }
        // Collect the tag name (until ' ', '>', or '?'). Note: '/' is
        // intentionally NOT a terminator here — it must be allowed inside
        // tag_full so that closing tags (`</members>`) yield tag_full =
        // "/members" and self-closing tags (`<foo/>`) yield "foo/".
        let mut end = i + 1;
        while end < bytes.len() && !matches!(bytes[end], b' ' | b'>' | b'?' | b'\t' | b'\n' | b'\r')
        {
            end += 1;
        }
        let tag_full = &xml[i + 1..end];
        // tag_full may start with '/' for closing tags
        let (closing, tag) = if let Some(rest) = tag_full.strip_prefix('/') {
            (true, rest)
        } else {
            (false, tag_full)
        };

        // Find the '>' for this tag (handles attributes only minimally — our
        // tags have no attributes besides the root)
        let mut j = end;
        while j < bytes.len() && bytes[j] != b'>' {
            j += 1;
        }
        // j points at '>'; content starts at j+1
        let content_start = j + 1;

        match tag {
            "types" => {
                if !closing {
                    current = Some(TypeBlock::default());
                } else if let Some(block) = current.take() {
                    blocks.push(block);
                }
            }
            "name" if !closing => {
                let close = xml[content_start..].find("</name>")?;
                let value = xml[content_start..content_start + close].trim().to_string();
                if let Some(b) = current.as_mut() {
                    b.name = Some(value);
                }
            }
            "members" if !closing => {
                let close = xml[content_start..].find("</members>")?;
                let value = xml[content_start..content_start + close].trim().to_string();
                if let Some(b) = current.as_mut() {
                    b.members.push(value);
                }
            }
            "version" if !closing => {
                let close = xml[content_start..].find("</version>")?;
                let value = xml[content_start..content_start + close].trim().to_string();
                if !value.is_empty() {
                    version = value;
                }
            }
            _ => {}
        }
    }

    Some((blocks, version))
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Normalize a manifest. Returns `None` if no child types were detected
/// (i.e. the original manifest is already deploy-safe).
///
/// When child types are present, they are merged into their parent type:
///
/// ```text
/// <types>
///   <members>ReturnApply__c.StatusComplete</members>
///   <name>WorkflowFieldUpdate</name>
/// </types>
/// ```
///
/// becomes (when merged into the existing `Workflow` block, or a new one if
/// none exists):
///
/// ```text
/// <types>
///   <members>ReturnApply__c</members>
///   <name>Workflow</name>
/// </types>
/// ```
///
/// **Important**: when a child type references a parent (e.g.
/// `ReturnApply__c.StatusComplete`), the parent fullName is the part before
/// the first dot — the rest identifies the specific rule inside the parent
/// file and is not part of the package.xml member name.
pub fn normalize_manifest(orig: &str) -> Option<String> {
    let (blocks, version) = parse_manifest(orig)?;

    let mut had_child = false;
    // parent_name → Vec<member>
    let mut merged: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    // Preserve original parent ordering: collect parent names in the order
    // they first appear in `blocks`.
    let mut parent_order: Vec<String> = Vec::new();
    // Track parents that came from explicit (already-correct) blocks so we
    // don't lose their members.
    for b in &blocks {
        let Some(name) = &b.name else {
            continue;
        };
        match parent_of(name) {
            Some(parent) => {
                had_child = true;
                for m in &b.members {
                    let parent_member = m.split('.').next().unwrap_or(m).to_string();
                    let entry = merged.entry(parent.to_string()).or_default();
                    if !entry.contains(&parent_member) {
                        entry.push(parent_member);
                    }
                    if !parent_order.iter().any(|p| p == parent) {
                        parent_order.push(parent.to_string());
                    }
                }
            }
            None => {
                let entry = merged.entry(name.clone()).or_default();
                for m in &b.members {
                    if !entry.contains(m) {
                        entry.push(m.clone());
                    }
                }
                if !parent_order.iter().any(|p| p == name) {
                    parent_order.push(name.clone());
                }
            }
        }
    }

    if !had_child {
        return None;
    }

    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
"#,
    );

    // Sort parents alphabetically for deterministic output, but keep all.
    let mut sorted_parents: Vec<&String> = merged.keys().collect();
    sorted_parents.sort();
    for parent in sorted_parents {
        let members = merged.get(parent).unwrap();
        if members.is_empty() {
            continue;
        }
        let mut sorted = members.clone();
        sorted.sort();
        out.push_str("    <types>\n");
        for m in sorted {
            out.push_str("        <members>");
            out.push_str(&escape_xml(&m));
            out.push_str("</members>\n");
        }
        out.push_str("        <name>");
        out.push_str(&escape_xml(parent));
        out.push_str("</name>\n");
        out.push_str("    </types>\n");
    }

    out.push_str("    <version>");
    out.push_str(&version);
    out.push_str("</version>\n</Package>");
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_child_types_returns_none() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>ReturnApply__c</members>
        <name>Workflow</name>
    </types>
    <version>62.0</version>
</Package>"#;
        assert!(normalize_manifest(xml).is_none());
    }

    #[test]
    fn folds_workflow_field_update_into_workflow() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>ReturnApply__c.StatusComplete</members>
        <members>Other__c.SomeUpdate</members>
        <name>WorkflowFieldUpdate</name>
    </types>
    <types>
        <members>ReturnApply__c</members>
        <name>CustomObject</name>
    </types>
    <version>62.0</version>
</Package>"#;
        let out = normalize_manifest(xml).expect("should produce normalized manifest");
        // Workflow block exists with both parent objects deduped
        assert!(out.contains("<members>ReturnApply__c</members>"));
        assert!(out.contains("<members>Other__c</members>"));
        assert!(out.contains("<name>Workflow</name>"));
        // WorkflowFieldUpdate gone
        assert!(!out.contains("WorkflowFieldUpdate"));
        // CustomObject preserved
        assert!(out.contains("<name>CustomObject</name>"));
        // Version preserved
        assert!(out.contains("<version>62.0</version>"));
    }

    #[test]
    fn merges_into_existing_workflow_block() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>ReturnApply__c</members>
        <name>Workflow</name>
    </types>
    <types>
        <members>ReturnApply__c.StatusComplete</members>
        <name>WorkflowFieldUpdate</name>
    </types>
    <version>61.0</version>
</Package>"#;
        let out = normalize_manifest(xml).expect("should produce normalized manifest");
        // Only one Workflow block (count occurrences of <name>Workflow</name>)
        let count = out.matches("<name>Workflow</name>").count();
        assert_eq!(count, 1, "should merge into single Workflow block");
        // Member preserved (no duplicate)
        let member_count = out.matches("<members>ReturnApply__c</members>").count();
        assert_eq!(member_count, 1);
        assert!(out.contains("<version>61.0</version>"));
    }
}
