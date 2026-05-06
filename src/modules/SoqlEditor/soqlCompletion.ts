import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { extractFromObject, parseCompletionContext } from "./contextParser";
import { parseRelationshipPath, type FieldMeta } from "./relationshipParser";

export type CompletionLogFn = (message: string, level?: "info" | "error") => void;
export type CompletionLoadingFn = (message: string | null) => void;

export interface ObjectMeta {
  api_name: string;
  label: string;
  is_custom: number | boolean;
}

export interface ChildRelRow {
  relationship_name: string;
  child_object: string;
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.result)) return obj.result as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
  }
  return [];
}

type CacheEntry<T> = { ts: number; data: T[] };

const OBJECT_CACHE_TTL_MS = 5 * 60_000;
const FIELD_CACHE_TTL_MS = 5 * 60_000;
const CHILD_REL_CACHE_TTL_MS = 5 * 60_000;
const PICKLIST_CACHE_TTL_MS = 10 * 60_000;

const objectCache = new Map<string, CacheEntry<ObjectMeta>>();
const objectInflight = new Map<string, Promise<ObjectMeta[]>>();
const fieldCache = new Map<string, CacheEntry<FieldMeta>>();
const fieldInflight = new Map<string, Promise<FieldMeta[]>>();
const childRelCache = new Map<string, CacheEntry<ChildRelRow>>();
const childRelInflight = new Map<string, Promise<ChildRelRow[]>>();
const picklistCache = new Map<string, CacheEntry<{ label: string; value: string; active: boolean }>>();
const picklistInflight = new Map<string, Promise<Array<{ label: string; value: string; active: boolean }>>>();

export function clearSoqlCompletionCache(scope?: { orgId?: string; objectName?: string }) {
  const orgId = scope?.orgId?.toLowerCase();
  const objectName = scope?.objectName?.toLowerCase();

  const shouldDeleteKey = (key: string): boolean => {
    const parts = key.toLowerCase().split("::");
    const keyOrg = parts[0];
    const keyObject = parts[1];
    if (orgId && keyOrg !== orgId) return false;
    if (objectName && keyObject !== objectName) return false;
    return true;
  };

  for (const key of objectCache.keys()) {
    if (!orgId || key.toLowerCase() === orgId) objectCache.delete(key);
  }
  for (const key of objectInflight.keys()) {
    if (!orgId || key.toLowerCase() === orgId) objectInflight.delete(key);
  }
  for (const key of fieldCache.keys()) {
    if (shouldDeleteKey(key)) fieldCache.delete(key);
  }
  for (const key of fieldInflight.keys()) {
    if (shouldDeleteKey(key)) fieldInflight.delete(key);
  }
  for (const key of childRelCache.keys()) {
    if (shouldDeleteKey(key)) childRelCache.delete(key);
  }
  for (const key of childRelInflight.keys()) {
    if (shouldDeleteKey(key)) childRelInflight.delete(key);
  }
  for (const key of picklistCache.keys()) {
    if (shouldDeleteKey(key)) picklistCache.delete(key);
  }
  for (const key of picklistInflight.keys()) {
    if (shouldDeleteKey(key)) picklistInflight.delete(key);
  }
}

function isFresh<T>(entry: CacheEntry<T> | undefined, ttl: number): entry is CacheEntry<T> {
  if (!entry) return false;
  return Date.now() - entry.ts < ttl;
}

async function withLoadingIndicator<T>(
  promise: Promise<T>,
  onLoading?: CompletionLoadingFn,
  message?: string,
): Promise<T> {
  if (!onLoading) return promise;
  onLoading(message ?? "正在加载补全元数据…");
  try {
    return await promise;
  } finally {
    onLoading(null);
  }
}

async function getObjectsCached(orgId: string, onLoading?: CompletionLoadingFn): Promise<ObjectMeta[]> {
  const cached = objectCache.get(orgId);
  if (isFresh(cached, OBJECT_CACHE_TTL_MS)) return cached.data;
  const inflight = objectInflight.get(orgId);
  if (inflight) return withLoadingIndicator(inflight, onLoading, "正在加载对象列表…");

  const request = invoke<unknown>("get_objects", { orgId })
    .then((raw) => {
      const data = toArray<ObjectMeta>(raw);
      objectCache.set(orgId, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      objectInflight.delete(orgId);
    });
  objectInflight.set(orgId, request);
  return withLoadingIndicator(request, onLoading, "正在加载对象列表…");
}

async function getFieldsCached(orgId: string, objectName: string, onLoading?: CompletionLoadingFn): Promise<FieldMeta[]> {
  const key = `${orgId}::${objectName.toLowerCase()}`;
  const cached = fieldCache.get(key);
  if (isFresh(cached, FIELD_CACHE_TTL_MS)) return cached.data;
  const inflight = fieldInflight.get(key);
  if (inflight) return withLoadingIndicator(inflight, onLoading, `正在加载字段: ${objectName}…`);

  const request = invoke<unknown>("get_fields", { orgId, objectName })
    .then((raw) => {
      const data = toArray<FieldMeta>(raw);
      fieldCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      fieldInflight.delete(key);
    });
  fieldInflight.set(key, request);
  return withLoadingIndicator(request, onLoading, `正在加载字段: ${objectName}…`);
}

async function getChildRelationshipsCached(
  orgId: string,
  objectName: string,
  onLoading?: CompletionLoadingFn,
): Promise<ChildRelRow[]> {
  const key = `${orgId}::${objectName.toLowerCase()}`;
  const cached = childRelCache.get(key);
  if (isFresh(cached, CHILD_REL_CACHE_TTL_MS)) return cached.data;
  const inflight = childRelInflight.get(key);
  if (inflight) return withLoadingIndicator(inflight, onLoading, `正在加载子关系: ${objectName}…`);

  const request = invoke<unknown>("get_child_relationships", { orgId, objectName })
    .then((raw) => {
      const data = toArray<ChildRelRow>(raw);
      childRelCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      childRelInflight.delete(key);
    });
  childRelInflight.set(key, request);
  return withLoadingIndicator(request, onLoading, `正在加载子关系: ${objectName}…`);
}

async function getPicklistValuesCached(
  orgId: string,
  objectName: string,
  fieldName: string,
  onLoading?: CompletionLoadingFn,
): Promise<Array<{ label: string; value: string; active: boolean }>> {
  const key = `${orgId}::${objectName.toLowerCase()}::${fieldName.toLowerCase()}`;
  const cached = picklistCache.get(key);
  if (isFresh(cached, PICKLIST_CACHE_TTL_MS)) return cached.data;
  const inflight = picklistInflight.get(key);
  if (inflight) return withLoadingIndicator(inflight, onLoading, `正在加载选项值: ${fieldName}…`);

  const request = invoke<unknown>("get_picklist_values", { orgId, objectName, fieldName })
    .then((raw) => {
      const data = toArray<{ label: string; value: string; active: boolean }>(raw);
      picklistCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .catch(() => {
      const empty: Array<{ label: string; value: string; active: boolean }> = [];
      picklistCache.set(key, { ts: Date.now(), data: empty });
      return empty;
    })
    .finally(() => {
      picklistInflight.delete(key);
    });
  picklistInflight.set(key, request);
  return withLoadingIndicator(request, onLoading, `正在加载选项值: ${fieldName}…`);
}

async function objectExists(orgId: string, objectName: string, onLoading?: CompletionLoadingFn): Promise<boolean> {
  const objects = await getObjectsCached(orgId, onLoading);
  return objects.some((o) => o.api_name.toLowerCase() === objectName.toLowerCase());
}

const { CompletionItemKind, CompletionItemInsertTextRule } = monaco.languages;

const NON_GROUPABLE_TYPES = new Set(["TEXTAREA", "ENCRYPTEDSTRING", "BASE64", "ANYTYPE", "LOCATION"]);

const DATE_LITERALS = [
  "TODAY",
  "YESTERDAY",
  "TOMORROW",
  "THIS_WEEK",
  "LAST_WEEK",
  "NEXT_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "NEXT_MONTH",
  "THIS_QUARTER",
  "LAST_QUARTER",
  "NEXT_QUARTER",
  "THIS_YEAR",
  "LAST_YEAR",
  "NEXT_YEAR",
  "LAST_N_DAYS",
  "NEXT_N_DAYS",
];

type OperatorDef = { label: string; insertText: string; detail?: string; sortText?: string };

const OPERATORS_BY_TYPE: Record<string, OperatorDef[]> = {
  STRING: [
    { label: "=", insertText: "= ''", detail: "精确匹配" },
    { label: "!=", insertText: "!= ''", detail: "不等于" },
    { label: "LIKE", insertText: "LIKE '%'", detail: "模糊匹配" },
    { label: "NOT LIKE", insertText: "NOT LIKE '%'" },
    { label: "IN", insertText: "IN ()", detail: "多值匹配" },
    { label: "NOT IN", insertText: "NOT IN ()" },
    { label: "= null", insertText: "= null", detail: "为空", sortText: "z_null" },
  ],
  BOOLEAN: [
    { label: "= true", insertText: "= true" },
    { label: "= false", insertText: "= false" },
  ],
  INTEGER: [
    { label: "=", insertText: "= " },
    { label: "!=", insertText: "!= " },
    { label: ">", insertText: "> " },
    { label: ">=", insertText: ">= " },
    { label: "<", insertText: "< " },
    { label: "<=", insertText: "<= " },
    { label: "IN", insertText: "IN ()" },
  ],
  DOUBLE: [
    { label: "=", insertText: "= " },
    { label: "!=", insertText: "!= " },
    { label: ">", insertText: "> " },
    { label: "<", insertText: "< " },
  ],
  DATE: [
    { label: "=", insertText: "= " },
    { label: ">", insertText: "> " },
    { label: "<", insertText: "< " },
    { label: "TODAY", insertText: "= TODAY" },
    { label: "YESTERDAY", insertText: "= YESTERDAY" },
    { label: "LAST_N_DAYS", insertText: "= LAST_N_DAYS:30", detail: "最近 N 天" },
    { label: "NEXT_N_DAYS", insertText: "= NEXT_N_DAYS:7" },
    { label: "THIS_MONTH", insertText: "= THIS_MONTH" },
  ],
  DATETIME: [
    { label: "=", insertText: "= " },
    { label: ">", insertText: "> " },
    { label: "<", insertText: "< " },
    { label: "TODAY", insertText: "= TODAY" },
  ],
  REFERENCE: [
    { label: "=", insertText: "= ''", detail: "ID 精确匹配" },
    { label: "IN", insertText: "IN ()", detail: "多 ID 匹配" },
    { label: "= null", insertText: "= null", detail: "为空" },
    { label: "!= null", insertText: "!= null" },
    { label: "IN (SELECT ...)", insertText: "IN (SELECT Id FROM )", detail: "子查询" },
  ],
  PICKLIST: [
    { label: "=", insertText: "= ''" },
    { label: "IN", insertText: "IN ()" },
  ],
  MULTIPICKLIST: [
    { label: "INCLUDES", insertText: "INCLUDES ('')", detail: "包含" },
    { label: "EXCLUDES", insertText: "EXCLUDES ('')", detail: "不包含" },
  ],
};

const AGGREGATE_FUNCTIONS: Omit<monaco.languages.CompletionItem, "range">[] = [
  { label: "COUNT(Id)", kind: CompletionItemKind.Function, detail: "聚合: 记录总数", insertText: "COUNT(Id)", sortText: "z1_COUNT" },
  {
    label: "COUNT_DISTINCT()",
    kind: CompletionItemKind.Function,
    detail: "聚合: 唯一值数量",
    insertText: "COUNT_DISTINCT($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z2_COUNT_DISTINCT",
  },
  {
    label: "SUM()",
    kind: CompletionItemKind.Function,
    detail: "聚合: 求和",
    insertText: "SUM($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z3_SUM",
  },
  {
    label: "AVG()",
    kind: CompletionItemKind.Function,
    detail: "聚合: 平均值",
    insertText: "AVG($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z4_AVG",
  },
  {
    label: "MIN()",
    kind: CompletionItemKind.Function,
    detail: "聚合: 最小值",
    insertText: "MIN($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z5_MIN",
  },
  {
    label: "MAX()",
    kind: CompletionItemKind.Function,
    detail: "聚合: 最大值",
    insertText: "MAX($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z6_MAX",
  },
];

const SPECIAL_FUNCTIONS: Omit<monaco.languages.CompletionItem, "range">[] = [
  {
    label: "toLabel()",
    kind: CompletionItemKind.Function,
    detail: "Picklist 标签",
    insertText: "toLabel($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z7_toLabel",
  },
  {
    label: "FORMAT()",
    kind: CompletionItemKind.Function,
    detail: "格式化数字/日期",
    insertText: "FORMAT($1)",
    insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "z8_FORMAT",
  },
  {
    label: "FIELDS(ALL)",
    kind: CompletionItemKind.Function,
    detail: "所有字段（需 LIMIT）",
    insertText: "FIELDS(ALL)",
    sortText: "z9_FIELDS_ALL",
  },
];

const ORDER_DIRECTION_ITEMS: Omit<monaco.languages.CompletionItem, "range">[] = [
  { label: "ASC", kind: CompletionItemKind.Keyword, detail: "升序（默认）", insertText: "ASC" },
  { label: "DESC", kind: CompletionItemKind.Keyword, detail: "降序", insertText: "DESC" },
  { label: "NULLS FIRST", kind: CompletionItemKind.Keyword, detail: "null 值排在最前", insertText: "NULLS FIRST" },
  { label: "NULLS LAST", kind: CompletionItemKind.Keyword, detail: "null 值排在最后", insertText: "NULLS LAST" },
  { label: "ASC NULLS FIRST", kind: CompletionItemKind.Keyword, insertText: "ASC NULLS FIRST" },
  { label: "ASC NULLS LAST", kind: CompletionItemKind.Keyword, insertText: "ASC NULLS LAST" },
  { label: "DESC NULLS FIRST", kind: CompletionItemKind.Keyword, insertText: "DESC NULLS FIRST" },
  { label: "DESC NULLS LAST", kind: CompletionItemKind.Keyword, insertText: "DESC NULLS LAST" },
];

const HAVING_OPERATORS: Omit<monaco.languages.CompletionItem, "range">[] = [
  { label: ">", kind: CompletionItemKind.Operator, insertText: "> " },
  { label: ">=", kind: CompletionItemKind.Operator, insertText: ">= " },
  { label: "<", kind: CompletionItemKind.Operator, insertText: "< " },
  { label: "<=", kind: CompletionItemKind.Operator, insertText: "<= " },
  { label: "=", kind: CompletionItemKind.Operator, insertText: "= " },
  { label: "!=", kind: CompletionItemKind.Operator, insertText: "!= " },
];

function fieldToCompletion(field: FieldMeta, range: monaco.IRange): monaco.languages.CompletionItem {
  const isRef = field.field_type === "REFERENCE";
  return {
    label: field.api_name,
    kind: isRef ? CompletionItemKind.Module : CompletionItemKind.Field,
    detail: `${field.label} | ${field.field_type}`,
    insertText: field.api_name,
    range,
    sortText: isRef ? `2_${field.api_name}` : `1_${field.api_name}`,
  };
}

function relationshipPrefixCompletion(
  field: FieldMeta,
  range: monaco.IRange,
): monaco.languages.CompletionItem | null {
  if (field.field_type !== "REFERENCE" || !field.relationship_name) return null;
  return {
    label: `${field.relationship_name}.`,
    kind: CompletionItemKind.Module,
    detail: `父关系 → ${field.reference_to ?? ""}`,
    insertText: `${field.relationship_name}.`,
    range,
    sortText: `3_${field.relationship_name}`,
    command: { id: "editor.action.triggerSuggest", title: "Trigger suggest" },
  };
}

async function handleSubqueryCompletion(
  ctx: ReturnType<typeof parseCompletionContext>,
  orgId: string,
  range: monaco.IRange,
  fullSoql: string,
  cursorOffset: number,
  onLoading?: CompletionLoadingFn,
): Promise<monaco.languages.CompletionItem[]> {
  if (!ctx.primaryObject) return [];
  if (ctx.clause === "SUBQUERY_FROM") {
    const childRels = await getChildRelationshipsCached(orgId, ctx.primaryObject, onLoading);
    return childRels.map((rel) => ({
      label: rel.relationship_name,
      kind: CompletionItemKind.Class,
      detail: `子关系 → ${rel.child_object}`,
      insertText: rel.relationship_name,
      range,
    }));
  }
  if (ctx.clause === "SUBQUERY_SELECT") {
    const fromToken = getSubqueryFromTokenAtCursor(fullSoql, cursorOffset) ?? ctx.subquery?.childRelationshipName ?? null;
    if (!fromToken) return [];
    const childObject = await resolveSubqueryObjectName(orgId, ctx.primaryObject, fromToken, onLoading);
    if (!childObject) return [];
    const fields = await getFieldsCached(orgId, childObject, onLoading);
    return fields.map((f) => fieldToCompletion(f, range));
  }
  return [];
}

function getSubqueryFromTokenAtCursor(fullSoql: string, cursorOffset: number): string | null {
  const openIdx = findNearestSubqueryOpen(fullSoql, cursorOffset);
  if (openIdx === -1) return null;
  const closeIdx = findSubqueryClose(fullSoql, openIdx);
  const end = closeIdx === -1 ? fullSoql.length : closeIdx;
  const subqueryInner = fullSoql.slice(openIdx + 1, end);
  const fromMatch = subqueryInner.match(/\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/i);
  return fromMatch?.[1] ?? null;
}

function findNearestSubqueryOpen(fullSoql: string, cursorOffset: number): number {
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
    const after = fullSoql.slice(i + 1);
    if (/^\s*SELECT\b/i.test(after)) return i;
  }
  return -1;
}

function findSubqueryClose(fullSoql: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx + 1; i < fullSoql.length; i++) {
    const c = fullSoql[i];
    if (c === "(") depth += 1;
    if (c === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

async function resolveSubqueryObjectName(
  orgId: string,
  parentObject: string,
  fromToken: string,
  onLoading?: CompletionLoadingFn,
): Promise<string | null> {
  const directFields = await getFieldsCached(orgId, fromToken, onLoading).catch(() => []);
  if (directFields.length > 0) return fromToken;

  const childRels = await getChildRelationshipsCached(orgId, parentObject, onLoading);
  const matchByRelName = childRels.find((r) => r.relationship_name.toLowerCase() === fromToken.toLowerCase());
  if (matchByRelName) return matchByRelName.child_object;

  const matchByObject = childRels.find((r) => r.child_object.toLowerCase() === fromToken.toLowerCase());
  if (matchByObject) return matchByObject.child_object;

  return null;
}

async function resolvePolymorphicTargets(
  orgId: string,
  primaryObject: string,
  fieldName: string,
  onLoading?: CompletionLoadingFn,
): Promise<string[]> {
  const fields = await getFieldsCached(orgId, primaryObject, onLoading);
  const targetField = fields.find((f) => {
    const api = f.api_name.toLowerCase();
    const rel = (f.relationship_name ?? "").toLowerCase();
    const candidate = fieldName.toLowerCase();
    return rel === candidate || api === candidate || api === `${candidate}id`;
  });
  if (!targetField?.reference_to) return [];
  const seen = new Set<string>();
  return targetField.reference_to
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function handleOperatorCompletion(
  ctx: ReturnType<typeof parseCompletionContext>,
  orgId: string,
  range: monaco.IRange,
  onLoading?: CompletionLoadingFn,
): Promise<monaco.languages.CompletionItem[]> {
  const resolved = await resolveWhereFieldMeta(ctx, orgId, onLoading);
  const field = resolved?.field;
  if (!field) return [];
  const ops = OPERATORS_BY_TYPE[field.field_type] ?? OPERATORS_BY_TYPE.STRING;
  return ops.map((op) => ({
    label: op.label,
    kind: CompletionItemKind.Operator,
    detail: op.detail ?? "",
    insertText: op.insertText,
    range,
    sortText: op.sortText,
  }));
}

async function handleValueCompletion(
  ctx: ReturnType<typeof parseCompletionContext>,
  orgId: string,
  range: monaco.IRange,
  onLoading?: CompletionLoadingFn,
): Promise<monaco.languages.CompletionItem[]> {
  const resolved = await resolveWhereFieldMeta(ctx, orgId, onLoading);
  if (!resolved) return [];
  const { objectName, fieldName, field } = resolved;
  const fieldType = field.field_type.toUpperCase();
  if (fieldType !== "PICKLIST" && fieldType !== "MULTIPICKLIST") {
    if (fieldType !== "DATE" && fieldType !== "DATETIME") {
      return [];
    }
    return DATE_LITERALS.map((lit) => ({
      label: lit,
      kind: CompletionItemKind.Constant,
      detail: "日期字面量",
      insertText: lit.includes("_N_") ? `${lit}:30` : lit,
      range,
    }));
  }

  const picklistValues = await getPicklistValuesCached(orgId, objectName, fieldName, onLoading);
  if (picklistValues.length > 0) {
    return picklistValues.map((v) => ({
      label: v.label && v.label !== v.value ? `${v.label}(${v.value})` : v.value,
      kind: CompletionItemKind.EnumMember,
      detail: v.active ? `Picklist 值: ${v.value}` : `Picklist 值: ${v.value}（已停用）`,
      insertText: `'${v.value}'`,
      range,
    }));
  }
  return [];
}

async function resolveWhereFieldMeta(
  ctx: ReturnType<typeof parseCompletionContext>,
  orgId: string,
  onLoading?: CompletionLoadingFn,
): Promise<{ objectName: string; fieldName: string; field: FieldMeta } | null> {
  if (!ctx.primaryObject || !ctx.whereField) return null;
  const parts = ctx.whereField.split(".").filter(Boolean);
  if (parts.length === 0) return null;

  const fieldName = parts[parts.length - 1];
  let objectName = ctx.primaryObject;
  if (parts.length > 1) {
    const relPath = parts.slice(0, -1);
    const resolved = await parseRelationshipPath(orgId, ctx.primaryObject, relPath, (oid, obj) =>
      getFieldsCached(oid, obj, onLoading),
    );
    if (!resolved.isValid) return null;
    objectName = resolved.terminalObject;
  }

  const fields = await getFieldsCached(orgId, objectName, onLoading);
  const field = fields.find((f) => f.api_name.toLowerCase() === fieldName.toLowerCase());
  if (!field) return null;
  return { objectName, fieldName, field };
}

function parseOrderByTail(textBefore: string): { needsDirection: boolean } {
  const m = /ORDER\s+BY\s+([\s\S]*)$/i.exec(textBefore);
  if (!m) return { needsDirection: false };
  const tail = m[1] ?? "";
  const segments = tail.split(",");
  const part = (segments[segments.length - 1] ?? "").trimStart();
  if (!part) return { needsDirection: false };
  const hasDirection = /\b(ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST)\b/i.test(part);
  const isFieldLike = /^[A-Za-z][A-Za-z0-9_.]*\s*$/i.test(part);
  return { needsDirection: isFieldLike && !hasDirection };
}

function parseHavingTail(textBefore: string): "AGGREGATE" | "OPERATOR" | "VALUE" {
  const m = /HAVING\s+([\s\S]*)$/i.exec(textBefore);
  const tail = (m?.[1] ?? "").trimStart();
  if (!tail) return "AGGREGATE";
  if (/^[A-Za-z_]+\(.*\)\s*(=|!=|<>|>=|<=|>|<)\s*$/i.test(tail)) return "VALUE";
  if (/^[A-Za-z_]+\(.*\)\s+$/i.test(tail) || /^[A-Za-z_]+\(.*\)$/i.test(tail)) return "OPERATOR";
  return "AGGREGATE";
}

function buildLimitOffsetSnippets(range: monaco.IRange, clause: "LIMIT" | "OFFSET"): monaco.languages.CompletionItem[] {
  if (clause === "LIMIT") {
    return [
      {
        label: "LIMIT 200",
        kind: CompletionItemKind.Snippet,
        insertText: "LIMIT ${1:200}",
        insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
        detail: "最大返回行数",
        range,
      },
      {
        label: "LIMIT 2000",
        kind: CompletionItemKind.Snippet,
        insertText: "LIMIT ${1:2000}",
        insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
        detail: "SOQL 常见上限",
        range,
      },
    ];
  }
  return [
    {
      label: "OFFSET 0",
      kind: CompletionItemKind.Snippet,
      insertText: "OFFSET ${1:0}",
      insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "结果偏移量",
      range,
    },
  ];
}

export function registerSoqlCompletion(
  orgId: string | null,
  onLog?: CompletionLogFn,
  onLoading?: CompletionLoadingFn,
): monaco.IDisposable[] {
  if (!orgId) return [];
  let lastCtxSignature = "";
  let lastCtxLogTs = 0;

  const getFieldsFn = async (oid: string, obj: string) => getFieldsCached(oid, obj, onLoading);

  const provider = monaco.languages.registerCompletionItemProvider("soql", {
    triggerCharacters: [" ", ".", ",", "("],
    async provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
      try {
        const textBefore = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const cursorOffset = model.getOffsetAt(position);
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: position.column,
        };

        const ctx = parseCompletionContext(textBefore);
        const modelText = model.getValue();
        if (!ctx.primaryObject) {
          ctx.primaryObject = extractFromObject(modelText);
        }
        const ctxSignature = `${ctx.clause}|${ctx.triggerKind}|${ctx.primaryObject ?? "-"}`;
        const now = Date.now();
        if (ctxSignature !== lastCtxSignature || now - lastCtxLogTs > 1500) {
          onLog?.(
            `补全触发: clause=${ctx.clause}, trigger=${ctx.triggerKind}, primary=${ctx.primaryObject ?? "-"}`,
            "info",
          );
          lastCtxSignature = ctxSignature;
          lastCtxLogTs = now;
        }

        if (ctx.clause === "FROM" && ctx.triggerKind === "OBJECT") {
          const objects = await getObjectsCached(orgId, onLoading);
          if (objects.length === 0) {
            onLog?.("补全提示：对象列表为空或返回格式异常", "error");
          }
          return {
            suggestions: objects.map((obj) => ({
              label: obj.api_name,
              kind: CompletionItemKind.Class,
              detail: `${obj.label} | ${obj.is_custom ? "自定义对象" : "标准对象"}`,
              insertText: obj.api_name,
              range,
              sortText: obj.is_custom ? `1_${obj.api_name}` : `0_${obj.api_name}`,
            })),
          };
        }

        if (ctx.clause === "SUBQUERY_FROM" || ctx.clause === "SUBQUERY_SELECT") {
          const sub = await handleSubqueryCompletion(ctx, orgId, range, modelText, cursorOffset, onLoading);
          return { suggestions: sub };
        }

        if (ctx.clause === "TYPEOF_WHEN") {
          if (!ctx.primaryObject || !ctx.typeof?.fieldName) return { suggestions: [] };
          const targets = await resolvePolymorphicTargets(orgId, ctx.primaryObject, ctx.typeof.fieldName, onLoading);
          return {
            suggestions: targets.map((obj) => ({
              label: obj,
              kind: CompletionItemKind.Class,
              detail: "TYPEOF 可选对象",
              insertText: obj,
              range,
            })),
          };
        }

        if (ctx.clause === "TYPEOF_THEN") {
          const whenObject = ctx.typeof?.whenObject;
          if (!whenObject) return { suggestions: [] };
          const fields = await getFieldsCached(orgId, whenObject, onLoading);
          const relPrefixes = fields
            .filter((f) => f.field_type === "REFERENCE" && f.relationship_name)
            .map((f) => relationshipPrefixCompletion(f, range))
            .filter(Boolean) as monaco.languages.CompletionItem[];
          return { suggestions: [...fields.map((f) => fieldToCompletion(f, range)), ...relPrefixes] };
        }

        if (!ctx.primaryObject) return { suggestions: [] };
        if (!(await objectExists(orgId, ctx.primaryObject, onLoading))) {
          return { suggestions: [] };
        }

        if (ctx.triggerKind === "RELATIONSHIP_FIELD" && ctx.relationshipPath.length > 0) {
          const resolved = await parseRelationshipPath(orgId, ctx.primaryObject, ctx.relationshipPath, getFieldsFn);
          if (!resolved.isValid) return { suggestions: [] };
          const fields = await getFieldsCached(orgId, resolved.terminalObject, onLoading);
          const relPrefixes =
            ctx.relationshipPath.length < 5
              ? fields
                  .filter((f) => f.field_type === "REFERENCE" && f.relationship_name)
                  .map((f) => relationshipPrefixCompletion(f, range))
                  .filter(Boolean) as monaco.languages.CompletionItem[]
              : [];
          return {
            suggestions: [...fields.map((f) => fieldToCompletion(f, range)), ...relPrefixes],
          };
        }

        if (ctx.clause === "WHERE" && ctx.triggerKind === "OPERATOR" && ctx.whereField) {
          return { suggestions: await handleOperatorCompletion(ctx, orgId, range, onLoading) };
        }

        if (ctx.clause === "WHERE" && ctx.triggerKind === "VALUE") {
          return { suggestions: await handleValueCompletion(ctx, orgId, range, onLoading) };
        }

        if (ctx.clause === "HAVING") {
          const havingTrigger = parseHavingTail(textBefore);
          if (havingTrigger === "OPERATOR") {
            return { suggestions: HAVING_OPERATORS.map((item) => ({ ...item, range })) };
          }
          if (havingTrigger === "VALUE") {
            return {
              suggestions: [
                {
                  label: "0",
                  kind: CompletionItemKind.Value,
                  insertText: "0",
                  detail: "数值",
                  range,
                },
                {
                  label: "1",
                  kind: CompletionItemKind.Value,
                  insertText: "1",
                  detail: "数值",
                  range,
                },
                {
                  label: "10",
                  kind: CompletionItemKind.Value,
                  insertText: "10",
                  detail: "数值",
                  range,
                },
              ],
            };
          }
          return { suggestions: AGGREGATE_FUNCTIONS.map((fn) => ({ ...fn, range })) };
        }

        if (ctx.clause === "LIMIT" || ctx.clause === "OFFSET") {
          return { suggestions: buildLimitOffsetSnippets(range, ctx.clause) };
        }

        const fields = await getFieldsCached(orgId, ctx.primaryObject, onLoading);
        const fieldItems = fields.map((f) => fieldToCompletion(f, range));
        const extras: monaco.languages.CompletionItem[] = [];

        if (ctx.clause === "SELECT") {
          fields
            .filter((f) => f.field_type === "REFERENCE" && f.relationship_name)
            .forEach((f) => {
              const item = relationshipPrefixCompletion(f, range);
              if (item) extras.push(item);
            });
          extras.push(...AGGREGATE_FUNCTIONS.map((fn) => ({ ...fn, range })));
          extras.push(...SPECIAL_FUNCTIONS.map((fn) => ({ ...fn, range })));
        }

        if (ctx.clause === "ORDER_BY") {
          const orderState = parseOrderByTail(textBefore);
          if (orderState.needsDirection) {
            return { suggestions: ORDER_DIRECTION_ITEMS.map((item) => ({ ...item, range })) };
          }
          fields
            .filter((f) => f.field_type === "REFERENCE" && f.relationship_name)
            .forEach((f) => {
              const item = relationshipPrefixCompletion(f, range);
              if (item) extras.push(item);
            });
        }

        if (ctx.clause === "GROUP_BY") {
          fields
            .filter((f) => f.field_type === "REFERENCE" && f.relationship_name)
            .forEach((f) => {
              const item = relationshipPrefixCompletion(f, range);
              if (item) extras.push(item);
            });
        }

        const filteredFields =
          ctx.clause === "GROUP_BY"
            ? fieldItems.filter((item) => {
                const f = fields.find((ff) => ff.api_name === item.label);
                return f && !NON_GROUPABLE_TYPES.has(f.field_type);
              })
            : fieldItems;

        return { suggestions: [...filteredFields, ...extras] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog?.(`补全失败: ${message}`, "error");
        return { suggestions: [] };
      }
    },
  });

  return [provider];
}
