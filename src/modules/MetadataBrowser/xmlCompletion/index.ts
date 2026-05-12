import type * as MonacoType from "monaco-editor";
import type { MetadataComponentMeta, MetadataTypeMeta } from "../../../lib/tauri";
import { tauriApi } from "../../../lib/tauri";
import i18n from "../../../i18n";
import { parseXmlCompletionContext } from "./contextParser";

function $t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options as never));
}

const API_VERSIONS = ["62.0", "61.0", "60.0", "59.0", "58.0", "57.0"];
const PACKAGE_XMLNS = "http://soap.sforce.com/2006/04/metadata";
const FALLBACK_TYPES = [
  "ApexClass",
  "ApexTrigger",
  "CustomObject",
  "CustomField",
  "Flow",
  "Layout",
  "PermissionSet",
  "Profile",
];

export function registerPackageXmlCompletion(monaco: typeof MonacoType, orgId: string): MonacoType.IDisposable {
  return monaco.languages.registerCompletionItemProvider("xml", {
    triggerCharacters: [
      "<",
      "/",
      ">",
      " ",
      "\n",
      ...("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.*".split("")),
    ],
    provideCompletionItems: async (model, position) => {
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const context = parseXmlCompletionContext(text, offset);
      const range = buildReplaceRange(monaco, model, position);

      switch (context.kind) {
        case "EMPTY_DOCUMENT":
          return { suggestions: [buildPackageSnippet(monaco, range)] };
        case "TAG_CLOSE":
          return { suggestions: buildCloseTag(monaco, context.unclosedTag, range) };
        case "TAG_OPEN":
          return { suggestions: buildOpenTags(monaco, context.parentTag, range) };
        case "BLANK_CONTENT":
          return { suggestions: buildBlankSnippets(monaco, context.parentTag, range) };
        case "ATTRIBUTE":
          if (context.tagName === "Package") {
            return {
              suggestions: [
                {
                  label: `xmlns="${PACKAGE_XMLNS}"`,
                  kind: monaco.languages.CompletionItemKind.Property,
                  detail: $t("metadataBrowser.completion.xmlnsDetail"),
                  insertText: `xmlns="${PACKAGE_XMLNS}"`,
                  range,
                  sortText: "0_xmlns",
                },
              ],
            };
          }
          return { suggestions: [] };
        case "VERSION_CONTENT":
          return {
            suggestions: API_VERSIONS.map((v, idx) => ({
              label: v,
              kind: monaco.languages.CompletionItemKind.Constant,
              insertText: v,
              range,
              sortText: `${idx}`,
            })),
          };
        case "NAME_CONTENT": {
          const types = await safeListMetadataTypes(orgId);
          const used = new Set(context.usedTypes);
          return { suggestions: buildNameItems(monaco, types, used, range) };
        }
        case "MEMBERS_CONTENT":
          return {
            suggestions: await buildMembersItems(monaco, orgId, context.resolvedType, context.existingMembers, range),
          };
        default:
          return { suggestions: [] };
      }
    },
  });
}

function buildReplaceRange(
  monaco: typeof MonacoType,
  model: MonacoType.editor.ITextModel,
  position: MonacoType.Position,
): MonacoType.IRange {
  const line = model.getLineContent(position.lineNumber);
  const idx = position.column - 1;
  const valid = /[A-Za-z0-9_.\-*]/;
  let start = idx;
  while (start > 0 && valid.test(line[start - 1])) start -= 1;
  let end = idx;
  while (end < line.length && valid.test(line[end])) end += 1;
  return {
    startLineNumber: position.lineNumber,
    startColumn: start + 1,
    endLineNumber: position.lineNumber,
    endColumn: end + 1,
  };
}

function buildPackageSnippet(monaco: typeof MonacoType, range: MonacoType.IRange): MonacoType.languages.CompletionItem {
  return {
    label: $t("metadataBrowser.completion.packageTemplate"),
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
      "    <types>",
      "        <members>${1:*}</members>",
      "        <name>${2:ApexClass}</name>",
      "    </types>",
      "    <version>${3:60.0}</version>",
      "</Package>",
    ].join("\n"),
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  };
}

function buildOpenTags(
  monaco: typeof MonacoType,
  parent: "Package" | "types" | "unknown",
  range: MonacoType.IRange,
): MonacoType.languages.CompletionItem[] {
  if (parent === "Package") {
    return [
      { label: "types", kind: monaco.languages.CompletionItemKind.Field, insertText: "types>", range },
      { label: "version", kind: monaco.languages.CompletionItemKind.Field, insertText: "version>", range },
      { label: "/Package", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "/Package>", range },
    ];
  }
  if (parent === "types") {
    return [
      { label: "members", kind: monaco.languages.CompletionItemKind.Field, insertText: "members>", range },
      { label: "name", kind: monaco.languages.CompletionItemKind.Field, insertText: "name>", range },
      { label: "/types", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "/types>", range },
    ];
  }
  return [];
}

function buildBlankSnippets(
  monaco: typeof MonacoType,
  parent: "Package" | "types" | "unknown",
  range: MonacoType.IRange,
): MonacoType.languages.CompletionItem[] {
  if (parent === "Package") {
    return [
      {
        label: $t("metadataBrowser.completion.typesSnippet"),
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: $t("metadataBrowser.completion.typesSnippetDetail"),
        insertText: "<types>\n    <members>${1:*}</members>\n    <name>${2:ApexClass}</name>\n</types>",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: "0_types_snippet",
      },
      {
        label: $t("metadataBrowser.completion.versionSnippet"),
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: $t("metadataBrowser.completion.versionSnippetDetail"),
        insertText: "<version>${1:60.0}</version>",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: "1_version_snippet",
      },
    ];
  }

  if (parent === "types") {
    return [
      {
        label: $t("metadataBrowser.completion.membersSnippet"),
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: $t("metadataBrowser.completion.membersSnippetDetail"),
        insertText: "<members>${1:*}</members>",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: "0_members_snippet",
      },
      {
        label: $t("metadataBrowser.completion.nameSnippet"),
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: $t("metadataBrowser.completion.nameSnippetDetail"),
        insertText: "<name>${1:ApexClass}</name>",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: "1_name_snippet",
      },
    ];
  }

  return [];
}

function buildCloseTag(
  monaco: typeof MonacoType,
  unclosedTag: string | null,
  range: MonacoType.IRange,
): MonacoType.languages.CompletionItem[] {
  if (!unclosedTag) return [];
  return [
    {
      label: `/${unclosedTag}>`,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: `/${unclosedTag}>`,
      range,
    },
  ];
}

function buildNameItems(
  monaco: typeof MonacoType,
  types: MetadataTypeMeta[],
  used: Set<string>,
  range: MonacoType.IRange,
): MonacoType.languages.CompletionItem[] {
  return types.map((t) => ({
    label: t.xml_name,
    kind: monaco.languages.CompletionItemKind.EnumMember,
    detail: t.parent_xml_name ? `${t.group_name} · ${t.parent_xml_name}` : t.group_name,
    insertText: t.xml_name,
    range,
    sortText: used.has(t.xml_name) ? `z_${t.xml_name}` : `a_${t.group_name}_${t.xml_name}`,
    tags: used.has(t.xml_name) ? [monaco.languages.CompletionItemTag.Deprecated] : [],
  }));
}

async function safeListMetadataTypes(orgId: string): Promise<MetadataTypeMeta[]> {
  try {
    return await tauriApi.listMetadataTypes({ orgId, forceRefresh: false });
  } catch {
    return FALLBACK_TYPES.map((xml_name) => ({
      xml_name,
      directory_name: null,
      suffix: null,
      in_folder: false,
      group_name: "Fallback",
      parent_xml_name: null,
    }));
  }
}

async function buildMembersItems(
  monaco: typeof MonacoType,
  orgId: string,
  resolvedType: string | null,
  existingMembers: string[],
  range: MonacoType.IRange,
): Promise<MonacoType.languages.CompletionItem[]> {
  const used = new Set(existingMembers);
  const base: MonacoType.languages.CompletionItem[] = [
    {
      label: "*",
      kind: monaco.languages.CompletionItemKind.Keyword,
      detail: $t("metadataBrowser.completion.allMembersDetail"),
      insertText: "*",
      sortText: "0_*",
      range,
    },
  ];

  if (!resolvedType) {
    base.push({
      label: $t("metadataBrowser.completion.fillNameLabel"),
      kind: monaco.languages.CompletionItemKind.Text,
      detail: $t("metadataBrowser.completion.fillNameDetail"),
      insertText: "",
      sortText: "1_hint",
      range,
    });
    return base;
  }

  let components: MetadataComponentMeta[] = [];
  try {
    components = await tauriApi.listMetadataComponents({ orgId, metadataType: resolvedType, forceRefresh: false });
  } catch {
    return base;
  }

  const items = components.map((c) => ({
    label: c.full_name,
    kind: monaco.languages.CompletionItemKind.Value,
    detail: c.last_modified ? $t("metadataBrowser.completion.lastModified", { date: c.last_modified }) : resolvedType,
    insertText: c.full_name,
    range,
    sortText: used.has(c.full_name) ? `z_${c.full_name}` : `b_${c.full_name}`,
    tags: used.has(c.full_name) ? [monaco.languages.CompletionItemTag.Deprecated] : [],
  }));
  return [...base, ...items];
}
