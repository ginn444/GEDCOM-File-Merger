import { useState, useCallback, useRef } from 'react';
import {
  FileUp,
  FileText,
  X,
  GitMerge,
  Download,
  Users,
  Heart,
  Copy,
  Check,
  AlertCircle,
  Upload,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  text: string;
  individualCount: number;
  familyCount: number;
}

interface DupResult {
  nameA?: string;
  nameB?: string;
  score: number;
  matchedFields: string[];
  merged: boolean;
}

interface MergeOutput {
  content: string;
  fileName: string;
  stats: {
    totalIndividuals: number;
    uniqueIndividuals: number;
    totalFamilies: number;
    duplicates: DupResult[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function truncateName(name?: string): string {
  if (!name) return 'Unknown';
  return name.length > 40 ? name.slice(0, 40) + '...' : name;
}

function quickCount(text: string): { individuals: number; families: number } {
  let individuals = 0;
  let families = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('0 @') && line.includes(' INDI')) individuals++;
    else if (line.startsWith('0 @') && line.includes(' FAM')) families++;
  }
  return { individuals, families };
}

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState('');
  const [output, setOutput] = useState<MergeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const additions: UploadedFile[] = [];

    for (const file of incoming) {
      if (!file.name.toLowerCase().endsWith('.ged') && !file.name.toLowerCase().endsWith('.gedcom')) {
        setError(`${file.name} doesn't appear to be a GEDCOM file. Please upload .ged or .gedcom files.`);
        continue;
      }
      const text = await file.text();
      const { individuals, families } = quickCount(text);
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        text,
        individualCount: individuals,
        familyCount: families,
      });
    }

    if (additions.length > 0) {
      setFiles((prev) => [...prev, ...additions]);
      setOutput(null);
      setError(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setOutput(null);
  }, []);

  const handleMerge = useCallback(() => {
    if (files.length < 2) return;
    setMerging(true);
    setProgress('Starting merge...');
    setError(null);

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./lib/gedcom/mergeWorker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    const worker = workerRef.current;

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.success) {
        setOutput({
          content: e.data.result.content,
          fileName: 'merged.ged',
          stats: e.data.result.stats,
        });
        setMerging(false);
        setProgress('');
      } else {
        setError(e.data.error || 'An error occurred while merging files.');
        setMerging(false);
        setProgress('');
      }
    };

    worker.onerror = () => {
      setError('The merge worker crashed. Your files may be too large or malformed.');
      setMerging(false);
      setProgress('');
    };

    setProgress('Parsing and merging in background...');
    worker.postMessage({
      fileTexts: files.map((f) => f.text),
      fileNames: files.map((f) => f.name),
    });
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = output.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [output]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const totalIndividuals = files.reduce((sum, f) => sum + f.individualCount, 0);
  const totalFamilies = files.reduce((sum, f) => sum + f.familyCount, 0);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-emerald-100/40 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-96 w-96 rounded-full bg-amber-100/40 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-teal-100/30 blur-3xl" />
      </div>

      <header className="relative border-b border-stone-200/60 bg-white/70 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 shadow-lg shadow-emerald-600/20">
              <GitMerge className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-stone-900">GEDCOM Merger</h1>
              <p className="text-xs text-stone-500">Combine family trees with smart deduplication</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200/60">
            <Sparkles className="h-3.5 w-3.5" />
            Runs entirely in your browser
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-6 py-10">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Merge your family trees
          </h2>
          <p className="mt-3 text-base text-stone-600 max-w-xl mx-auto">
            Upload multiple GEDCOM files exported from Ancestry or other genealogy services.
            We'll combine them into a single file, intelligently matching duplicate individuals.
          </p>
        </div>

        {files.length === 0 && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-300 ${
              isDragging
                ? 'border-emerald-500 bg-emerald-50/60 scale-[1.01]'
                : 'border-stone-300 bg-white/60 hover:border-emerald-400 hover:bg-emerald-50/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".ged,.gedcom"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-xl shadow-emerald-500/20 transition-transform duration-300 group-hover:scale-105">
              <FileUp className="h-8 w-8 text-white" />
            </div>
            <p className="mt-5 text-lg font-semibold text-stone-800">
              Drop your GEDCOM files here
            </p>
            <p className="mt-1.5 text-sm text-stone-500">
              or click to browse — upload 2 or more .ged files
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700 animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-6">
            <div className="space-y-3">
              {files.map((f, idx) => (
                <div
                  key={f.id}
                  className="group flex items-center gap-4 rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800 truncate">{f.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {f.individualCount} people</span>
                      <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {f.familyCount} families</span>
                      <span>{formatBytes(f.size)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(f.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed py-4 text-sm font-medium transition-all ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-50/60'
                  : 'border-stone-300 text-stone-500 hover:border-emerald-400 hover:text-emerald-600'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".ged,.gedcom"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <Upload className="h-4 w-4" />
              Add more files
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-stone-200 bg-white/80 p-4 text-center backdrop-blur-sm">
                <p className="text-2xl font-bold text-emerald-700">{totalIndividuals}</p>
                <p className="text-xs text-stone-500 mt-0.5">Total People</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-white/80 p-4 text-center backdrop-blur-sm">
                <p className="text-2xl font-bold text-teal-700">{totalFamilies}</p>
                <p className="text-xs text-stone-500 mt-0.5">Total Families</p>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleMerge}
                disabled={files.length < 2 || merging}
                className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all hover:shadow-xl hover:shadow-emerald-600/30 hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
              >
                {merging ? (
                  <>
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {progress || 'Merging...'}
                  </>
                ) : (
                  <>
                    <GitMerge className="h-5 w-5" />
                    Merge {files.length} Files
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </div>

            {files.length < 2 && (
              <p className="text-center text-sm text-stone-500">Upload at least 2 files to merge</p>
            )}
          </div>
        )}

        {output && (
          <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/80 p-6 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-md shadow-emerald-600/20">
                  <Check className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-900">Merge complete</h3>
                  <p className="text-sm text-stone-600">Your combined GEDCOM file is ready</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-white/70 p-3 text-center border border-emerald-100">
                  <p className="text-xl font-bold text-stone-800">{output.stats.uniqueIndividuals}</p>
                  <p className="text-xs text-stone-500">Unique People</p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 text-center border border-emerald-100">
                  <p className="text-xl font-bold text-stone-800">{output.stats.duplicates.filter((d) => d.merged).length}</p>
                  <p className="text-xs text-stone-500">Merged Duplicates</p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 text-center border border-emerald-100">
                  <p className="text-xl font-bold text-stone-800">{output.stats.totalFamilies}</p>
                  <p className="text-xs text-stone-500">Families</p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 text-center border border-emerald-100">
                  <p className="text-xl font-bold text-stone-800">{formatBytes(new Blob([output.content]).size)}</p>
                  <p className="text-xs text-stone-500">File Size</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleDownload}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-lg active:scale-[0.98]"
                >
                  <Download className="h-4 w-4" />
                  Download {output.fileName}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-700 transition-all hover:bg-stone-50 active:scale-[0.98]"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy to clipboard'}
                </button>
              </div>
            </div>

            {(() => {
              const mergedDups = output.stats.duplicates.filter((d) => d.merged);
              const possibleDups = output.stats.duplicates.filter((d) => !d.merged);
              return (
                <>
                  {mergedDups.length > 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-white/80 p-6 backdrop-blur-sm">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-stone-700 mb-4">
                        <Check className="h-4 w-4 text-emerald-600" />
                        Merged duplicates ({mergedDups.length})
                        <span className="font-normal text-stone-400 text-xs">— exact name and birth date match</span>
                      </h4>
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        {mergedDups.slice(0, 200).map((d, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg bg-emerald-50/50 px-4 py-2.5 text-sm border border-emerald-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-stone-700 truncate">{truncateName(d.nameA)}</span>
                              <span className="text-stone-400 flex-shrink-0">↔</span>
                              <span className="font-medium text-stone-700 truncate">{truncateName(d.nameB)}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <span className="text-xs text-stone-400">{d.matchedFields.join(', ')}</span>
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                {Math.round(d.score)}%
                              </span>
                            </div>
                          </div>
                        ))}
                        {mergedDups.length > 200 && (
                          <p className="text-center text-xs text-stone-400 pt-2">
                            ...and {mergedDups.length - 200} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {possibleDups.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-white/80 p-6 backdrop-blur-sm">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-stone-700 mb-4">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        Possible duplicates — not merged ({possibleDups.length})
                        <span className="font-normal text-stone-400 text-xs">— kept separate, review manually</span>
                      </h4>
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        {possibleDups.slice(0, 200).map((d, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg bg-amber-50/50 px-4 py-2.5 text-sm border border-amber-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-stone-700 truncate">{truncateName(d.nameA)}</span>
                              <span className="text-stone-400 flex-shrink-0">↔</span>
                              <span className="font-medium text-stone-700 truncate">{truncateName(d.nameB)}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <span className="text-xs text-stone-400">{d.matchedFields.join(', ')}</span>
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                {Math.round(d.score)}%
                              </span>
                            </div>
                          </div>
                        ))}
                        {possibleDups.length > 200 && (
                          <p className="text-center text-xs text-stone-400 pt-2">
                            ...and {possibleDups.length - 200} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {files.length === 0 && (
          <div className="mt-16 grid sm:grid-cols-3 gap-6">
            {[
              { icon: FileUp, title: 'Upload', desc: 'Add 2 or more GEDCOM files from Ancestry or other services.' },
              { icon: GitMerge, title: 'Merge', desc: 'Smart matching finds duplicate people across files and combines them.' },
              { icon: Download, title: 'Download', desc: 'Get a single clean GEDCOM file ready to import anywhere.' },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/80 border border-stone-200 shadow-sm">
                  <step.icon className="h-5 w-5 text-emerald-600" />
                </div>
                <h3 className="mt-3 font-semibold text-stone-800">{step.title}</h3>
                <p className="mt-1 text-sm text-stone-500">{step.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="relative border-t border-stone-200/60 py-6 text-center text-xs text-stone-400">
        <p>Your files are processed entirely in your browser — nothing is uploaded to a server.</p>
      </footer>
    </div>
  );
}
