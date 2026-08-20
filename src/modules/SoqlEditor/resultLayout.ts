export interface MainFieldColumn {
  id: string;
  label: string;
  kind: "field";
  path: string[];
}

export interface MainSubqueryColumn {
  id: string;
  label: string;
  kind: "subquery";
  subqueryName: string;
}

export type MainColumn = MainFieldColumn | MainSubqueryColumn;

export interface SubqueryColumn {
  label: string;
  path: string[];
}

export interface SubqueryLayout {
  name: string;
  columns: SubqueryColumn[];
}

export interface SoqlLayout {
  mainColumns: MainColumn[];
  subqueries: Record<string, SubqueryLayout>;
}

export function parseSoqlLayout(soql: string): SoqlLayout | null {
  const selectClause = extractMainSelectClause(soql);
  if (!selectClause) return null;
  const items = splitTopLevelComma(selectClause).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;

  const mainColumns: MainColumn[] = [];
  const subqueries: Record<string, SubqueryLayout> = {};
  let hasDynamicFieldsSelector = false;

  items.forEach((item, idx) => {
    if (/^\s*FIELDS\s*\(/i.test(item)) {
      hasDynamicFieldsSelector = true;
      return;
    }

    const sub = parseSubquery(item);
    if (sub) {
      mainColumns.push({
        id: `sq:${sub.name}:${idx}`,
        label: sub.name,
        kind: "subquery",
        subqueryName: sub.name,
      });
      subqueries[sub.name] = sub;
      return;
    }

    const label = normalizeFieldLabel(item);
    const path = toFieldPath(label);
    mainColumns.push({
      id: `f:${label}:${idx}`,
      label,
      kind: "field",
      path,
    });
  });

  if (hasDynamicFieldsSelector) {
    return null;
  }

  return { mainColumns, subqueries };
}

export function getByPath(input: unknown, path: string[]): unknown {
  let cur: unknown = input;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    const obj = cur as Record<string, unknown>;
    const resolvedKey = resolveKeyCaseInsensitive(obj, key);
    if (!resolvedKey) return undefined;
    cur = obj[resolvedKey];
  }
  return cur;
}

/**
 * Aggregate functions without an alias come back as generated `expr0`,
 * `expr1`… keys instead of the SELECT expression text, so layout paths like
 * `Count(Id)` never match and every cell renders empty. When the rows use
 * expr-keys, re-point each unresolved field column at the expr-key matching
 * its SELECT position (already-resolvable columns — aliased aggregates,
 * plain fields — stay put; subquery columns don't consume expr slots).
 */
export function remapAggregateExprColumns(
  cols: MainColumn[],
  rows: Record<string, unknown>[],
): MainColumn[] {
  const sample = rows.find((r) => r && typeof r === "object");
  if (!sample) return cols;
  const exprKeys = Object.keys(sample).filter((k) => /^expr\d+$/.test(k));
  if (exprKeys.length === 0) return cols;
  const byIndex = new Map(exprKeys.map((k) => [Number(k.slice(4)), k]));
  let exprIdx = 0;
  return cols.map((col) => {
    if (col.kind !== "field") return col;
    if (getByPath(sample, col.path) !== undefined) return col;
    const exprKey = byIndex.get(exprIdx);
    exprIdx += 1;
    return exprKey ? { ...col, path: [exprKey] } : col;
  });
}

export function extractSubqueryRows(row: Record<string, unknown>, subqueryName: string): Record<string, unknown>[] {
  const subqueryKey = resolveKeyCaseInsensitive(row, subqueryName);
  const value = subqueryKey ? row[subqueryKey] : undefined;
  if (!value) return [];
  if (Array.isArray(value)) return sanitizeRows(value);
  if (typeof value !== "object") return [];

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.records)) return sanitizeRows(obj.records);

  const nested = obj.result;
  if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>).records)) {
    return sanitizeRows((nested as Record<string, unknown>).records as unknown[]);
  }

  return [];
}

function sanitizeRows(rows: unknown[]): Record<string, unknown>[] {
  return rows
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (k === "attributes") continue;
        next[k] = v;
      }
      return next;
    });
}

function resolveKeyCaseInsensitive(obj: Record<string, unknown>, key: string): string | null {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
  const target = key.toLowerCase();
  const matched = Object.keys(obj).find((k) => k.toLowerCase() === target);
  return matched ?? null;
}

function toFieldPath(label: string): string[] {
  return label.split(".").map((seg) => seg.trim()).filter(Boolean);
}

function normalizeFieldLabel(raw: string): string {
  const trimmed = raw.trim();
  const aliasMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+[A-Za-z_][A-Za-z0-9_]*$/);
  if (aliasMatch) return aliasMatch[1];
  return trimmed;
}

function parseSubquery(raw: string): SubqueryLayout | null {
  const inner = stripOuterParens(raw.trim());
  if (!/^\s*SELECT\b/i.test(inner)) return null;

  const selectFrom = extractSelectToFrom(inner);
  if (!selectFrom) return null;
  const relMatch = /\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(inner);
  if (!relMatch?.[1]) return null;

  const fields = splitTopLevelComma(selectFrom).map((s) => normalizeFieldLabel(s)).filter(Boolean);
  const columns = fields.map((label) => ({ label, path: toFieldPath(label) }));
  return {
    name: relMatch[1],
    columns,
  };
}

function extractMainSelectClause(soql: string): string | null {
  const upper = soql.toUpperCase();
  const selectIdx = upper.indexOf("SELECT");
  if (selectIdx === -1) return null;

  let depth = 0;
  for (let i = selectIdx + 6; i < soql.length; i++) {
    const c = soql[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if ((c === "F" || c === "f") && depth === 0) {
      const maybeFrom = soql.slice(i, i + 4).toUpperCase();
      if (maybeFrom === "FROM") {
        return soql.slice(selectIdx + 6, i).trim();
      }
    }
  }

  return soql.slice(selectIdx + 6).trim();
}

function extractSelectToFrom(innerSoql: string): string | null {
  const upper = innerSoql.toUpperCase();
  const selectIdx = upper.indexOf("SELECT");
  if (selectIdx === -1) return null;

  let depth = 0;
  for (let i = selectIdx + 6; i < innerSoql.length; i++) {
    const c = innerSoql[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if ((c === "F" || c === "f") && depth === 0) {
      const maybeFrom = innerSoql.slice(i, i + 4).toUpperCase();
      if (maybeFrom === "FROM") {
        return innerSoql.slice(selectIdx + 6, i).trim();
      }
    }
  }
  return null;
}

function stripOuterParens(input: string): string {
  if (!input.startsWith("(") || !input.endsWith(")")) return input;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    if (depth === 0 && i < input.length - 1) return input;
  }
  return input.slice(1, -1);
}

function splitTopLevelComma(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "(") {
      depth += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (c === "," && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}
