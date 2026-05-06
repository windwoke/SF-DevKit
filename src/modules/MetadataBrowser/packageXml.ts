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

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
