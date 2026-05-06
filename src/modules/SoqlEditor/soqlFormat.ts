/** 折叠空白，保留字符串字面量内的空格 */
export function collapseSoqlWhitespace(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "'") inString = false;
      continue;
    }
    if (c === "'") {
      out += c;
      inString = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (out.length > 0 && out[out.length - 1] !== " ") out += " ";
      while (i + 1 < input.length && /\s/.test(input[i + 1])) i++;
      continue;
    }
    out += c;
  }
  return out.trim();
}

const CLAUSE_KEYWORDS: string[] = [
  "GROUP BY",
  "ORDER BY",
  "FOR UPDATE",
  "FOR VIEW",
  "FOR REFERENCE",
  "HAVING",
  "WHERE",
  "FROM",
  "LIMIT",
  "OFFSET",
];

function matchKeywordAt(s: string, pos: number, keyword: string): boolean {
  if (pos + keyword.length > s.length) return false;
  const slice = s.slice(pos, pos + keyword.length);
  if (slice.toUpperCase() !== keyword) return false;
  const before = pos === 0 ? " " : s[pos - 1];
  const after = s[pos + keyword.length];
  const beforeOk = pos === 0 || /\s/.test(before) || before === "(" || before === ",";
  const afterOk = after === undefined || /\s/.test(after) || after === "(";
  return beforeOk && afterOk;
}

/** 仅在括号深度 0、且不在字符串内时按逗号拆分 */
export function splitTopLevelCommaSegments(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "'") inString = false;
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** 将 `segment` 视为整段外层括号包裹；若内层为 SELECT 子查询则返回 inner 文本，否则 null */
export function extractParenSubqueryInner(segment: string): string | null {
  const t = segment.trim();
  if (t.length < 2 || t[0] !== "(") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "'") inString = false;
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        if (i !== t.length - 1) return null;
        const inner = t.slice(1, -1).trim();
        if (!/^SELECT\b/i.test(inner)) return null;
        return inner;
      }
    }
  }
  return null;
}

/** 按深度 0 拆主句（与原先 formatSoql 一致），首行形如 `SELECT …` 或 `SELECT …` 无 FROM 时整段 */
export function splitClauseLines(s: string): string[] {
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = 0;
  let line = "";
  const lines: string[] = [];

  const pushLine = () => {
    const t = line.trim();
    if (t) lines.push(t);
    line = "";
  };

  const selectMatch = s.match(/^select\b/i);
  if (selectMatch) {
    line = "SELECT ";
    i = selectMatch[0].length;
    while (i < s.length && /\s/.test(s[i])) i++;
  }

  while (i < s.length) {
    const c = s[i];
    if (inString) {
      line += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "'") inString = false;
      i++;
      continue;
    }
    if (c === "'") {
      line += c;
      inString = true;
      i++;
      continue;
    }
    if (c === "(") {
      depth++;
      line += c;
      i++;
      continue;
    }
    if (c === ")") {
      if (depth > 0) depth--;
      line += c;
      i++;
      continue;
    }

    if (depth === 0 && !inString) {
      let matched: string | null = null;
      for (const kw of CLAUSE_KEYWORDS) {
        if (matchKeywordAt(s, i, kw)) {
          matched = kw;
          break;
        }
      }
      if (matched) {
        pushLine();
        line = matched.toUpperCase();
        i += matched.length;
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i < s.length && s[i] !== ")" && s[i] !== ",") line += " ";
        continue;
      }
    }

    line += c;
    i++;
  }
  pushLine();

  return lines;
}

function formatSelectClauseLines(clauseLines: string[], linePrefix: string): string[] {
  const out: string[] = [];
  const first = clauseLines[0];
  if (!/^SELECT\b/i.test(first)) {
    return clauseLines.map((l) => (linePrefix ? linePrefix + l : l));
  }

  const listRaw = first.replace(/^SELECT\s+/i, "").trim();
  const segments = splitTopLevelCommaSegments(listRaw);

  out.push(`${linePrefix}SELECT`);
  const fieldIndent = `${linePrefix}  `;
  const subIndent = `${linePrefix}    `;

  segments.forEach((segRaw, idx) => {
    const last = idx === segments.length - 1;
    const comma = last ? "" : ",";
    const inner = extractParenSubqueryInner(segRaw);
    if (inner) {
      const collapsed = collapseSoqlWhitespace(inner);
      const innerClauseLines = splitClauseLines(collapsed);
      out.push(`${fieldIndent}(`);
      out.push(...formatSelectClauseLines(innerClauseLines, subIndent));
      out.push(`${fieldIndent})${comma}`);
    } else {
      out.push(`${fieldIndent}${segRaw.trim()}${comma}`);
    }
  });

  for (let j = 1; j < clauseLines.length; j++) {
    out.push(linePrefix + clauseLines[j]);
  }

  return out;
}

/** SOQL 排版：主句换行、SELECT 字段与子查询分行并缩进 */
export function formatSoql(raw: string): string {
  const s = collapseSoqlWhitespace(raw);
  if (!s) return "";
  const lines = splitClauseLines(s);
  return formatSelectClauseLines(lines, "").join("\n");
}
