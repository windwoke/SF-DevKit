import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { parseCompletionContext } from "./contextParser";
import { parseRelationshipPath, type FieldMeta } from "./relationshipParser";

export interface ObjectMeta {
  api_name: string;
  label: string;
  is_custom: number | boolean;
}

export interface ChildRelRow {
  relationship_name: string;
  child_object: string;
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
): Promise<monaco.languages.CompletionItem[]> {
  if (!ctx.primaryObject) return [];
  if (ctx.clause === "SUBQUERY_FROM") {
    const childRels = await invoke<ChildRelRow[]>("get_child_relationships", {
      org_id: orgId,
      object_name: ctx.primaryObject,
    });
    return childRels.map((rel) => ({
      label: rel.relationship_name,
      kind: CompletionItemKind.Class,
      detail: `子关系 → ${rel.child_object}`,
      insertText: rel.relationship_name,
      range,
    }));
  }
  if (ctx.clause === "SUBQUERY_SELECT" && ctx.subquery?.childObject) {
    const fields = await invoke<FieldMeta[]>("get_fields", {
      org_id: orgId,
      object_name: ctx.subquery.childObject,
    });
    return fields.map((f) => fieldToCompletion(f, range));
  }
  if (ctx.clause === "SUBQUERY_SELECT") {
    return [];
  }
  return [];
}

async function handleOperatorCompletion(
  ctx: ReturnType<typeof parseCompletionContext>,
  orgId: string,
  range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
  if (!ctx.primaryObject || !ctx.whereField) return [];
  const fieldName = ctx.whereField.includes(".") ? ctx.whereField.split(".").pop()! : ctx.whereField;
  const fields = await invoke<FieldMeta[]>("get_fields", { org_id: orgId, object_name: ctx.primaryObject });
  const field = fields.find((f) => f.api_name.toLowerCase() === fieldName.toLowerCase());
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
): Promise<monaco.languages.CompletionItem[]> {
  if (!ctx.primaryObject || !ctx.whereField) return [];
  const picklistValues = await invoke<Array<{ label: string; value: string; active: boolean }>>(
    "get_picklist_values",
    { org_id: orgId, object_name: ctx.primaryObject, field_name: ctx.whereField },
  ).catch(() => []);
  if (picklistValues.length > 0) {
    return picklistValues.map((v) => ({
      label: v.label,
      kind: CompletionItemKind.EnumMember,
      detail: v.active ? "有效" : "已停用",
      insertText: `'${v.value}'`,
      range,
    }));
  }
  return DATE_LITERALS.map((lit) => ({
    label: lit,
    kind: CompletionItemKind.Constant,
    detail: "日期字面量",
    insertText: lit.includes("_N_") ? `${lit}:30` : lit,
    range,
  }));
}

export function registerSoqlCompletion(orgId: string | null): monaco.IDisposable[] {
  if (!orgId) return [];

  const getFieldsFn = (oid: string, obj: string) =>
    invoke<FieldMeta[]>("get_fields", { org_id: oid, object_name: obj });

  const provider = monaco.languages.registerCompletionItemProvider("soql", {
    triggerCharacters: [" ", ".", ",", "("],
    async provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: position.column,
      };

      const ctx = parseCompletionContext(textBefore);

      if (ctx.clause === "FROM" && ctx.triggerKind === "OBJECT") {
        const objects = await invoke<ObjectMeta[]>("get_objects", { org_id: orgId });
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
        const sub = await handleSubqueryCompletion(ctx, orgId, range);
        return { suggestions: sub };
      }

      if (!ctx.primaryObject) return { suggestions: [] };

      if (ctx.triggerKind === "RELATIONSHIP_FIELD" && ctx.relationshipPath.length > 0) {
        const resolved = await parseRelationshipPath(orgId, ctx.primaryObject, ctx.relationshipPath, getFieldsFn);
        if (!resolved.isValid) return { suggestions: [] };
        const fields = await invoke<FieldMeta[]>("get_fields", {
          org_id: orgId,
          object_name: resolved.terminalObject,
        });
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
        return { suggestions: await handleOperatorCompletion(ctx, orgId, range) };
      }

      if (ctx.clause === "WHERE" && ctx.triggerKind === "VALUE") {
        return { suggestions: await handleValueCompletion(ctx, orgId, range) };
      }

      const fields = await invoke<FieldMeta[]>("get_fields", {
        org_id: orgId,
        object_name: ctx.primaryObject,
      });
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

      const filteredFields =
        ctx.clause === "GROUP_BY"
          ? fieldItems.filter((item) => {
              const f = fields.find((ff) => ff.api_name === item.label);
              return f && !NON_GROUPABLE_TYPES.has(f.field_type);
            })
          : fieldItems;

      return { suggestions: [...filteredFields, ...extras] };
    },
  });

  return [provider];
}
