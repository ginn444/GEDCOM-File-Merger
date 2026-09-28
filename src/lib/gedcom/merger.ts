import {
  Individual,
  ParsedFile,
} from './extract';
import { GedcomFile, GedcomNode, serializeGedcom } from './parser';

export interface MatchResult {
  a: Individual;
  b: Individual;
  score: number;
  matchedFields: string[];
}

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
  return common / Math.max(wordsA.length, wordsB.length) * 0.7;
}

export function compareIndividuals(a: Individual, b: Individual): MatchResult {
  let score = 0;
  const matchedFields: string[] = [];

  const nameScore = nameSimilarity(normalizeName(a.name), normalizeName(b.name));
  score += nameScore * 50;
  if (nameScore > 0.6) matchedFields.push('name');

  if (a.sex && b.sex && a.sex === b.sex) {
    score += 5;
    matchedFields.push('sex');
  }

  const birthDateScore = dateSimilarity(a.birthDate, b.birthDate);
  score += birthDateScore * 20;
  if (birthDateScore > 0.5) matchedFields.push('birth date');

  const birthPlaceScore = placeSimilarity(a.birthPlace, b.birthPlace);
  score += birthPlaceScore * 15;
  if (birthPlaceScore > 0.5) matchedFields.push('birth place');

  const deathDateScore = dateSimilarity(a.deathDate, b.deathDate);
  score += deathDateScore * 10;
  if (deathDateScore > 0.5) matchedFields.push('death date');

  return { a, b, score, matchedFields };
}

export interface MergePlan {
  duplicates: MatchResult[];
  totalIndividuals: number;
  totalFamilies: number;
  uniqueIndividuals: number;
  uniqueFamilies: number;
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

export function buildMergePlan(files: ParsedFile[]): {
  plan: MergePlan;
  mappings: Map<number, Map<string, string>>;
} {
  const mappings = new Map<number, Map<string, string>>();
  const counters: Record<string, number> = {};
  const duplicates: MatchResult[] = [];

  for (const pf of files) {
    mappings.set(pf.fileIndex, new Map());
  }

  for (const pf of files) {
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

  const renamedIndividuals: Individual[] = [];
  for (const pf of files) {
    const fileMapping = mappings.get(pf.fileIndex)!;
    for (const ind of pf.individuals.values()) {
      const renamed: Individual = {
        ...ind,
        pointer: fileMapping.get(ind.pointer) ?? ind.pointer,
      };
      renamedIndividuals.push(renamed);
    }
  }

  const merged = new Map<string, Individual>();

  for (const ind of renamedIndividuals) {
    let bestMatch: { ind: Individual; result: MatchResult } | null = null;

    for (const [existingPointer, existingInd] of merged) {
      const result = compareIndividuals(ind, existingInd);
      if (result.score >= 55 && (!bestMatch || result.score > bestMatch.result.score)) {
        bestMatch = { ind: existingInd, result };
      }
    }

    if (bestMatch) {
      for (const pf of files) {
        if (pf.fileIndex === ind.fileIndex) {
          const fileMapping = mappings.get(pf.fileIndex)!;
          fileMapping.set(ind.node.pointer ?? '', bestMatch.ind.pointer);
          break;
        }
      }
      duplicates.push(bestMatch.result);
    } else {
      merged.set(ind.pointer, ind);
    }
  }

  const totalIndividuals = renamedIndividuals.length;
  const uniqueIndividuals = merged.size;
  const totalFamilies = files.reduce((sum, pf) => sum + pf.families.size, 0);

  return {
    plan: {
      duplicates,
      totalIndividuals,
      totalFamilies,
      uniqueIndividuals,
      uniqueFamilies: totalFamilies,
    },
    mappings,
  };
}

function remapNode(
  node: GedcomNode,
  mapping: Map<string, string>,
  level: number
): GedcomNode {
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
    const ref = node.value;
    if (mapping.has(ref)) {
      newNode.value = mapping.get(ref);
    }
  }

  for (const child of node.children) {
    newNode.children.push(remapNode(child, mapping, level + 1));
  }

  return newNode;
}

export function mergeFiles(
  files: ParsedFile[],
  mappings: Map<number, Map<string, string>>
): string {
  const allRecords: GedcomNode[] = [];
  const seenPointers = new Set<string>();

  for (const pf of files) {
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

  const trailer: GedcomNode = {
    level: 0,
    tag: 'TRLR',
    children: [],
    raw: '0 TRLR',
  };

  const mergedFile: GedcomFile = {
    head,
    records: allRecords,
    trailer,
    raw: '',
  };

  return serializeGedcom(mergedFile);
}
