import {
  GedcomFile,
  GedcomNode,
  findChild,
  findChildren,
  getChildValue,
  parseGedcom,
  serializeGedcom,
} from './parser';

interface Individual {
  pointer: string;
  name?: string;
  sex?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  fileIndex: number;
  originalPointer: string;
}

interface ParsedFileData {
  fileName: string;
  file: GedcomFile;
  individuals: Individual[];
  familyCount: number;
  sourceCount: number;
  fileIndex: number;
}

const POINTER_PREFIXES: Record<string, string> = {
  INDI: 'I',
  FAM: 'F',
  SOUR: 'S',
  REPO: 'R',
  NOTE: 'N',
  OBJE: 'M',
  SUBM: 'U',
};

function normalizeName(name?: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(date?: string): string {
  if (!date) return '';
  return date.toLowerCase().replace(/[^0-9]/g, '');
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = b.split(' ').filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  let common = 0;
  for (const wa of wordsA) {
    if (wordsB.includes(wa)) common++;
  }
  return common / Math.max(wordsA.length, wordsB.length);
}

function dateSimilarity(a?: string, b?: string): number {
  const na = normalizeDate(a);
  const nb = normalizeDate(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 4 && nb.length >= 4 && na.slice(-4) === nb.slice(-4)) return 0.85;
  return 0;
}

function placeSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wordsA = na.split(/[\s,]+/).filter(Boolean);
  const wordsB = nb.split(/[\s,]+/).filter(Boolean);
  let common = 0;
  for (const wa of wordsA) {
    if (wordsB.includes(wa)) common++;
  }
  return (common / Math.max(wordsA.length, wordsB.length)) * 0.7;
}

function compareScore(a: Individual, b: Individual): number {
  let score = 0;
  score += nameSimilarity(normalizeName(a.name), normalizeName(b.name)) * 50;
  if (a.sex && b.sex && a.sex === b.sex) score += 5;
  score += dateSimilarity(a.birthDate, b.birthDate) * 20;
  score += placeSimilarity(a.birthPlace, b.birthPlace) * 15;
  score += dateSimilarity(a.deathDate, b.deathDate) * 10;
  return score;
}

function isExactMatch(a: Individual, b: Individual): boolean {
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (!nameA || !nameB || nameA !== nameB) return false;
  const birthA = normalizeDate(a.birthDate);
  const birthB = normalizeDate(b.birthDate);
  if (!birthA || !birthB || birthA !== birthB) return false;
  return true;
}

function getMatchedFields(a: Individual, b: Individual): string[] {
  const fields: string[] = [];
  if (nameSimilarity(normalizeName(a.name), normalizeName(b.name)) > 0.6) fields.push('name');
  if (a.sex && b.sex && a.sex === b.sex) fields.push('sex');
  if (dateSimilarity(a.birthDate, b.birthDate) > 0.5) fields.push('birth date');
  if (placeSimilarity(a.birthPlace, b.birthPlace) > 0.5) fields.push('birth place');
  if (dateSimilarity(a.deathDate, b.deathDate) > 0.5) fields.push('death date');
  return fields;
}

function blockingKey(ind: Individual): string {
  const norm = normalizeName(ind.name);
  if (!norm) return '__';
  const parts = norm.split(' ');
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return (first.slice(0, 2) + last.slice(0, 2)).padEnd(4, '_');
}

interface DupResult {
  nameA?: string;
  nameB?: string;
  score: number;
  matchedFields: string[];
  merged: boolean;
}

export function runMerge(
  fileTexts: string[],
  fileNames: string[]
): {
  content: string;
  stats: {
    totalIndividuals: number;
    uniqueIndividuals: number;
    totalFamilies: number;
    duplicates: DupResult[];
  };
} {
  const parsedFiles: ParsedFileData[] = [];

  for (let fi = 0; fi < fileTexts.length; fi++) {
    const file = parseGedcom(fileTexts[fi]);
    const individuals: Individual[] = [];
    let familyCount = 0;
    let sourceCount = 0;

    for (const record of file.records) {
      if (record.tag === 'INDI') {
        const pointer = record.pointer ?? '';
        const nameNode = findChild(record, 'NAME');
        const name = nameNode?.value?.replace(/\//g, '').trim();
        const sex = getChildValue(record, 'SEX');
        const birthNode = findChild(record, 'BIRT');
        const deathNode = findChild(record, 'DEAT');
        individuals.push({
          pointer,
          name,
          sex,
          birthDate: birthNode ? getChildValue(birthNode, 'DATE') : undefined,
          birthPlace: birthNode ? getChildValue(birthNode, 'PLAC') : undefined,
          deathDate: deathNode ? getChildValue(deathNode, 'DATE') : undefined,
          deathPlace: deathNode ? getChildValue(deathNode, 'PLAC') : undefined,
          fileIndex: fi,
          originalPointer: pointer,
        });
      } else if (record.tag === 'FAM') {
        familyCount++;
      } else if (record.tag === 'SOUR') {
        sourceCount++;
      }
    }

    parsedFiles.push({ fileName: fileNames[fi], file, individuals, familyCount, sourceCount, fileIndex: fi });
  }

  // Global renumbering of all pointers
  const mappings: Map<number, Map<string, string>> = new Map();
  const counters: Record<string, number> = {};

  for (const pf of parsedFiles) {
    mappings.set(pf.fileIndex, new Map());
    const fileMapping = mappings.get(pf.fileIndex)!;
    for (const record of pf.file.records) {
      if (record.tag === 'HEAD' || record.tag === 'TRLR') continue;
      if (!record.pointer) continue;
      const prefix = POINTER_PREFIXES[record.tag] ?? 'X';
      if (!(prefix in counters)) counters[prefix] = 0;
      counters[prefix]++;
      const newPointer = `@${prefix}${counters[prefix]}@`;
      fileMapping.set(record.pointer, newPointer);
    }
  }

  // Rename individuals to their new pointers
  const allIndividuals: Individual[] = [];
  for (const pf of parsedFiles) {
    const fileMapping = mappings.get(pf.fileIndex)!;
    for (const ind of pf.individuals) {
      allIndividuals.push({
        ...ind,
        pointer: fileMapping.get(ind.pointer) ?? ind.pointer,
      });
    }
  }

  // Blocking-based deduplication
  const blocks = new Map<string, Individual[]>();
  for (const ind of allIndividuals) {
    const key = blockingKey(ind);
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(ind);
  }

  const duplicates: DupResult[] = [];
  const mergedPointers = new Set<string>();

  for (const [, blockIndividuals] of blocks) {
    for (const ind of blockIndividuals) {
      let bestMatch: Individual | null = null;
      let bestScore = 0;

      for (const candidate of blockIndividuals) {
        if (candidate.pointer === ind.pointer) continue;
        if (candidate.fileIndex === ind.fileIndex) continue;
        if (!mergedPointers.has(candidate.pointer)) continue;

        const score = compareScore(ind, candidate);
        if (score >= 55 && score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      if (bestMatch && isExactMatch(ind, bestMatch)) {
        for (const pf of parsedFiles) {
          if (pf.fileIndex === ind.fileIndex) {
            const fileMapping = mappings.get(pf.fileIndex)!;
            fileMapping.set(ind.originalPointer, bestMatch.pointer);
            break;
          }
        }
        const fields = getMatchedFields(ind, bestMatch);
        duplicates.push({
          nameA: ind.name,
          nameB: bestMatch.name,
          score: bestScore,
          matchedFields: fields,
          merged: true,
        });
      } else {
        mergedPointers.add(ind.pointer);
        if (bestMatch) {
          const fields = getMatchedFields(ind, bestMatch);
          duplicates.push({
            nameA: ind.name,
            nameB: bestMatch.name,
            score: bestScore,
            matchedFields: fields,
            merged: false,
          });
        }
      }
    }
  }

  // Serialize
  const allRecords: GedcomNode[] = [];
  const seenPointers = new Set<string>();

  for (const pf of parsedFiles) {
    const mapping = mappings.get(pf.fileIndex)!;
    for (const record of pf.file.records) {
      if (record.tag === 'HEAD' || record.tag === 'TRLR') continue;
      if (record.pointer) {
        const newPointer = mapping.get(record.pointer) ?? record.pointer;
        if (seenPointers.has(newPointer)) continue;
        seenPointers.add(newPointer);
      }
      allRecords.push(remapNode(record, mapping, 0));
    }
  }

  const head: GedcomNode = {
    level: 0,
    tag: 'HEAD',
    children: [
      { level: 1, tag: 'SOUR', value: 'GEDCOM-MERGER', children: [], raw: '1 SOUR GEDCOM-MERGER' },
      { level: 1, tag: 'DEST', value: 'ANY', children: [], raw: '1 DEST ANY' },
      { level: 1, tag: 'DATE', value: new Date().toUTCString().slice(5, 16).toUpperCase(), children: [], raw: '' },
      { level: 1, tag: 'CHAR', value: 'UTF-8', children: [], raw: '1 CHAR UTF-8' },
      { level: 1, tag: 'GEDC', children: [
        { level: 2, tag: 'VERS', value: '5.5.1', children: [], raw: '2 VERS 5.5.1' },
        { level: 2, tag: 'FORM', value: 'LINEAGE-LINKED', children: [], raw: '2 FORM LINEAGE-LINKED' },
      ], raw: '' },
    ],
    raw: '0 HEAD',
  };

  const trailer: GedcomNode = { level: 0, tag: 'TRLR', children: [], raw: '0 TRLR' };
  const mergedFile: GedcomFile = { head, records: allRecords, trailer, raw: '' };

  const content = serializeGedcom(mergedFile);

  return {
    content,
    stats: {
      totalIndividuals: allIndividuals.length,
      uniqueIndividuals: mergedPointers.size,
      totalFamilies: parsedFiles.reduce((s, pf) => s + pf.familyCount, 0),
      duplicates,
    },
  };
}

function remapNode(node: GedcomNode, mapping: Map<string, string>, level: number): GedcomNode {
  const newNode: GedcomNode = {
    level,
    tag: node.tag,
    value: node.value,
    pointer: node.pointer,
    children: [],
    raw: node.raw,
  };
  if (node.pointer && mapping.has(node.pointer)) {
    newNode.pointer = mapping.get(node.pointer);
  }
  if (node.value && node.value.startsWith('@') && node.value.endsWith('@')) {
    if (mapping.has(node.value)) {
      newNode.value = mapping.get(node.value);
    }
  }
  for (const child of node.children) {
    newNode.children.push(remapNode(child, mapping, level + 1));
  }
  return newNode;
}
