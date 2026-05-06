import type * as MonacoType from "monaco-editor";

export function computePackageXmlDiagnostics(
  monaco: typeof MonacoType,
  fullText: string,
): MonacoType.editor.IMarkerData[] {
  const markers: MonacoType.editor.IMarkerData[] = [];
  const typeBlocks = extractTypeBlocks(fullText);

  const seenTypeFirstNameOffset = new Map<string, number>();
  const seenMembersByType = new Map<string, Set<string>>();

  for (const block of typeBlocks) {
    const typeName = block.typeName;
    if (!typeName) continue;

    if (seenTypeFirstNameOffset.has(typeName)) {
      markers.push(
        toWarningMarker(
          monaco,
          fullText,
          block.nameOffset,
          typeName.length,
          `重复的类型声明：${typeName}。建议合并到同一个 <types> 块。`,
        ),
      );
    } else {
      seenTypeFirstNameOffset.set(typeName, block.nameOffset);
    }

    const seenInCurrentBlock = new Set<string>();
    const seenInAllBlocks = seenMembersByType.get(typeName) ?? new Set<string>();
    for (const member of block.members) {
      if (seenInCurrentBlock.has(member.value)) {
        markers.push(
          toWarningMarker(
            monaco,
            fullText,
            member.offset,
            member.value.length,
            `重复的成员：${member.value}（同一 <types> 块内）`,
          ),
        );
      } else if (seenInAllBlocks.has(member.value)) {
        markers.push(
          toWarningMarker(
            monaco,
            fullText,
            member.offset,
            member.value.length,
            `重复的成员：${member.value}（在类型 ${typeName} 的其他 <types> 块已存在）`,
          ),
        );
      } else {
        seenInCurrentBlock.add(member.value);
        seenInAllBlocks.add(member.value);
      }
    }
    seenMembersByType.set(typeName, seenInAllBlocks);
  }

  return markers;
}

interface MemberEntry {
  value: string;
  offset: number;
}

interface TypeBlock {
  typeName: string | null;
  nameOffset: number;
  members: MemberEntry[];
}

function extractTypeBlocks(fullText: string): TypeBlock[] {
  const blocks: TypeBlock[] = [];
  const blockRe = /<types\b[^>]*>([\s\S]*?)<\/types>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(fullText)) !== null) {
    const blockText = blockMatch[0];
    const blockStart = blockMatch.index;

    const nameRe = /<name>\s*([^<]+)\s*<\/name>/i;
    const nameMatch = nameRe.exec(blockText);
    const typeName = nameMatch?.[1]?.trim() ?? null;
    const nameOffset = nameMatch ? blockStart + nameMatch.index + "<name>".length : blockStart;

    const members: MemberEntry[] = [];
    const memberRe = /<members>\s*([^<]*?)\s*<\/members>/gi;
    let memberMatch: RegExpExecArray | null;
    while ((memberMatch = memberRe.exec(blockText)) !== null) {
      const value = memberMatch[1].trim();
      if (!value) continue;
      const rawMemberContent = memberMatch[0];
      const valueStartInRaw = rawMemberContent.indexOf(memberMatch[1]);
      const valueOffset = blockStart + memberMatch.index + valueStartInRaw;
      members.push({ value, offset: valueOffset });
    }

    blocks.push({ typeName, nameOffset, members });
  }
  return blocks;
}

function toWarningMarker(
  monaco: typeof MonacoType,
  fullText: string,
  startOffset: number,
  length: number,
  message: string,
): MonacoType.editor.IMarkerData {
  const start = offsetToLineCol(fullText, startOffset);
  const end = offsetToLineCol(fullText, startOffset + Math.max(length, 1));
  return {
    severity: monaco.MarkerSeverity.Warning,
    message,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function offsetToLineCol(fullText: string, offset: number): { lineNumber: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, fullText.length));
  const before = fullText.slice(0, safeOffset);
  const lines = before.split("\n");
  return {
    lineNumber: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}
