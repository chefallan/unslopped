import { addedLines, changedFiles, parseUnifiedDiff } from './git.ts';
import { importers } from './graph.ts';
import { isTestFile } from './practices.ts';
import type { FileNode, Graph } from './graph.ts';
import type { Finding } from './types.ts';

export type ChangedLines = Map<string, number[]>;

export function enclosingSymbols(node: FileNode, lines: number[]): string[] {
  const sorted = [...node.symbols].sort((a, b) => a.line - b.line);
  const hit = new Set<string>();
  for (const l of lines) {
    let owner: string | null = null;
    for (const s of sorted) {
      if (s.line <= l) owner = s.name;
      else break;
    }
    if (owner) hit.add(owner);
  }
  return [...hit];
}

export function changedLinesFromDiff(diff: string): ChangedLines {
  const out: ChangedLines = new Map();
  for (const l of parseUnifiedDiff(diff)) {
    if (!out.has(l.file)) out.set(l.file, []);
    out.get(l.file)!.push(l.line);
  }
  return out;
}

export function changedLinesFromPatches(files: Array<{ filename: string; patch?: string }>): ChangedLines {
  const out: ChangedLines = new Map();
  for (const f of files) {
    const diff = `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch ?? ''}`;
    const lines = parseUnifiedDiff(diff).map((l) => l.line);
    out.set(f.filename, lines);
  }
  return out;
}

export function localChanges(root: string, since: string | null): ChangedLines {
  const out: ChangedLines = new Map();
  for (const f of changedFiles(root, since)) out.set(f, []);
  for (const l of addedLines(root, since)) {
    if (l.file.startsWith('.ade/')) continue;
    if (!out.has(l.file)) out.set(l.file, []);
    out.get(l.file)!.push(l.line);
  }
  return out;
}

export interface ImpactFile {
  file: string;
  inGraph: boolean;
  isTest: boolean;
  touched: string[];
  touchedExported: string[];
  importers: string[];
  importersUsingTouched: string[];
  coveringTests: string[];
}

export interface HotSymbol {
  file: string;
  symbol: string;
  dependents: number;
}

export interface Impact {
  files: ImpactFile[];
  transitive: number;
  hot: HotSymbol[];
  untested: string[];
  testsInChange: string[];
}

export function computeImpact(graph: Graph, changed: ChangedLines, testPatterns: string[], hotThreshold = 3): Impact {
  const changedSet = new Set(changed.keys());
  const files: ImpactFile[] = [];
  const hot: HotSymbol[] = [];
  const testsInChange = [...changedSet].filter((f) => isTestFile(f, testPatterns));
  for (const [file, lines] of changed) {
    const node = graph.files[file];
    const isTest = isTestFile(file, testPatterns);
    if (!node) {
      files.push({ file, inGraph: false, isTest, touched: [], touchedExported: [], importers: [], importersUsingTouched: [], coveringTests: [] });
      continue;
    }
    const touched = lines.length ? enclosingSymbols(node, lines) : node.symbols.filter((s) => s.exported).map((s) => s.name);
    const exportedNames = new Set(node.symbols.filter((s) => s.exported).map((s) => s.name));
    const touchedExported = touched.filter((t) => exportedNames.has(t));
    const imps = importers(graph, file);
    const usingTouched = imps.filter((i) => (graph.files[i]?.uses[file] ?? []).some((u) => touchedExported.includes(u)));
    const coveringTests = imps.filter((i) => isTestFile(i, testPatterns));
    for (const sym of touchedExported) {
      const dependents = imps.filter((i) => (graph.files[i]?.uses[file] ?? []).includes(sym) && !isTestFile(i, testPatterns)).length;
      if (dependents >= hotThreshold) hot.push({ file, symbol: sym, dependents });
    }
    files.push({ file, inGraph: true, isTest, touched, touchedExported, importers: imps, importersUsingTouched: usingTouched, coveringTests });
  }
  const seen = new Set<string>(changedSet);
  let frontier = [...changedSet];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: string[] = [];
    for (const f of frontier) for (const i of importers(graph, f)) if (!seen.has(i)) {
      seen.add(i);
      next.push(i);
    }
    frontier = next;
  }
  const untested = files.filter((f) => f.inGraph && !f.isTest && f.touchedExported.length && !f.coveringTests.length && !testsInChange.some((t) => t.includes(f.file.replace(/\.[^.]+$/, '').split('/').pop() ?? '\u0000'))).map((f) => f.file);
  return { files, transitive: seen.size - changedSet.size, hot: hot.sort((a, b) => b.dependents - a.dependents), untested, testsInChange };
}

export function formatImpact(impact: Impact): string[] {
  const lines = [`impact of ${impact.files.length} changed file(s), ${impact.transitive} dependent file(s) within 3 hops`];
  for (const f of impact.files) {
    if (!f.inGraph) {
      lines.push(`  ${f.file}  (not in the code map)`);
      continue;
    }
    const parts = [`${f.file}`];
    if (f.isTest) parts.push('test file');
    else {
      parts.push(f.touched.length ? `touched ${f.touched.join(', ')}` : 'no symbols touched');
      parts.push(`imported by ${f.importers.length}${f.importersUsingTouched.length ? `, ${f.importersUsingTouched.length} use the touched exports` : ''}`);
      parts.push(f.coveringTests.length ? `tests: ${f.coveringTests.join(', ')}` : 'no test imports it');
    }
    lines.push(`  ${parts.join('  |  ')}`);
    for (const i of f.importersUsingTouched.slice(0, 6)) lines.push(`    used by ${i}`);
  }
  if (impact.hot.length) {
    lines.push('  hot symbols (exported, changed, widely used):');
    for (const h of impact.hot.slice(0, 8)) lines.push(`    ${h.symbol} in ${h.file}: ${h.dependents} dependent file(s)`);
  }
  if (impact.untested.length) lines.push(`  changed exports without a covering test: ${impact.untested.join(', ')}`);
  return lines;
}

export function impactSection(impact: Impact): string {
  const rows = impact.files.filter((f) => f.inGraph && !f.isTest).map((f) => `- ${f.file}: ${f.touched.length ? f.touched.join(', ') : 'no symbols'}; ${f.importers.length} importer(s); ${f.coveringTests.length ? `tests ${f.coveringTests.join(', ')}` : 'no covering test'}`);
  const lines = ['## Impact', `${impact.files.length} file(s) changed, ${impact.transitive} dependent file(s) within 3 hops.`];
  if (rows.length) lines.push(...rows);
  if (impact.hot.length) lines.push(`Hot: ${impact.hot.slice(0, 5).map((h) => `${h.symbol} (${h.dependents} dependents)`).join(', ')}.`);
  if (impact.untested.length) lines.push(`Changed exports without a covering test: ${impact.untested.join(', ')}.`);
  return lines.join('\n');
}

export function impactFindings(impact: Impact): Finding[] {
  const out: Finding[] = [];
  for (const h of impact.hot) {
    const file = impact.files.find((f) => f.file === h.file);
    if (file && !file.coveringTests.length && !impact.testsInChange.length) {
      out.push({ severity: 'major', text: `${h.symbol} in ${h.file} changed and is used by ${h.dependents} file(s), with no test in this change and no test importing the file. add one before merging`, file: h.file });
    }
  }
  return out;
}
