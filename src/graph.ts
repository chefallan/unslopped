import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stateDir } from './state.ts';
import { rank, tokenize } from './search.ts';

export interface GraphConfig {
  enabled: boolean;
  maxFiles: number;
  maxFileKb: number;
  ignore: string[];
}

export interface CodeSymbol {
  name: string;
  kind: string;
  line: number;
  exported: boolean;
}

export type RationaleKind = 'why' | 'constraint' | 'debt';

export interface Rationale {
  line: number;
  kind: RationaleKind;
  text: string;
}

export interface FileNode {
  lang: string;
  mtime: number;
  size: number;
  lines: number;
  symbols: CodeSymbol[];
  imports: string[];
  external: string[];
  uses: Record<string, string[]>;
  headings: string[];
  rationale: Rationale[];
}

export const GRAPH_VERSION = 2;

export interface Graph {
  version: typeof GRAPH_VERSION;
  builtAt: string;
  files: Record<string, FileNode>;
}

export const DEFAULT_IGNORE = ['node_modules', '.git', '.ade', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vscode', '.terraform'];

export function graphDefaults(): GraphConfig {
  return { enabled: true, maxFiles: 20000, maxFileKb: 512, ignore: [...DEFAULT_IGNORE] };
}

export function mergeGraph(raw: Partial<GraphConfig> | undefined): GraphConfig {
  return { ...graphDefaults(), ...(raw ?? {}) };
}

export function graphPath(root: string): string {
  return path.join(stateDir(root), 'graph.json');
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js',
  py: 'py', go: 'go', rs: 'rs', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', swift: 'swift', rb: 'ruby', php: 'php',
  md: 'md', mdx: 'md', sql: 'sql',
};

function ext(file: string): string {
  const i = file.lastIndexOf('.');
  return i === -1 ? '' : file.slice(i + 1).toLowerCase();
}

export function langOf(file: string): string | null {
  return LANG_BY_EXT[ext(file)] ?? null;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function listFiles(root: string, cfg: GraphConfig): string[] {
  const ignored = (p: string) => p.split('/').some((seg) => cfg.ignore.includes(seg));
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let files: string[];
  if (r.status === 0) {
    files = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } else {
    files = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = toPosix(path.relative(root, full));
        if (entry.isDirectory()) {
          if (!cfg.ignore.includes(entry.name)) walk(full);
        } else files.push(rel);
      }
    };
    walk(root);
  }
  return files.filter((f) => langOf(f) && !ignored(f)).slice(0, cfg.maxFiles);
}

interface Extracted {
  symbols: CodeSymbol[];
  specifiers: string[];
  headings: string[];
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function collect(text: string, re: RegExp, pick: (m: RegExpMatchArray) => CodeSymbol | null, symbols: CodeSymbol[]): void {
  for (const m of text.matchAll(re)) {
    const s = pick(m);
    if (s) symbols.push({ ...s, line: lineOf(text, m.index ?? 0) });
  }
}

function specs(text: string, re: RegExp, group = 1): string[] {
  return [...text.matchAll(re)].map((m) => m[group]).filter(Boolean);
}

export function extract(lang: string, text: string): Extracted {
  const symbols: CodeSymbol[] = [];
  let specifiers: string[] = [];
  const headings: string[] = [];
  switch (lang) {
    case 'ts':
    case 'js': {
      specifiers = [
        ...specs(text, /^\s*import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm),
        ...specs(text, /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm),
        ...specs(text, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...specs(text, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ];
      const named = new Set(specs(text, /^\s*export\s*\{([^}]*)\}/gm).flatMap((g) => g.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()?.trim() ?? '')));
      collect(text, /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, (m) => ({ name: m[2], kind: 'function', line: 0, exported: Boolean(m[1]) || named.has(m[2]) }), symbols);
      collect(text, /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, (m) => ({ name: m[2], kind: 'class', line: 0, exported: Boolean(m[1]) || named.has(m[2]) }), symbols);
      collect(text, /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/gm, (m) => ({ name: m[2], kind: 'const', line: 0, exported: Boolean(m[1]) || named.has(m[2]) }), symbols);
      collect(text, /^\s*(export\s+)?(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm, (m) => ({ name: m[3], kind: m[2], line: 0, exported: Boolean(m[1]) || named.has(m[3]) }), symbols);
      break;
    }
    case 'py': {
      specifiers = [...specs(text, /^\s*from\s+([\w.]+)\s+import\b/gm), ...specs(text, /^\s*import\s+([\w.]+)/gm)];
      collect(text, /^(?:async\s+)?def\s+(\w+)/gm, (m) => ({ name: m[1], kind: 'function', line: 0, exported: !m[1].startsWith('_') }), symbols);
      collect(text, /^class\s+(\w+)/gm, (m) => ({ name: m[1], kind: 'class', line: 0, exported: !m[1].startsWith('_') }), symbols);
      collect(text, /^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/gm, (m) => ({ name: m[1], kind: 'const', line: 0, exported: true }), symbols);
      break;
    }
    case 'go': {
      const block = specs(text, /import\s*\(([\s\S]*?)\)/g).flatMap((b) => specs(b, /"([^"]+)"/g));
      specifiers = [...block, ...specs(text, /^\s*import\s+"([^"]+)"/gm)];
      collect(text, /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, (m) => ({ name: m[1], kind: 'func', line: 0, exported: /^[A-Z]/.test(m[1]) }), symbols);
      collect(text, /^type\s+([A-Za-z_]\w*)\s+(struct|interface|func|\w+)/gm, (m) => ({ name: m[1], kind: m[2] === 'struct' || m[2] === 'interface' ? m[2] : 'type', line: 0, exported: /^[A-Z]/.test(m[1]) }), symbols);
      break;
    }
    case 'rs': {
      specifiers = [...specs(text, /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm), ...specs(text, /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm).map((m) => `mod:${m}`)];
      collect(text, /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/gm, (m) => ({ name: m[2], kind: 'fn', line: 0, exported: Boolean(m[1]) }), symbols);
      collect(text, /^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait|type)\s+(\w+)/gm, (m) => ({ name: m[3], kind: m[2], line: 0, exported: Boolean(m[1]) }), symbols);
      break;
    }
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'swift': {
      specifiers = specs(text, /^\s*(?:import|using)\s+(?:static\s+)?([\w.]+)/gm);
      collect(text, /^\s*((?:public|private|protected|internal|open|final|abstract|sealed|static|data|partial|export)\s+)*(class|interface|enum|struct|object|record|protocol|trait)\s+(\w+)/gm, (m) => ({ name: m[3], kind: m[2], line: 0, exported: !/\bprivate\b/.test(m[0]) }), symbols);
      break;
    }
    case 'ruby': {
      specifiers = specs(text, /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm);
      collect(text, /^\s*def\s+(?:self\.)?(\w+[?!=]?)/gm, (m) => ({ name: m[1], kind: 'method', line: 0, exported: true }), symbols);
      collect(text, /^\s*(class|module)\s+([A-Z]\w*)/gm, (m) => ({ name: m[2], kind: m[1], line: 0, exported: true }), symbols);
      break;
    }
    case 'php': {
      specifiers = [...specs(text, /^\s*use\s+([\w\\]+)/gm), ...specs(text, /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)];
      collect(text, /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+(\w+)/gm, (m) => ({ name: m[1], kind: 'function', line: 0, exported: !/\bprivate\b/.test(m[0]) }), symbols);
      collect(text, /^\s*(?:abstract\s+|final\s+)?(class|interface|trait|enum)\s+(\w+)/gm, (m) => ({ name: m[2], kind: m[1], line: 0, exported: true }), symbols);
      break;
    }
    case 'sql': {
      collect(text, /\bcreate\s+(?:or\s+replace\s+)?(table|view|function|procedure|index)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi, (m) => ({ name: m[2].replace(/"/g, ''), kind: m[1].toLowerCase(), line: 0, exported: true }), symbols);
      break;
    }
    case 'md': {
      for (const m of text.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)) headings.push(m[1].trim());
      break;
    }
  }
  symbols.sort((a, b) => a.line - b.line);
  return { symbols, specifiers: [...new Set(specifiers)], headings };
}

function countLines(text: string): number {
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

const COMMENT_PREFIX: Record<string, RegExp> = {
  ts: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  js: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  java: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  kotlin: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  csharp: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  swift: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  go: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  rs: /^\s*(?:\/\/+|\/\*+|\*+)\s?/,
  php: /^\s*(?:\/\/+|\/\*+|\*+|#)\s?/,
  py: /^\s*#+\s?/,
  ruby: /^\s*#+\s?/,
  sql: /^\s*--+\s?/,
};

const DEBT = /\b(TODO|FIXME|HACK|XXX|TEMP|KLUDGE)\b/;
const WHY = /\b(because|so that|to avoid|to prevent|workaround|work around|intentional(?:ly)?|deliberate(?:ly)?|on purpose|trade-?offs?|rationale|the reason|reason:|why:|otherwise|instead of|rather than|since .* (?:would|breaks|fails))\b/i;
const CONSTRAINT_WORDS = /\b(must not|must|never|do not|don't|always|invariant|required by|keep this)\b/i;
const CONSTRAINT_MARKERS = /\b(IMPORTANT|WARNING|CAUTION)\b/;
const CONSTRAINT = { test: (s: string) => CONSTRAINT_WORDS.test(s) || CONSTRAINT_MARKERS.test(s) };
const LOOKS_LIKE_CODE = /[;{}]\s*$|^\s*(?:const|let|var|return|if|for|while|import|export|function|def|class)\b|=>|\(\)/;
const NOISE_COMMENT = /eslint|prettier|@ts-|noqa|pylint|copyright|license|licence|SPDX|^\s*$/i;
const BLOCK_START = /^\s*\/\*/;
const BLOCK_END = /\*\/\s*$/;

function classify(text: string): RationaleKind | null {
  if (DEBT.test(text)) return 'debt';
  if (CONSTRAINT.test(text)) return 'constraint';
  if (WHY.test(text)) return 'why';
  return null;
}

export function extractRationale(lang: string, text: string): Rationale[] {
  const out: Rationale[] = [];
  const lines = text.split(/\r?\n/);
  if (lang === 'md') {
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^#{1,4}\s+(.*(?:why|rationale|decision|trade-?offs?|design|constraints?|non-goals?|known issues?).*)$/i);
      if (!h) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && body.length < 2; j++) {
        if (/^#{1,6}\s/.test(lines[j])) break;
        if (lines[j].trim()) body.push(lines[j].trim());
      }
      if (body.length) out.push({ line: i + 1, kind: 'why', text: `${h[1].trim()}: ${body.join(' ')}`.slice(0, 240) });
    }
    return out.slice(0, 30);
  }
  const prefix = COMMENT_PREFIX[lang];
  if (!prefix) return out;
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!prefix.test(raw) || NOISE_COMMENT.test(raw)) {
      i++;
      continue;
    }
    const start = i;
    const parts: string[] = [];
    while (i < lines.length && prefix.test(lines[i]) && parts.length < 4) {
      if (i > start && (BLOCK_START.test(lines[i]) || BLOCK_END.test(lines[i - 1]) || DEBT.test(lines[i]))) break;
      const stripped = lines[i].replace(prefix, '').replace(/\*\/\s*$/, '').trim();
      if (stripped && !LOOKS_LIKE_CODE.test(stripped)) parts.push(stripped);
      i++;
      if (DEBT.test(lines[i - 1])) break;
    }
    const joined = parts.join(' ').trim();
    if (!joined || joined.length < 12) continue;
    const kind = classify(joined);
    if (kind) out.push({ line: start + 1, kind, text: joined.slice(0, 240) });
  }
  return out.slice(0, 30);
}

const JS_EXTS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

function resolveSpecifier(from: string, spec: string, lang: string, known: Set<string>, goModule: string | null): string | null {
  const dir = path.posix.dirname(from);
  const tryAll = (bases: string[], suffixes: string[]): string | null => {
    for (const b of bases) for (const s of suffixes) {
      const candidate = path.posix.normalize(b + s).replace(/^\.\//, '');
      if (known.has(candidate)) return candidate;
    }
    return null;
  };
  if (lang === 'ts' || lang === 'js') {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
    const base = path.posix.join(dir, spec);
    const swapped = base.replace(/\.(js|mjs|cjs|jsx)$/, (_, e: string) => ({ js: '.ts', mjs: '.mts', cjs: '.cts', jsx: '.tsx' })[e] ?? '');
    return tryAll([base, swapped], JS_EXTS);
  }
  if (lang === 'py') {
    const rel = spec.match(/^(\.+)(.*)$/);
    let base: string;
    if (rel) {
      let d = dir;
      for (let i = 1; i < rel[1].length; i++) d = path.posix.dirname(d);
      base = path.posix.join(d, rel[2].replace(/\./g, '/'));
    } else base = spec.replace(/\./g, '/');
    return tryAll([base, path.posix.join('src', base)], ['.py', '/__init__.py']);
  }
  if (lang === 'go' && goModule && spec.startsWith(goModule)) {
    const d = spec.slice(goModule.length).replace(/^\//, '') || '.';
    for (const f of known) if (path.posix.dirname(f) === d && f.endsWith('.go') && !f.endsWith('_test.go')) return f;
    return null;
  }
  if (lang === 'rs') {
    if (spec.startsWith('mod:')) return tryAll([path.posix.join(dir, spec.slice(4))], ['.rs', '/mod.rs']);
    const parts = spec.split('::').filter((p) => p && p !== 'self' && p !== 'super');
    if (parts[0] === 'crate') {
      const rest = parts.slice(1);
      for (let n = rest.length; n >= 1; n--) {
        const hit = tryAll([path.posix.join('src', ...rest.slice(0, n))], ['.rs', '/mod.rs']);
        if (hit) return hit;
      }
    }
    return null;
  }
  return null;
}

function readGoModule(root: string): string | null {
  try {
    const m = fs.readFileSync(path.join(root, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function loadGraph(root: string): Graph | null {
  try {
    const g = JSON.parse(fs.readFileSync(graphPath(root), 'utf8')) as Graph;
    return g.version === GRAPH_VERSION && g.files ? g : null;
  } catch {
    return null;
  }
}

export function saveGraph(root: string, graph: Graph): void {
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(graphPath(root), JSON.stringify(graph));
}

export interface RefreshResult {
  graph: Graph;
  scanned: number;
  changed: number;
  removed: number;
  ms: number;
}

export function refreshGraph(root: string, cfg: GraphConfig = graphDefaults()): RefreshResult {
  const started = Date.now();
  const previous = loadGraph(root);
  const graph: Graph = { version: GRAPH_VERSION, builtAt: new Date().toISOString(), files: {} };
  const files = listFiles(root, cfg);
  const known = new Set(files);
  const texts = new Map<string, string>();
  let changed = 0;
  for (const f of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(root, f));
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > cfg.maxFileKb * 1024) continue;
    const old = previous?.files[f];
    if (old && old.mtime === stat.mtimeMs && old.size === stat.size) {
      graph.files[f] = old;
      continue;
    }
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (text.includes('\u0000')) continue;
    texts.set(f, text);
    const lang = langOf(f) ?? 'text';
    const e = extract(lang, text);
    graph.files[f] = { lang, mtime: stat.mtimeMs, size: stat.size, lines: countLines(text), symbols: e.symbols.slice(0, 400), imports: [], external: e.specifiers, uses: {}, headings: e.headings.slice(0, 40), rationale: extractRationale(lang, text) };
    changed++;
  }
  const removed = previous ? Object.keys(previous.files).filter((f) => !graph.files[f]).length : 0;
  const goModule = readGoModule(root);
  const dirty = new Set(texts.keys());
  for (const [f, node] of Object.entries(graph.files)) {
    if (!dirty.has(f) && !node.external.some((s) => {
      const target = resolveSpecifier(f, s, node.lang, known, goModule);
      return target && dirty.has(target);
    })) continue;
    const text = texts.get(f) ?? safeRead(root, f);
    const imports: string[] = [];
    const external: string[] = [];
    const uses: Record<string, string[]> = {};
    for (const spec of node.external.length || !previous?.files[f] ? node.external : previous.files[f].external.concat(previous.files[f].imports)) {
      const target = resolveSpecifier(f, spec, node.lang, known, goModule);
      if (!target || target === f) {
        if (!spec.startsWith('mod:')) external.push(spec);
        continue;
      }
      imports.push(target);
      const exported = (graph.files[target]?.symbols ?? []).filter((s) => s.exported).map((s) => s.name);
      const used = exported.filter((name) => new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(text)).slice(0, 20);
      if (used.length) uses[target] = used;
    }
    graph.files[f] = { ...node, imports: [...new Set(imports)], external: [...new Set(external)], uses };
  }
  saveGraph(root, graph);
  if (changed || removed || !previous) {
    try {
      writeReport(root, graph);
      writeHtml(root, graph);
    } catch {
      // derived views are best effort; the graph itself is saved
    }
  }
  return { graph, scanned: files.length, changed, removed, ms: Date.now() - started };
}

function safeRead(root: string, f: string): string {
  try {
    return fs.readFileSync(path.join(root, f), 'utf8');
  } catch {
    return '';
  }
}

export function importers(graph: Graph, file: string): string[] {
  return Object.entries(graph.files).filter(([, n]) => n.imports.includes(file)).map(([f]) => f);
}

function area(file: string): string {
  const parts = file.split('/');
  return parts.length > 1 ? parts[0] : '(root)';
}

export function summarize(graph: Graph): { files: number; symbols: number; areas: Array<{ name: string; files: number; symbols: number }>; godFiles: Array<{ file: string; importers: number; symbols: string[] }>; entryPoints: string[] } {
  const entries = Object.entries(graph.files);
  const byArea = new Map<string, { files: number; symbols: number }>();
  const inbound = new Map<string, number>();
  for (const [f, n] of entries) {
    const a = byArea.get(area(f)) ?? { files: 0, symbols: 0 };
    a.files++;
    a.symbols += n.symbols.length;
    byArea.set(area(f), a);
    for (const t of n.imports) inbound.set(t, (inbound.get(t) ?? 0) + 1);
  }
  const godFiles = [...inbound.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
    .map(([file, count]) => ({ file, importers: count, symbols: (graph.files[file]?.symbols ?? []).filter((s) => s.exported).map((s) => s.name).slice(0, 6) }));
  const entryPoints = entries
    .filter(([f, n]) => n.lang !== 'md' && !inbound.has(f) && n.imports.length > 0)
    .map(([f]) => f)
    .sort((a, b) => a.length - b.length)
    .slice(0, 8);
  return {
    files: entries.length,
    symbols: entries.reduce((n, [, f]) => n + f.symbols.length, 0),
    areas: [...byArea.entries()].map(([name, a]) => ({ name, ...a })).sort((x, y) => y.files - x.files).slice(0, 12),
    godFiles,
    entryPoints,
  };
}

export function report(graph: Graph): string {
  const s = summarize(graph);
  const lines = [`# Code map: ${s.files} files, ${s.symbols} symbols, built ${graph.builtAt}`, '', '## Areas', ...s.areas.map((a) => `- ${a.name}: ${a.files} file(s), ${a.symbols} symbol(s)`), '', '## Most depended on'];
  lines.push(...(s.godFiles.length ? s.godFiles.map((g) => `- ${g.file}: imported by ${g.importers}${g.symbols.length ? `, exports ${g.symbols.join(', ')}` : ''}`) : ['- none resolved yet']));
  lines.push('', '## Entry points', ...(s.entryPoints.length ? s.entryPoints.map((f) => `- ${f}`) : ['- none detected']));
  const docs = Object.entries(graph.files).filter(([, n]) => n.headings.length).slice(0, 6);
  if (docs.length) lines.push('', '## Docs', ...docs.map(([f, n]) => `- ${f}: ${n.headings.slice(0, 5).join(' | ')}`));
  lines.push('', 'Query: ade graph "<words>"');
  return lines.join('\n') + '\n';
}

export interface GraphHit {
  file: string;
  lang: string;
  lines: number;
  score: number;
  symbols: string[];
  imports: string[];
  importedBy: string[];
  headings: string[];
}

function fileText(file: string, n: FileNode): string {
  const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
  return `${file} ${base} ${base} ${n.symbols.map((s) => `${s.name} ${s.name.replace(/([a-z])([A-Z])/g, '$1 $2')}`).join(' ')} ${n.headings.join(' ')} ${n.imports.map((i) => path.posix.basename(i)).join(' ')}`;
}

export function queryGraph(graph: Graph, query: string, limit = 5): GraphHit[] {
  const docs = Object.entries(graph.files).map(([file, n]) => ({ file, n, text: fileText(file, n) }));
  const q = new Set(tokenize(query));
  return rank(query, docs, limit).map((r) => {
    const matching = r.n.symbols.filter((s) => q.has(s.name.toLowerCase()) || tokenize(s.name.replace(/([a-z])([A-Z])/g, '$1 $2')).some((t) => q.has(t)));
    const rest = r.n.symbols.filter((s) => s.exported && !matching.includes(s));
    return {
      file: r.file,
      lang: r.n.lang,
      lines: r.n.lines,
      score: Number(r.score.toFixed(2)),
      symbols: [...matching, ...rest].slice(0, 12).map((s) => `${s.name}${s.kind === 'function' || s.kind === 'fn' || s.kind === 'func' || s.kind === 'method' ? '()' : ''}:${s.line}`),
      imports: r.n.imports.slice(0, 6),
      importedBy: importers(graph, r.file).slice(0, 6),
      headings: r.n.headings.slice(0, 4),
    };
  });
}

export function formatHits(hits: GraphHit[]): string[] {
  const lines: string[] = [];
  for (const h of hits) {
    lines.push(`${h.file}  (${h.lang}, ${h.lines} lines)`);
    if (h.symbols.length) lines.push(`  symbols    ${h.symbols.join(', ')}`);
    if (h.headings.length) lines.push(`  headings   ${h.headings.join(' | ')}`);
    if (h.imports.length) lines.push(`  imports    ${h.imports.join(', ')}`);
    if (h.importedBy.length) lines.push(`  imported by ${h.importedBy.join(', ')}`);
  }
  return lines;
}

export function graphContext(graph: Graph, prompt: string, cmd = 'ade', limit = 3): string[] {
  const hits = queryGraph(graph, prompt, limit);
  if (!hits.length) return [`Code map: ${Object.keys(graph.files).length} files indexed. Before reading or searching files, run ${cmd} graph "<words>" and read only what it points to.`];
  const lines = ['Code map for this request (read these before searching):'];
  for (const h of hits) lines.push(`  ${h.file}${h.symbols.length ? `: ${h.symbols.slice(0, 6).join(', ')}` : ''}${h.importedBy.length ? ` (imported by ${h.importedBy.length})` : ''}`);
  const note = (graph.files[hits[0].file]?.rationale ?? []).find((r) => r.kind !== 'debt');
  if (note) lines.push(`  note ${hits[0].file}:${note.line} ${note.text.slice(0, 140)}`);
  lines.push(`More: ${cmd} graph "<words>", ${cmd} graph why "<topic>", ${cmd} graph impact`);
  return lines;
}

export function findFile(graph: Graph, query: string): string[] {
  const q = toPosix(query.trim()).replace(/^\.\//, '');
  if (!q) return [];
  const files = Object.keys(graph.files);
  if (graph.files[q]) return [q];
  const base = (f: string) => path.posix.basename(f);
  const stem = (f: string) => base(f).replace(/\.[^.]+$/, '');
  const tiers = [
    files.filter((f) => f.endsWith('/' + q)),
    files.filter((f) => base(f) === q || stem(f) === q),
    files.filter((f) => f.toLowerCase().includes(q.toLowerCase())),
  ];
  for (const t of tiers) if (t.length) return t.sort((a, b) => a.length - b.length);
  return [];
}

export interface Neighbour {
  file: string;
  uses: string[];
}

export interface NodeView {
  file: string;
  node: FileNode;
  imports: Neighbour[];
  importedBy: Neighbour[];
}

export function nodeView(graph: Graph, file: string): NodeView | null {
  const node = graph.files[file];
  if (!node) return null;
  return {
    file,
    node,
    imports: node.imports.map((f) => ({ file: f, uses: node.uses[f] ?? [] })),
    importedBy: importers(graph, file).map((f) => ({ file: f, uses: graph.files[f]?.uses[file] ?? [] })),
  };
}

export function formatNode(v: NodeView): string[] {
  const lines = [`${v.file}  (${v.node.lang}, ${v.node.lines} lines, ${v.node.symbols.length} symbols)`];
  const exported = v.node.symbols.filter((s) => s.exported);
  const internal = v.node.symbols.filter((s) => !s.exported);
  if (exported.length) lines.push(`  exports     ${exported.map((s) => `${s.name}:${s.line}`).join(', ')}`);
  if (internal.length) lines.push(`  internal    ${internal.slice(0, 15).map((s) => `${s.name}:${s.line}`).join(', ')}${internal.length > 15 ? `, +${internal.length - 15}` : ''}`);
  if (v.node.headings.length) lines.push(`  headings    ${v.node.headings.slice(0, 8).join(' | ')}`);
  const notes = (v.node.rationale ?? []).slice(0, 6);
  if (notes.length) {
    lines.push('  rationale');
    for (const r of notes) lines.push(`    :${r.line} [${r.kind}] ${r.text}`);
  }
  lines.push(`  imports     ${v.imports.length ? '' : 'none in repo'}`);
  for (const i of v.imports) lines.push(`    ${i.file}${i.uses.length ? `  uses ${i.uses.join(', ')}` : ''}`);
  if (v.node.external.length) lines.push(`  external    ${v.node.external.slice(0, 12).join(', ')}`);
  lines.push(`  imported by ${v.importedBy.length ? '' : 'nothing'}`);
  for (const i of v.importedBy) lines.push(`    ${i.file}${i.uses.length ? `  uses ${i.uses.join(', ')}` : ''}`);
  return lines;
}

export interface PathResult {
  files: string[];
  directed: boolean;
}

export function shortestPath(graph: Graph, from: string, to: string): PathResult | null {
  if (!graph.files[from] || !graph.files[to]) return null;
  const search = (next: (f: string) => string[]): string[] | null => {
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) {
        const out: string[] = [];
        for (let f: string | null = cur; f; f = prev.get(f) ?? null) out.unshift(f);
        return out;
      }
      for (const n of next(cur)) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          queue.push(n);
        }
      }
    }
    return null;
  };
  const directed = search((f) => graph.files[f]?.imports ?? []);
  if (directed) return { files: directed, directed: true };
  const undirected = search((f) => [...(graph.files[f]?.imports ?? []), ...importers(graph, f)]);
  return undirected ? { files: undirected, directed: false } : null;
}

export function formatPath(graph: Graph, p: PathResult): string[] {
  const lines = [p.directed ? `import chain, ${p.files.length - 1} hop(s):` : `no import chain in one direction; connected through ${p.files.length - 1} hop(s):`];
  for (let i = 0; i < p.files.length; i++) {
    const f = p.files[i];
    if (i === 0) {
      lines.push(`  ${f}`);
      continue;
    }
    const prev = p.files[i - 1];
    const forward = graph.files[prev]?.imports.includes(f);
    const uses = forward ? graph.files[prev]?.uses[f] ?? [] : graph.files[f]?.uses[prev] ?? [];
    lines.push(`  ${forward ? 'imports' : 'imported by'} ${f}${uses.length ? `  (${uses.join(', ')})` : ''}`);
  }
  return lines;
}

export interface CrossEdge {
  from: string;
  to: string;
  fromArea: string;
  toArea: string;
}

export function crossAreaEdges(graph: Graph): { pairs: Array<{ from: string; to: string; count: number; edges: CrossEdge[] }>; surprising: Array<{ from: string; to: string; count: number; edges: CrossEdge[] }> } {
  const byPair = new Map<string, { from: string; to: string; count: number; edges: CrossEdge[] }>();
  for (const [f, n] of Object.entries(graph.files)) {
    for (const t of n.imports) {
      const a = area(f);
      const b = area(t);
      if (a === b) continue;
      const key = `${a}>${b}`;
      const p = byPair.get(key) ?? { from: a, to: b, count: 0, edges: [] };
      p.count++;
      if (p.edges.length < 5) p.edges.push({ from: f, to: t, fromArea: a, toArea: b });
      byPair.set(key, p);
    }
  }
  const pairs = [...byPair.values()].sort((x, y) => y.count - x.count || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  const surprising = pairs.filter((p) => p.count <= 2 && p.to !== '(root)').slice(0, 10);
  return { pairs, surprising };
}

export function fullReport(graph: Graph): string {
  const s = summarize(graph);
  const cross = crossAreaEdges(graph);
  const lines = [report(graph).trimEnd(), '', '## Cross-area imports'];
  lines.push(...(cross.pairs.length ? cross.pairs.slice(0, 12).map((p) => `- ${p.from} -> ${p.to}: ${p.count} import(s)`) : ['- none']));
  if (cross.surprising.length) {
    lines.push('', '## Surprising connections (rare imports across areas, worth knowing before you change either side)');
    for (const p of cross.surprising) for (const e of p.edges) lines.push(`- ${e.from} -> ${e.to}${graph.files[e.from]?.uses[e.to]?.length ? ` uses ${graph.files[e.from].uses[e.to].join(', ')}` : ''}`);
  }
  const all = allRationale(graph);
  const design = all.filter((r) => r.kind !== 'debt').slice(0, 15);
  if (design.length) {
    lines.push('', '## Design rationale (from comments and docs)');
    for (const r of design) lines.push(`- ${r.file}:${r.line} ${r.text}`);
  }
  const debt = all.filter((r) => r.kind === 'debt');
  if (debt.length) {
    lines.push('', `## Technical debt (${debt.length} marker${debt.length === 1 ? '' : 's'})`);
    for (const r of debt.slice(0, 8)) lines.push(`- ${r.file}:${r.line} ${r.text}`);
    if (debt.length > 8) lines.push(`- +${debt.length - 8} more: ade graph why "todo"`);
  }
  lines.push('', '## Suggested queries');
  for (const g of s.godFiles.slice(0, 3)) lines.push(`- ade graph node ${g.file}`);
  if (s.entryPoints[0] && s.godFiles[0]) lines.push(`- ade graph path ${s.entryPoints[0]} ${s.godFiles[0].file}`);
  lines.push('- ade graph why "<topic>"', '- ade graph impact', '- ade graph "<words from the request>"');
  return lines.join('\n') + '\n';
}

export interface RationaleHit extends Rationale {
  file: string;
  score?: number;
}

export function allRationale(graph: Graph): RationaleHit[] {
  const out: RationaleHit[] = [];
  for (const [file, n] of Object.entries(graph.files)) for (const r of n.rationale ?? []) out.push({ file, ...r });
  const order: Record<RationaleKind, number> = { constraint: 0, why: 1, debt: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.file.localeCompare(b.file) || a.line - b.line);
}

export function queryRationale(graph: Graph, query: string, limit = 8): RationaleHit[] {
  const docs = allRationale(graph).map((r) => ({ ...r, text: r.text, search: `${r.file} ${r.kind} ${r.text}` }));
  return rank(query, docs.map((d) => ({ ...d, text: d.search })), limit).map((r) => {
    const original = docs.find((d) => d.file === r.file && d.line === r.line)!;
    return { file: r.file, line: r.line, kind: r.kind, text: original.text, score: Number(r.score.toFixed(2)) };
  });
}

export function reportPath(root: string): string {
  return path.join(stateDir(root), 'GRAPH.md');
}

export function htmlPath(root: string): string {
  return path.join(stateDir(root), 'graph.html');
}

export function writeReport(root: string, graph: Graph): string {
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(reportPath(root), fullReport(graph));
  return reportPath(root);
}

const MAX_HTML_NODES = 1500;

export function htmlPage(graph: Graph, maxNodes = MAX_HTML_NODES): string {
  const inbound = new Map<string, number>();
  for (const n of Object.values(graph.files)) for (const t of n.imports) inbound.set(t, (inbound.get(t) ?? 0) + 1);
  const ranked = Object.entries(graph.files)
    .map(([file, n]) => ({ file, n, weight: (inbound.get(file) ?? 0) * 3 + n.symbols.length + n.imports.length }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxNodes);
  const kept = new Set(ranked.map((r) => r.file));
  const nodes = ranked.map((r) => ({
    id: r.file,
    area: area(r.file),
    lang: r.n.lang,
    lines: r.n.lines,
    importers: inbound.get(r.file) ?? 0,
    symbols: r.n.symbols.slice(0, 40).map((s) => `${s.name}:${s.line}${s.exported ? '' : ' (internal)'}`),
    rationale: (r.n.rationale ?? []).slice(0, 8).map((x) => `:${x.line} [${x.kind}] ${x.text}`),
    imports: r.n.imports,
    uses: r.n.uses,
    external: r.n.external.slice(0, 12),
    headings: r.n.headings.slice(0, 8),
  }));
  const edges: Array<[string, string]> = [];
  for (const r of ranked) for (const t of r.n.imports) if (kept.has(t)) edges.push([r.file, t]);
  const data = JSON.stringify({ builtAt: graph.builtAt, total: Object.keys(graph.files).length, nodes, edges }).replace(/<\//g, '<\\/');
  return `<!doctype html>
<meta charset="utf-8">
<title>ADE code map</title>
<style>
body{margin:0;font:13px/1.4 system-ui,sans-serif;background:#12141a;color:#d8dbe2;display:flex;height:100vh;overflow:hidden}
canvas{flex:1;display:block;cursor:grab}
#side{width:340px;overflow:auto;padding:12px 14px;border-left:1px solid #2a2e38;background:#171a22}
h1{font-size:14px;margin:0 0 8px}
input{width:100%;box-sizing:border-box;padding:6px 8px;margin:0 0 10px;background:#0f1116;color:#d8dbe2;border:1px solid #333a48;border-radius:4px}
.k{color:#8fb4ff}.m{color:#8a90a0}.f{color:#e6b96f}
ul{margin:4px 0 10px;padding-left:16px}li{margin:1px 0}
a{color:#8fb4ff;cursor:pointer;text-decoration:none}a:hover{text-decoration:underline}
</style>
<canvas id="c"></canvas>
<div id="side">
<h1>ADE code map</h1>
<input id="q" placeholder="filter by file or symbol">
<div id="info" class="m">Click a node. Drag to move. Wheel to zoom.</div>
</div>
<script>
const DATA=${data};
const byId=new Map(DATA.nodes.map(n=>[n.id,n]));
const importedBy=new Map();for(const [a,b] of DATA.edges){if(!importedBy.has(b))importedBy.set(b,[]);importedBy.get(b).push(a);}
const areas=[...new Set(DATA.nodes.map(n=>n.area))];
const color=a=>'hsl('+(areas.indexOf(a)*137)%360+',60%,60%)';
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),info=document.getElementById('info'),q=document.getElementById('q');
const W=()=>cv.clientWidth,H=()=>cv.clientHeight;
function resize(){cv.width=W()*devicePixelRatio;cv.height=H()*devicePixelRatio;}
window.addEventListener('resize',resize);resize();
const N=DATA.nodes.map((n,i)=>({...n,x:W()/2+Math.cos(i)*200*Math.random(),y:H()/2+Math.sin(i)*200*Math.random(),vx:0,vy:0,r:4+Math.min(14,Math.sqrt(n.importers)*3)}));
const idx=new Map(N.map(n=>[n.id,n]));
const E=DATA.edges.map(([a,b])=>[idx.get(a),idx.get(b)]).filter(e=>e[0]&&e[1]);
let sel=null,filter='',drag=null,zoom=1,ox=0,oy=0,tick=0;
function step(){
  const k=0.85;
  for(const a of N){a.vx*=k;a.vy*=k;}
  for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){const a=N[i],b=N[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy+0.01;if(d2>90000)continue;const f=1200/d2;dx*=f;dy*=f;a.vx-=dx;a.vy-=dy;b.vx+=dx;b.vy+=dy;}
  for(const [a,b] of E){const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-80)*0.01;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
  for(const a of N){a.vx+=(W()/2-a.x)*0.002;a.vy+=(H()/2-a.y)*0.002;if(a!==drag){a.x+=a.vx;a.y+=a.vy;}}
}
function match(n){if(!filter)return true;const f=filter.toLowerCase();return n.id.toLowerCase().includes(f)||n.symbols.some(s=>s.toLowerCase().includes(f));}
function draw(){
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,W(),H());
  ctx.save();ctx.translate(ox,oy);ctx.scale(zoom,zoom);
  for(const [a,b] of E){const hot=sel&&(a===sel||b===sel);ctx.strokeStyle=hot?'#e6b96f':'rgba(140,150,170,0.18)';ctx.lineWidth=hot?1.5:0.6;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  for(const n of N){const on=match(n);ctx.globalAlpha=on?1:0.15;ctx.fillStyle=n===sel?'#fff':color(n.area);ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,7);ctx.fill();if(on&&(n.r>7||n===sel||zoom>1.6)){ctx.fillStyle='#d8dbe2';ctx.font='11px system-ui';ctx.fillText(n.id.split('/').pop(),n.x+n.r+3,n.y+4);}}
  ctx.globalAlpha=1;ctx.restore();
}
function loop(){if(tick<600||drag){step();tick++;}draw();requestAnimationFrame(loop);}loop();
function pick(mx,my){const x=(mx-ox)/zoom,y=(my-oy)/zoom;let best=null,bd=1e9;for(const n of N){const d=(n.x-x)**2+(n.y-y)**2;if(d<(n.r+4)**2&&d<bd){bd=d;best=n;}}return best;}
function show(n){sel=n;if(!n){info.innerHTML='<span class="m">Click a node.</span>';return;}
  const li=(xs,f)=>xs.length?'<ul>'+xs.map(f).join('')+'</ul>':'<div class="m">none</div>';
  const link=id=>'<a data-id="'+id+'">'+id+'</a>';
  info.innerHTML='<b>'+n.id+'</b><div class="m">'+n.lang+', '+n.lines+' lines, '+n.importers+' importer(s), area '+n.area+'</div>'
   +'<div class="k">symbols</div>'+li(n.symbols,s=>'<li>'+s+'</li>')
   +(n.headings.length?'<div class="k">headings</div>'+li(n.headings,h=>'<li>'+h+'</li>'):'')
   +(n.rationale.length?'<div class="k">rationale</div>'+li(n.rationale,r=>'<li>'+r+'</li>'):'')
   +'<div class="k">imports</div>'+li(n.imports,f=>'<li>'+link(f)+(n.uses[f]?' <span class="f">'+n.uses[f].join(', ')+'</span>':'')+'</li>')
   +'<div class="k">imported by</div>'+li(importedBy.get(n.id)||[],f=>'<li>'+link(f)+((byId.get(f)||{uses:{}}).uses[n.id]?' <span class="f">'+byId.get(f).uses[n.id].join(', ')+'</span>':'')+'</li>')
   +(n.external.length?'<div class="k">external</div>'+li(n.external,e=>'<li>'+e+'</li>'):'');
  info.querySelectorAll('a[data-id]').forEach(a=>a.onclick=()=>{const t=idx.get(a.dataset.id);if(t){show(t);ox=W()/2-t.x*zoom;oy=H()/2-t.y*zoom;}});
}
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);if(n){drag=n;show(n);}else drag={pan:true,sx:e.offsetX-ox,sy:e.offsetY-oy};});
cv.addEventListener('mousemove',e=>{if(!drag)return;if(drag.pan){ox=e.offsetX-drag.sx;oy=e.offsetY-drag.sy;}else{drag.x=(e.offsetX-ox)/zoom;drag.y=(e.offsetY-oy)/zoom;}});
window.addEventListener('mouseup',()=>{drag=null;});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.1:0.9;const mx=e.offsetX,my=e.offsetY;ox=mx-(mx-ox)*f;oy=my-(my-oy)*f;zoom*=f;},{passive:false});
q.addEventListener('input',()=>{filter=q.value.trim();});
document.title='ADE code map: '+DATA.total+' files';
</script>
`;
}

export function writeHtml(root: string, graph: Graph): string {
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(htmlPath(root), htmlPage(graph));
  return htmlPath(root);
}

export function ensureGraph(root: string, cfg: GraphConfig): Graph | null {
  if (!cfg.enabled) return null;
  try {
    return refreshGraph(root, cfg).graph;
  } catch {
    return loadGraph(root);
  }
}
