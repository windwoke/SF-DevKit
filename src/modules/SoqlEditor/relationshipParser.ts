/**
 * Resolve SOQL relationship path to terminal SObject for field completion.
 * See SOQL-Completion-Design.md §4.
 */

export interface FieldMeta {
  api_name: string;
  label: string;
  field_type: string;
  reference_to: string | null;
  relationship_name?: string | null;
  is_nillable?: boolean;
}

export interface RelationshipSegment {
  name: string;
  resolvedObject: string;
}

export interface ParsedRelationshipPath {
  segments: RelationshipSegment[];
  terminalObject: string;
  isValid: boolean;
}

function resolvePolymorphicTarget(referenceToStr: string): string {
  const targets = referenceToStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (targets.length === 1) return targets[0];
  const nonGroup = targets.find((t) => t !== "Group");
  if (nonGroup) return nonGroup;
  return targets[0];
}

export async function parseRelationshipPath(
  _orgId: string,
  fromObject: string,
  path: string[],
  getFieldsFn: (orgId: string, obj: string) => Promise<FieldMeta[]>,
): Promise<ParsedRelationshipPath> {
  if (path.length === 0) {
    return { segments: [], terminalObject: fromObject, isValid: true };
  }

  const segments: RelationshipSegment[] = [];
  let currentObject = fromObject;

  for (const relName of path) {
    const fields = await getFieldsFn(_orgId, currentObject);
    const relField = fields.find(
      (f) =>
        f.field_type === "REFERENCE" &&
        f.relationship_name?.toLowerCase() === relName.toLowerCase() &&
        f.reference_to,
    );

    if (!relField?.reference_to) {
      return { segments, terminalObject: currentObject, isValid: false };
    }

    const resolvedObject = resolvePolymorphicTarget(relField.reference_to);
    segments.push({ name: relName, resolvedObject });
    currentObject = resolvedObject;
  }

  return { segments, terminalObject: currentObject, isValid: true };
}
