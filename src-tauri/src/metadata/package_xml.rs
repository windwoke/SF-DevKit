use crate::metadata::models::SelectionItem;

pub fn generate_package_xml(selections: &[SelectionItem], api_version: &str) -> String {
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
