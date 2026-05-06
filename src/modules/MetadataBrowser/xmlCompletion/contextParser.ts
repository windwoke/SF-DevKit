export type XmlCompletionContext =
  | { kind: "EMPTY_DOCUMENT" }
  | { kind: "MEMBERS_CONTENT"; resolvedType: string | null; existingMembers: string[] }
  | { kind: "NAME_CONTENT"; usedTypes: string[] }
  | { kind: "VERSION_CONTENT" }
  | { kind: "BLANK_CONTENT"; parentTag: "Package" | "types" | "unknown" }
  | { kind: "ATTRIBUTE"; tagName: string }
  | { kind: "TAG_OPEN"; parentTag: "Package" | "types" | "unknown" }
  | { kind: "TAG_CLOSE"; unclosedTag: string | null }
  | { kind: "UNKNOWN" };

export function parseXmlCompletionContext(fullText: string, offset: number): XmlCompletionContext {
  const textBefore = fullText.slice(0, offset);

  if (!fullText.trim()) return { kind: "EMPTY_DOCUMENT" };

  if (/<\/[A-Za-z0-9_-]*$/.test(textBefore)) {
    return { kind: "TAG_CLOSE", unclosedTag: findInnermostUnclosedTag(textBefore) };
  }

  const attrMatch = textBefore.match(/<([A-Za-z][A-Za-z0-9]*)(?:\s+[^>]*)?\s+[A-Za-z0-9:_-]*$/);
  if (attrMatch) {
    return { kind: "ATTRIBUTE", tagName: attrMatch[1] };
  }

  if (/<[A-Za-z0-9_-]*$/.test(textBefore) && !/<\/[A-Za-z0-9_-]*$/.test(textBefore)) {
    return { kind: "TAG_OPEN", parentTag: findImmediateParentTag(textBefore) };
  }

  if (isInTagContent(fullText, offset, "members")) {
    const block = extractCurrentTypesBlock(fullText, offset);
    return {
      kind: "MEMBERS_CONTENT",
      resolvedType: extractNameFromBlock(block),
      existingMembers: extractMembersFromBlock(block),
    };
  }

  if (isInTagContent(fullText, offset, "name")) {
    return { kind: "NAME_CONTENT", usedTypes: extractAllDeclaredTypes(fullText) };
  }

  if (isInTagContent(fullText, offset, "version")) {
    return { kind: "VERSION_CONTENT" };
  }

  const parentTag = findImmediateParentTag(textBefore);
  if ((parentTag === "Package" || parentTag === "types") && isWhitespaceAroundCursor(fullText, offset)) {
    return { kind: "BLANK_CONTENT", parentTag };
  }

  return { kind: "UNKNOWN" };
}

function isInTagContent(fullText: string, offset: number, tag: string): boolean {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  const before = fullText.slice(0, offset);
  const lastOpen = findLastMatchIndex(before, openRe);
  const lastCloseBefore = findLastMatchIndex(before, closeRe);
  if (lastOpen === -1 || lastOpen < lastCloseBefore) return false;
  const after = fullText.slice(lastOpen);
  const closeAfterRel = after.search(closeRe);
  const closeAfter = closeAfterRel === -1 ? -1 : lastOpen + closeAfterRel;
  return closeAfter !== -1 && offset <= closeAfter;
}

function extractCurrentTypesBlock(fullText: string, offset: number): string {
  const tokenRe = /<\/?types\b[^>]*>/gi;
  const stack: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(fullText)) !== null) {
    if (m.index >= offset) break;
    if (/^<types\b/i.test(m[0]) && !/^<\/types/i.test(m[0])) stack.push(m.index);
    else if (stack.length > 0) stack.pop();
  }
  const start = stack.length > 0 ? stack[stack.length - 1] : -1;
  if (start === -1) return "";
  const endMatch = fullText.slice(offset).match(/<\/types>/i);
  const end = endMatch?.index == null ? -1 : offset + endMatch.index;
  return fullText.slice(start, end === -1 ? fullText.length : end + "</types>".length);
}

function extractNameFromBlock(blockText: string): string | null {
  const m = blockText.match(/<name>\s*([^<]+?)\s*<\/name>/);
  return m ? m[1].trim() : null;
}

function extractMembersFromBlock(blockText: string): string[] {
  const re = /<members>\s*([^<]*?)\s*<\/members>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockText)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function extractAllDeclaredTypes(fullText: string): string[] {
  const re = /<name>\s*([^<]+?)\s*<\/name>/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const v = m[1].trim();
    if (v) out.add(v);
  }
  return Array.from(out);
}

function findLastMatchIndex(text: string, re: RegExp): number {
  let idx = -1;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    idx = m.index;
  }
  return idx;
}

function isWhitespaceAroundCursor(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const left = before.match(/[^\s]$/)?.[0] ?? "";
  const right = after.match(/^[^\s]/)?.[0] ?? "";
  return (!left || left === ">") && (!right || right === "<");
}

function findImmediateParentTag(textBefore: string): "Package" | "types" | "unknown" {
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(textBefore)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.startsWith("</")) {
      if (stack[stack.length - 1] === name) stack.pop();
    } else if (!full.endsWith("/>")) {
      stack.push(name);
    }
  }
  const parent = stack[stack.length - 1] ?? "unknown";
  if (parent === "Package" || parent === "types") return parent;
  return "unknown";
}

function findInnermostUnclosedTag(textBefore: string): string | null {
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(textBefore)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.startsWith("</")) {
      if (stack[stack.length - 1] === name) stack.pop();
    } else if (!full.endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}
