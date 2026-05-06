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
  | "TYPEOF_WHEN"
  | "TYPEOF_THEN"
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
  typeof?: {
    fieldName: string | null;
    whenObject: string | null;
  };
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

function parseTypeofContext(soql: string): CompletionContext | null {
  const upper = soql.toUpperCase();
  const typeofIdx = upper.lastIndexOf("TYPEOF");
  if (typeofIdx === -1) return null;
  const segment = soql.slice(typeofIdx);
  if (/\bEND\b/i.test(segment)) return null;

  const fieldName = segment.match(/\bTYPEOF\s+([A-Za-z][A-Za-z0-9_]*)/i)?.[1] ?? null;
  if (!fieldName) return null;

  const segUpper = segment.toUpperCase();
  const lastWhenIdx = segUpper.lastIndexOf("WHEN");
  const lastThenIdx = segUpper.lastIndexOf("THEN");
  if (lastWhenIdx === -1) return null;

  if (lastWhenIdx > lastThenIdx) {
    return {
      clause: "TYPEOF_WHEN",
      primaryObject: extractFromObject(soql),
      typeof: { fieldName, whenObject: null },
      relationshipPath: [],
      prevToken: null,
      whereField: null,
      whereOperator: null,
      triggerKind: "OBJECT",
    };
  }

  if (lastThenIdx > -1) {
    const whenThenMatches = [...segment.matchAll(/\bWHEN\s+([A-Za-z][A-Za-z0-9_]*)\s+THEN\b/gi)];
    const whenObject = whenThenMatches.length > 0 ? whenThenMatches[whenThenMatches.length - 1][1] : null;
    return {
      clause: "TYPEOF_THEN",
      primaryObject: extractFromObject(soql),
      typeof: { fieldName, whenObject },
      relationshipPath: [],
      prevToken: null,
      whereField: null,
      whereOperator: null,
      triggerKind: "FIELD",
    };
  }

  return null;
}

/**
 * 从 cursorOffset 向左找：光标所在的那一段 `( SELECT …` 子查询的起始 `(` 下标。
 * 光标须在子查询括号对内（闭括号右侧的主查询区域会返回 -1）。
 */
export function findNearestSubqueryOpenParen(fullSoql: string, cursorOffset: number): number {
  let depth = 0;
  for (let i = cursorOffset - 1; i >= 0; i--) {
    const c = fullSoql[i];
    if (c === ")") {
      depth += 1;
      continue;
    }
    if (c !== "(") continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    const after = fullSoql.slice(i + 1, Math.min(i + 32, fullSoql.length));
    if (/^\s*SELECT\b/i.test(after)) return i;
  }
  return -1;
}

/** 与 `openParenIdx` 处的 `(` 配对的闭括号下标；未闭合则 -1。 */
export function findSubqueryClosingParen(fullSoql: string, openParenIdx: number): number {
  let depth = 0;
  for (let i = openParenIdx + 1; i < fullSoql.length; i++) {
    const c = fullSoql[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * 子查询里用于字段补全的 `FROM` 后对象/关系名（仅 [A-Za-z0-9_]）。
 * - 子查询**已闭合**且光标在括号内：在整段子查询文本中查找 `FROM`，故可在 `FROM` 左侧编辑 SELECT 列表时仍解析到子对象。
 * - 子查询**未闭合**：只扫描到光标，避免把主查询的 `FROM Account` 误当作子查询的 FROM。
 */
export function getSubqueryFromObjectBeforeCursor(fullSoql: string, cursorOffset: number): string | null {
  const openIdx = findNearestSubqueryOpenParen(fullSoql, cursorOffset);
  if (openIdx === -1 || cursorOffset <= openIdx + 1) return null;

  const closeIdx = findSubqueryClosingParen(fullSoql, openIdx);
  const closedAndCursorInside = closeIdx !== -1 && cursorOffset < closeIdx;
  const sliceEnd = closedAndCursorInside ? closeIdx : Math.min(cursorOffset, fullSoql.length);
  const slice = fullSoql.slice(openIdx + 1, Math.max(openIdx + 1, sliceEnd));
  const fromMatches = [...slice.matchAll(/\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/gi)];
  if (fromMatches.length === 0) return null;
  return fromMatches[fromMatches.length - 1][1] ?? null;
}

function parseSubqueryContext(soql: string): CompletionContext | null {
  const openIdx = findNearestSubqueryOpenParen(soql, soql.length);
  if (openIdx === -1) return null;
  const inner = soql.slice(openIdx + 1);
  if (!/^\s*SELECT\b/i.test(inner)) return null;
  const fromMatches = [...inner.matchAll(/\bFROM\b/gi)];
  const lastFrom = fromMatches.length > 0 ? fromMatches[fromMatches.length - 1] : null;
  if (lastFrom) {
    const afterFrom = inner.slice(lastFrom.index + lastFrom[0].length);
    const hasNextClause = /\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.test(afterFrom);
    if (!hasNextClause) {
      const relationToken = afterFrom.trim().match(/^([A-Za-z][A-Za-z0-9_]*)/)?.[1] ?? null;
      return {
        clause: "SUBQUERY_FROM",
        primaryObject: extractFromObject(soql),
        relationshipPath: [],
        prevToken: null,
        whereField: null,
        whereOperator: null,
        triggerKind: "OBJECT",
        subquery: { childRelationshipName: relationToken, childObject: null },
      };
    }
  }

  if (!lastFrom) {
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
  if (clause === "HAVING") return "AGGREGATE";
  if (clause === "LIMIT" || clause === "OFFSET") return "KEYWORD";
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
  const typeOfCtx = parseTypeofContext(soqlBefore);
  if (typeOfCtx) return typeOfCtx;

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
