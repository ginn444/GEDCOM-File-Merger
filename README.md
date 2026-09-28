# GEDCOM File Merger

A browser app that combines two or more GEDCOM files into one. Upload `.ged` or `.gedcom` exports from Ancestry or another genealogy program, merge them, then download a single `merged.ged` file.

All parsing and merging happens in your browser. Files are not sent to a server.

## How to use it

1. Open the app and drop in two or more GEDCOM files, or click to browse.
2. Check the people and family counts for each file.
3. Click **Merge**.
4. Download `merged.ged`, or copy the file text. Review the lists of merged duplicates and possible duplicates that were kept separate.

## How matching works

Each file is parsed into a tree of GEDCOM records. Pointers (`INDI`, `FAM`, `SOUR`, `REPO`, `NOTE`, `OBJE`, `SUBM`, and any other record type) are renumbered so they do not collide, and cross-references inside each file are rewritten to the new pointers.

Two people are merged only when both of these are true:

- They come from different files.
- Their names and birth dates match after normalization (case, punctuation, and extra spaces ignored; dates compared as digits only).

Candidates are grouped by a short name key (the first two letters of the given name and the first two letters of the surname) so the comparison stays local. A near match that scores 55 or higher on name, sex, birth date, birth place, and death date is listed as a possible duplicate and left as two people.

The output file gets a new header (`SOUR GEDCOM-MERGER`, GEDCOM 5.5.1, UTF-8). Source headers are not copied through.

## Develop

Requires Node.js and npm.

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Typecheck `src` with `tsc` |

## Stack

React 18, TypeScript, Vite, and Tailwind CSS. Icons are from `lucide-react`. The merge runs in a Web Worker so the page stays responsive on larger trees.
