export interface GedcomNode {
  level: number;
  pointer?: string;
  tag: string;
  value?: string;
  children: GedcomNode[];
  xref?: string;
  raw: string;
}

export interface GedcomFile {
  head: GedcomNode;
  records: GedcomNode[];
  trailer: GedcomNode | null;
  raw: string;
}

const LINE_RE = /^(\d+)\s+(\S+)(?:\s+(.*))?$/;
const XREF_RE = /^@(\w+)@$/;

export function parseGedcom(text: string): GedcomFile {
  const lines = text.split(/\r?\n/);
  const root: GedcomNode = { level: -1, tag: 'ROOT', children: [], raw: '' };
  const stack: GedcomNode[] = [root];
  const records: GedcomNode[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = line.match(LINE_RE);
    if (!match) continue;

    const level = parseInt(match[1], 10);
    let tagOrPointer = match[2];
    let value = match[3] ?? '';

    let pointer: string | undefined;
    let tag: string;

    if (XREF_RE.test(tagOrPointer)) {
      pointer = tagOrPointer;
      tag = value.split(/\s+/)[0] ?? '';
      value = value.substring(tag.length).trim();
    } else {
      tag = tagOrPointer;
    }

    if (XREF_RE.test(value)) {
      // value is a cross-reference; keep as-is
    }

    const node: GedcomNode = {
      level,
      pointer,
      tag,
      value: value || undefined,
      children: [],
      raw: line,
    };

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    parent.children.push(node);
    stack.push(node);

    if (level === 0) {
      records.push(node);
    }
  }

  const head = root.children.find((n) => n.tag === 'HEAD') ?? {
    level: 0,
    tag: 'HEAD',
    children: [],
    raw: '0 HEAD',
  };
  const trailer = root.children.find((n) => n.tag === 'TRLR') ?? null;

  return { head, records, trailer, raw: text };
}

export function serializeNode(node: GedcomNode, lines: string[] = []): string[] {
  let line: string;
  if (node.pointer) {
    line = `${node.level} ${node.pointer} ${node.tag}`;
    if (node.value) line += ` ${node.value}`;
  } else {
    line = `${node.level} ${node.tag}`;
    if (node.value) line += ` ${node.value}`;
  }
  lines.push(line);
  for (const child of node.children) {
    serializeNode(child, lines);
  }
  return lines;
}

export function serializeGedcom(file: GedcomFile): string {
  const lines: string[] = [];
  serializeNode(file.head, lines);
  for (const record of file.records) {
    if (record.tag === 'HEAD' || record.tag === 'TRLR') continue;
    serializeNode(record, lines);
  }
  if (file.trailer) {
    serializeNode(file.trailer, lines);
  } else {
    lines.push('0 TRLR');
  }
  return lines.join('\n') + '\n';
}

export function findChildren(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((c) => c.tag === tag);
}

export function findChild(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function getChildValue(node: GedcomNode, tag: string): string | undefined {
  return findChild(node, tag)?.value;
}
