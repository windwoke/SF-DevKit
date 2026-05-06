export type XmlCompletionContext =
  | { kind: "EMPTY_DOCUMENT" }
  | { kind: "MEMBERS_CONTENT"; resolvedType: string | null; existingMembers: string[] }
  | { kind: "NAME_CONTENT"; usedTypes: string[] }
  | { kind: "VERSION_CONTENT" }
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

  return { kind: "UNKNOWN" };
}

function isInTagContent(fullText: string, offset: number, tag: string): boolean {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const lastOpen = fullText.lastIndexOf(open, offset);
  const lastCloseBefore = fullText.lastIndexOf(close, offset);
  if (lastOpen === -1 || lastOpen < lastCloseBefore) return false;
  const closeAfter = fullText.indexOf(close, lastOpen);
  return closeAfter !== -1 && offset <= closeAfter;
}

function extractCurrentTypesBlock(fullText: string, offset: number): string {
  const tokenRe = /<\/?types>/g;
  const stack: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(fullText)) !== null) {
    if (m.index >= offset) break;
    if (m[0] === "<types>") stack.push(m.index);
    else if (stack.length > 0) stack.pop();
  }
  const start = stack.length > 0 ? stack[stack.length - 1] : -1;
  if (start === -1) return "";
  const end = fullText.indexOf("</types>", offset);
  return fullText.slice(start, end === -1 ? fullText.length : end + "</types>".length);
}

function extractNameFromBlock(blockText: string): string | null {
  const m = blockText.match(/<name>\s*([^<]+?)\s*<\/name>/);
  return m ? m[1].trim() : null;
}

function extractMembersFromBlock(blockText: string): string[] {
  const re = /<members>\s*([^<]*?)\s*<\/members>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockText)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function extractAllDeclaredTypes(fullText: string): string[] {
  const re = /<name>\s*([^<]+?)\s*<\/name>/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const v = m[1].trim();
    if (v) out.add(v);
  }
  return Array.from(out);
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
