/**
 * SOQL completion context — aligned with SOQL-Completion-Design.md
 */

export type ClauseType =
  | "SELECT"
  | "FROM"
  | "WHERE"
  | "ORDER_BY"
  | "GROUP_BY"
  | "HAVING"
  | "LIMIT"
  | "OFFSET"
  | "SUBQUERY_SELECT"
  | "SUBQUERY_FROM"
  | "UNKNOWN";

export type TriggerKind =
  | "FIELD"
  | "OBJECT"
  | "OPERATOR"
  | "VALUE"
  | "RELATIONSHIP_FIELD"
  | "RELATIONSHIP_PREFIX"
  | "AGGREGATE"
  | "KEYWORD"
  | "SUBQUERY";

export interface CompletionContext {
  clause: ClauseType;
  primaryObject: string | null;
  subquery?: {
    childRelationshipName: string | null;
    childObject: string | null;
  };
  relationshipPath: string[];
  prevToken: string | null;
  whereField: string | null;
  whereOperator: string | null;
  triggerKind: TriggerKind;
}

function parenDepthBefore(s: string, pos: number): number {
  let d = 0;
  for (let i = 0; i < pos; i++) {
    const c = s[i];
    if (c === "(") d++;
    else if (c === ")") d--;
  }
  return d;
}

/** Last `FROM Obj` at paren depth 0 (main query). */
export function extractFromObject(soql: string): string | null {
  const re = /\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(soql)) !== null) {
    if (parenDepthBefore(soql, m.index) === 0) last = m[1];
  }
  return last;
}

/** Text between SELECT and the first ` FROM ` at depth 0 (field list of main SELECT). */
function extractMainSelectListRaw(soql: string): string {
  const u = soql.toUpperCase();
  const selectIdx = u.indexOf("SELECT");
  if (selectIdx === -1) return "";
  let fromIdx = -1;
  const fromRe = /\bFROM\b/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fromRe.exec(soql)) !== null) {
    if (parenDepthBefore(soql, fm.index) === 0) {
      fromIdx = fm.index;
      break;
    }
  }
  if (fromIdx === -1) return soql.slice(selectIdx + 6);
  return soql.slice(selectIdx + 6, fromIdx);
}

/**
 * Relationship path for cursor at end of `soqlBefore`.
 * Uses the last comma-separated expression in the main SELECT list.
 */
export function extractRelationshipPath(soqlBefore: string): string[] {
  const listRaw = extractMainSelectListRaw(soqlBefore);
  const segments = listRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return [];
  const lastExpr = segments[segments.length - 1];
  if (!lastExpr.includes(".")) return [];
  const parts = lastExpr.split(".").filter(Boolean);
  const lastExprClosed = lastExpr.trimEnd().endsWith(".");
  if (lastExprClosed) return parts;
  return parts.slice(0, -1);
}

function findInnermostOpenSubquery(soql: string): { inner: string; parenIdx: number } | null {
  let depth = 0;
  let subStart = -1;
  for (let i = soql.length - 1; i >= 0; i--) {
    const c = soql[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) {
        subStart = i;
        break;
      }
      depth--;
    }
  }
  if (subStart === -1) return null;
  const inner = soql.slice(subStart + 1);
  if (!/^\s*SELECT\b/i.test(inner)) return null;
  return { inner, parenIdx: subStart };
}

function parseSubqueryContext(soql: string): CompletionContext | null {
  const found = findInnermostOpenSubquery(soql);
  if (!found) return null;
  const { inner } = found;
  const innerU = inner.toUpperCase();
  const fromInInner = /\bFROM\b/i.exec(inner);
  if (fromInInner && innerU.trimEnd().endsWith("FROM")) {
    return {
      clause: "SUBQUERY_FROM",
      primaryObject: extractFromObject(soql),
      relationshipPath: [],
      prevToken: null,
      whereField: null,
      whereOperator: null,
      triggerKind: "OBJECT",
      subquery: { childRelationshipName: null, childObject: null },
    };
  }
  if (!fromInInner) {
    return {
      clause: "SUBQUERY_SELECT",
      primaryObject: extractFromObject(soql),
      relationshipPath: [],
      prevToken: null,
      whereField: null,
      whereOperator: null,
      triggerKind: "FIELD",
      subquery: { childRelationshipName: null, childObject: null },
    };
  }
  return null;
}

function getLastMatchIndex(input: string, regex: RegExp): number {
  let index = -1;
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(input)) !== null) {
    index = m.index;
  }
  return index;
}

export function detectClause(soql: string): ClauseType {
  const u = soql.toUpperCase();
  const entries: Array<{ regex: RegExp; type: ClauseType }> = [
    { regex: /\bOFFSET\b/g, type: "OFFSET" },
    { regex: /\bLIMIT\b/g, type: "LIMIT" },
    { regex: /\bHAVING\b/g, type: "HAVING" },
    { regex: /\bORDER\s+BY\b/g, type: "ORDER_BY" },
    { regex: /\bGROUP\s+BY\b/g, type: "GROUP_BY" },
    { regex: /\bWHERE\b/g, type: "WHERE" },
    { regex: /\bFROM\b/g, type: "FROM" },
    { regex: /\bSELECT\b/g, type: "SELECT" },
  ];
  let best = -1;
  let bestType: ClauseType = "UNKNOWN";
  for (const { regex, type } of entries) {
    const idx = getLastMatchIndex(u, regex);
    if (idx > best) {
      best = idx;
      bestType = type;
    }
  }
  return bestType;
}

export function extractWhereContext(soql: string): { whereField: string | null; whereOperator: string | null } {
  const whereMatch = /\bWHERE\b/gi;
  let m: RegExpExecArray | null;
  let whereIdx = -1;
  while ((m = whereMatch.exec(soql)) !== null) {
    whereIdx = m.index;
  }
  if (whereIdx === -1) return { whereField: null, whereOperator: null };

  const after = soql.slice(whereIdx + "WHERE".length);
  const parts = after.split(/\b(?:AND|OR)\b/i);
  const last = (parts[parts.length - 1] ?? "").trimStart();

  const withOp = last.trimEnd().match(
    /^([A-Za-z0-9_.]+)\s*(=|!=|<>|>=|<=|>|<|LIKE|NOT\s+LIKE|IN|NOT\s+IN|INCLUDES|EXCLUDES)\s*(.*)$/i,
  );
  if (withOp) {
    const field = withOp[1].toUpperCase();
    const op = withOp[2];
    const rest = (withOp[3] ?? "").trim();
    if (rest === "") {
      return { whereField: field, whereOperator: op };
    }
    return { whereField: field, whereOperator: null };
  }

  const fieldOnly = last.match(/^([A-Za-z0-9_.]+)\s+$/);
  if (fieldOnly) {
    return { whereField: fieldOnly[1].toUpperCase(), whereOperator: null };
  }

  return { whereField: null, whereOperator: null };
}

function getLastToken(soql: string): string | null {
  const trimmed = soql.trimEnd();
  const m = trimmed.match(/([A-Za-z0-9_.]+)\s*$/);
  return m ? m[1].toUpperCase() : null;
}

function detectTriggerKind(
  soql: string,
  clause: ClauseType,
  relationshipPath: string[],
): TriggerKind {
  if (soql.endsWith(".") && relationshipPath.length > 0) return "RELATIONSHIP_FIELD";
  if (clause === "FROM") return "OBJECT";
  if (clause === "WHERE") {
    const w = extractWhereContext(soql);
    if (w.whereField && w.whereOperator) return "VALUE";
    if (w.whereField) return "OPERATOR";
    return "FIELD";
  }
  if (clause === "ORDER_BY" || clause === "GROUP_BY") return "FIELD";
  if (clause === "SUBQUERY_FROM") return "OBJECT";
  if (clause === "SUBQUERY_SELECT") return "FIELD";
  return "FIELD";
}

export function parseCompletionContext(soqlBefore: string): CompletionContext {
  const sub = parseSubqueryContext(soqlBefore);
  if (sub) return sub;

  const primaryObject = extractFromObject(soqlBefore);
  const relationshipPath = extractRelationshipPath(soqlBefore);
  const clause = detectClause(soqlBefore);
  const { whereField, whereOperator } = extractWhereContext(soqlBefore);
  const triggerKind = detectTriggerKind(soqlBefore, clause, relationshipPath);

  return {
    clause,
    primaryObject,
    relationshipPath,
    prevToken: getLastToken(soqlBefore),
    whereField,
    whereOperator,
    triggerKind,
  };
}
