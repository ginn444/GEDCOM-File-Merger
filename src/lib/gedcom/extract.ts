import {
  GedcomFile,
  GedcomNode,
  findChild,
  findChildren,
  getChildValue,
  parseGedcom,
} from './parser';

export interface Individual {
  pointer: string;
  name?: string;
  sex?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  node: GedcomNode;
  fileIndex: number;
}

export interface Family {
  pointer: string;
  husband?: string;
  wife?: string;
  children: string[];
  node: GedcomNode;
  fileIndex: number;
}

export interface ParsedFile {
  fileName: string;
  file: GedcomFile;
  individuals: Map<string, Individual>;
  families: Map<string, Family>;
  sources: Map<string, GedcomNode>;
  repositories: Map<string, GedcomNode>;
  notes: Map<string, GedcomNode>;
  media: Map<string, GedcomNode>;
  submitter: Map<string, GedcomNode>;
  maxIndividualNum: number;
  maxFamilyNum: number;
  fileIndex: number;
}

export function parseFileContent(text: string, fileName: string, fileIndex: number): ParsedFile {
  const file = parseGedcom(text);
  const individuals = new Map<string, Individual>();
  const families = new Map<string, Family>();
  const sources = new Map<string, GedcomNode>();
  const repositories = new Map<string, GedcomNode>();
  const notes = new Map<string, GedcomNode>();
  const media = new Map<string, GedcomNode>();
  const submitter = new Map<string, GedcomNode>();

  let maxIndividualNum = 0;
  let maxFamilyNum = 0;

  for (const record of file.records) {
    if (record.tag === 'INDI') {
      const pointer = record.pointer ?? '';
      const nameNode = findChild(record, 'NAME');
      const name = nameNode?.value?.replace(/\//g, '').trim();
      const sex = getChildValue(record, 'SEX');
      const birthNode = findChild(record, 'BIRT');
      const deathNode = findChild(record, 'DEAT');
      const birthDate = birthNode ? getChildValue(birthNode, 'DATE') : undefined;
      const birthPlace = birthNode ? getChildValue(birthNode, 'PLAC') : undefined;
      const deathDate = deathNode ? getChildValue(deathNode, 'DATE') : undefined;
      const deathPlace = deathNode ? getChildValue(deathNode, 'PLAC') : undefined;

      individuals.set(pointer, {
        pointer,
        name,
        sex,
        birthDate,
        birthPlace,
        deathDate,
        deathPlace,
        node: record,
        fileIndex,
      });

      const match = pointer.match(/I(\d+)/);
      if (match) maxIndividualNum = Math.max(maxIndividualNum, parseInt(match[1], 10));
    } else if (record.tag === 'FAM') {
      const pointer = record.pointer ?? '';
      const husband = getChildValue(record, 'HUSB');
      const wife = getChildValue(record, 'WIFE');
      const children = findChildren(record, 'CHIL').map((c) => c.value ?? '').filter(Boolean);
      families.set(pointer, {
        pointer,
        husband,
        wife,
        children,
        node: record,
        fileIndex,
      });
      const match = pointer.match(/F(\d+)/);
      if (match) maxFamilyNum = Math.max(maxFamilyNum, parseInt(match[1], 10));
    } else if (record.tag === 'SOUR') {
      if (record.pointer) sources.set(record.pointer, record);
    } else if (record.tag === 'REPO') {
      if (record.pointer) repositories.set(record.pointer, record);
    } else if (record.tag === 'NOTE') {
      if (record.pointer) notes.set(record.pointer, record);
    } else if (record.tag === 'OBJE') {
      if (record.pointer) media.set(record.pointer, record);
    } else if (record.tag === 'SUBM') {
      if (record.pointer) submitter.set(record.pointer, record);
    }
  }

  return {
    fileName,
    file,
    individuals,
    families,
    sources,
    repositories,
    notes,
    media,
    submitter,
    maxIndividualNum,
    maxFamilyNum,
    fileIndex,
  };
}


