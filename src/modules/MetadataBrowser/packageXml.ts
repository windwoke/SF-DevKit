export interface PackageSelection {
  metadata_type: string;
  members: string[];
}

export function generatePackageXml(selections: PackageSelection[], apiVersion: string): string {
  if (selections.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${apiVersion}</version>
</Package>`;
  }

  const sorted = [...selections].sort((a, b) => a.metadata_type.localeCompare(b.metadata_type));
  const xmlParts = sorted.map(({ metadata_type, members }) => {
    const membersXml = [...members]
      .sort((a, b) => a.localeCompare(b))
      .map((m) => `        <members>${escapeXml(m)}</members>`)
      .join("\n");
    return `    <types>\n${membersXml}\n        <name>${escapeXml(metadata_type)}</name>\n    </types>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${xmlParts.join("\n")}
    <version>${apiVersion}</version>
</Package>`;
}

export function parsePackageXml(xml: string): PackageSelection[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("XML 语法错误，请检查标签是否闭合。");
  }

  const packageNode = doc.querySelector("Package");
  if (!packageNode) {
    throw new Error("缺少 <Package> 根节点。");
  }

  const types = Array.from(doc.getElementsByTagName("types"));
  const grouped = new Map<string, Set<string>>();
  for (const typeNode of types) {
    const name = typeNode.getElementsByTagName("name")[0]?.textContent?.trim() ?? "";
    if (!name) continue;
    const members = Array.from(typeNode.getElementsByTagName("members"))
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean);
    if (!grouped.has(name)) grouped.set(name, new Set<string>());
    const set = grouped.get(name)!;
    for (const member of members) set.add(member);
  }

  return Array.from(grouped.entries())
    .map(([metadata_type, members]) => ({ metadata_type, members: Array.from(members).sort() }))
    .sort((a, b) => a.metadata_type.localeCompare(b.metadata_type));
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
