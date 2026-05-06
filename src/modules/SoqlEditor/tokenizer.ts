import * as monaco from "monaco-editor";

export function registerSoqlLanguage(): void {
  if (monaco.languages.getLanguages().some((l) => l.id === "soql")) return;
  monaco.languages.register({ id: "soql" });
}

export function registerSoqlTokenizer(): void {
  monaco.languages.setMonarchTokensProvider("soql", {
    ignoreCase: true,
    keywords: [
      "SELECT",
      "FROM",
      "WHERE",
      "AND",
      "OR",
      "NOT",
      "ORDER",
      "BY",
      "GROUP",
      "HAVING",
      "LIMIT",
      "OFFSET",
      "LIKE",
      "IN",
      "NOT IN",
      "INCLUDES",
      "EXCLUDES",
      "TYPEOF",
      "WHEN",
      "THEN",
      "ELSE",
      "END",
      "ASC",
      "DESC",
      "NULLS",
      "FIRST",
      "LAST",
    ],
    dateLiterals: [
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
    ],
    operators: ["=", "!=", "<>", ">=", "<=", ">", "<"],
    functions: [
      "COUNT",
      "COUNT_DISTINCT",
      "SUM",
      "AVG",
      "MIN",
      "MAX",
      "TOLABEL",
      "FORMAT",
      "CONVERTCURRENCY",
      "FIELDS",
    ],

    tokenizer: {
      root: [
        [/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/, "type.identifier"],
        [
          /[A-Za-z_][A-Za-z0-9_]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@dateLiterals": "string.escape",
              "@functions": "support.function",
              "@default": "identifier",
            },
          },
        ],
        [/'[^']*'/, "string"],
        [/\d+(\.\d+)?/, "number"],
        [/[=!<>]+/, "operator"],
        [/\./, "delimiter"],
        [/--.*$/, "comment"],
        [/[()]/, "delimiter.parenthesis"],
      ],
    },
  });
}
