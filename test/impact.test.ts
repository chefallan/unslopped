import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractRationale, refreshGraph, graphDefaults, queryRationale, fullReport, formatNode, nodeView, graphContext, htmlPage } from '../src/graph.ts';
import { enclosingSymbols, changedLinesFromDiff, changedLinesFromPatches, computeImpact, formatImpact, impactSection, impactFindings, localChanges } from '../src/impact.ts';
import { DEFAULT_TEST_PATTERNS } from '../src/practices.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS } from './helpers.ts';

function write(dir: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

test('rationale is mined from comments, doc sections, code, noise are skipped', () => {
  const ts = extractRationale('ts', [
    '// eslint-disable-next-line no-console',
    '// Copyright 2026 Someone',
    'import fs from "node:fs";',
    '// We retry three times because the upstream API drops idle connections',
    '// and a single attempt fails about 2% of the time.',
    'const RETRIES = 3;',
    '// TODO: move to config',
    '/* IMPORTANT: this must run before saveState, otherwise the hash is stale */',
    '// const old = 1;',
    '// increments the counter',
    'function f() {}',
  ].join('\n'));
  assert.deepEqual(ts.map((r) => [r.line, r.kind]), [[4, 'why'], [7, 'debt'], [8, 'constraint']]);
  assert.match(ts[0].text, /^We retry three times because the upstream API drops idle connections and a single attempt/);
  assert.equal(ts[2].text, 'IMPORTANT: this must run before saveState, otherwise the hash is stale');

  const py = extractRationale('py', '# FIXME handle None\nx = 1\n# We flush here so that the reader sees a whole file or nothing\n');
  assert.deepEqual(py.map((r) => r.kind), ['debt', 'why']);

  const md = extractRationale('md', '# Guide\n\n## Why a state machine\n\nGates need an order.\nSkipping is the failure mode.\n\n## Install\n\nnpm i\n\n### Trade-offs\n\nRegex over AST.\n');
  assert.deepEqual(md.map((r) => [r.line, r.text]), [[3, 'Why a state machine: Gates need an order. Skipping is the failure mode.'], [12, 'Trade-offs: Regex over AST.']]);
  assert.deepEqual(extractRationale('go', 'package x\n'), []);
});

test('rationale shows up in the report, node view, why query, prompt context, html', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/cache.ts', '// We cap the cache at 500 entries because the p95 latency doubles past that.\nexport function put(k: string) { return k; }\n// TODO evict by age\n');
  write(dir, 'src/app.ts', "import { put } from './cache.ts';\nput('x');\n");
  write(dir, 'docs/DESIGN.md', '# Design\n\n## Why regex\n\nNo native dependencies.\n');
  const graph = refreshGraph(dir, graphDefaults()).graph;
  assert.equal(graph.version, 2);
  const report = fullReport(graph);
  assert.match(report, /## Design rationale \(from comments and docs\)\n- docs\/DESIGN\.md:3 Why regex: No native dependencies\.\n- src\/cache\.ts:1 We cap the cache/);
  assert.match(report, /## Technical debt \(1 marker\)\n- src\/cache\.ts:3 TODO evict by age/);
  assert.match(report, /- ade graph why "<topic>"\n- ade graph impact/);
  assert.match(formatNode(nodeView(graph, 'src/cache.ts')!).join('\n'), /rationale\n    :1 \[why\] We cap the cache/);
  const why = queryRationale(graph, 'cache latency');
  assert.equal(why[0].file, 'src/cache.ts');
  assert.equal(why[0].kind, 'why');
  assert.match(why[0].text, /^We cap the cache/);
  assert.equal(queryRationale(graph, 'unrelated zzz').length, 0);
  const ctx = graphContext(graph, 'make the cache bigger');
  assert.match(ctx.join('\n'), /note src\/cache\.ts:1 We cap the cache at 500/);
  assert.match(htmlPage(graph), /"rationale":\[":1 \[why\] We cap the cache/);
});

test('changed lines map to enclosing symbols, to dependents, tests, hot exports', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/core.ts', 'export function parse(s: string) {\n  return s;\n}\nexport function format(s: string) {\n  return s;\n}\nfunction internal() {}\n');
  write(dir, 'src/a.ts', "import { parse } from './core.ts';\nparse('a');\n");
  write(dir, 'src/b.ts', "import { parse, format } from './core.ts';\nparse('b'); format('b');\n");
  write(dir, 'src/c.ts', "import { parse } from './core.ts';\nparse('c');\n");
  write(dir, 'src/d.ts', "import { x } from './c.ts';\n");
  write(dir, 'test/core.test.ts', "import { format } from '../src/core.ts';\nformat('t');\n");
  const graph = refreshGraph(dir, graphDefaults()).graph;
  const core = graph.files['src/core.ts'];
  assert.deepEqual(enclosingSymbols(core, [2]), ['parse']);
  assert.deepEqual(enclosingSymbols(core, [5, 7]), ['format', 'internal']);
  assert.deepEqual(enclosingSymbols(core, []), []);

  const impact = computeImpact(graph, new Map([['src/core.ts', [2]]]), DEFAULT_TEST_PATTERNS);
  const f = impact.files[0];
  assert.deepEqual(f.touched, ['parse']);
  assert.deepEqual(f.touchedExported, ['parse']);
  assert.deepEqual(f.importers.sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts', 'test/core.test.ts']);
  assert.deepEqual(f.importersUsingTouched.sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  assert.deepEqual(f.coveringTests, ['test/core.test.ts']);
  assert.equal(impact.transitive, 5);
  assert.deepEqual(impact.hot, [{ file: 'src/core.ts', symbol: 'parse', dependents: 3 }]);
  assert.deepEqual(impact.untested, []);
  const text = formatImpact(impact).join('\n');
  assert.match(text, /impact of 1 changed file\(s\), 5 dependent file\(s\) within 3 hops/);
  assert.match(text, /src\/core\.ts  \|  touched parse  \|  imported by 4, 3 use the touched exports  \|  tests: test\/core\.test\.ts/);
  assert.match(text, /hot symbols[\s\S]*parse in src\/core\.ts: 3 dependent file\(s\)/);
  assert.equal(impactFindings(impact).length, 0);

  write(dir, 'src/lonely.ts', 'export function solo() {}\n');
  write(dir, 'src/e.ts', "import { solo } from './lonely.ts';\nsolo();\n");
  write(dir, 'src/f.ts', "import { solo } from './lonely.ts';\nsolo();\n");
  write(dir, 'src/g.ts', "import { solo } from './lonely.ts';\nsolo();\n");
  const g2 = refreshGraph(dir, graphDefaults()).graph;
  const risky = computeImpact(g2, new Map([['src/lonely.ts', [1]], ['unknown.bin', []]]), DEFAULT_TEST_PATTERNS);
  assert.deepEqual(risky.untested, ['src/lonely.ts']);
  assert.equal(risky.files[1].inGraph, false);
  const findings = impactFindings(risky);
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /solo in src\/lonely\.ts changed and is used by 3 file\(s\), with no test/);
  assert.equal(findings[0].severity, 'major');
  const section = impactSection(risky);
  assert.match(section, /^## Impact\n2 file\(s\) changed/);
  assert.match(section, /Hot: solo \(3 dependents\)/);
  assert.match(section, /Changed exports without a covering test: src\/lonely\.ts/);
  const covered = computeImpact(g2, new Map([['src/lonely.ts', [1]], ['test/lonely.test.ts', [1]]]), DEFAULT_TEST_PATTERNS);
  assert.deepEqual(covered.untested, []);
  assert.equal(impactFindings(covered).length, 0);
});

test('changed lines come from unified diffs, PR patches, the working tree', () => {
  const diff = '--- a/x.ts\n+++ b/x.ts\n@@ -1,0 +2,2 @@\n+a\n+b\n--- a/y.ts\n+++ b/y.ts\n@@ -5 +7 @@\n+c\n';
  assert.deepEqual([...changedLinesFromDiff(diff)], [['x.ts', [2, 3]], ['y.ts', [7]]]);
  assert.deepEqual([...changedLinesFromPatches([{ filename: 'p.ts', patch: '@@ -1,2 +1,3 @@\n a\n+b\n c' }, { filename: 'bin.png' }])], [['p.ts', [2]], ['bin.png', []]]);

  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/core.ts', 'export function parse(s: string) {\n  return s;\n}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: core');
  const base = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/core.ts', 'export function parse(s: string) {\n  return s.trim();\n}\n');
  write(dir, 'src/new.ts', 'export const n = 1;\n');
  const changes = localChanges(dir, base);
  assert.deepEqual(changes.get('src/core.ts'), [2]);
  assert.deepEqual(changes.get('src/new.ts'), [1]);
});

test('ade graph why, ade graph impact from the CLI', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  write(dir, 'src/core.ts', '// Never call this twice per request, otherwise the ledger double counts.\nexport function post(s: string) { return s; }\n');
  write(dir, 'src/a.ts', "import { post } from './core.ts';\npost('a');\n");
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: base');
  let r = cli(dir, 'graph', 'why', 'ledger double counting');
  assert.equal(r.code, 0);
  assert.match(r.out, /src\/core\.ts:1 \[constraint\] Never call this twice per request/);
  r = cli(dir, 'graph', 'why', 'unrelated');
  assert.match(r.out, /no rationale, constraint or debt marker matches/);
  assert.equal(cli(dir, 'graph', 'why').code, 2);

  r = cli(dir, 'graph', 'impact');
  assert.match(r.out, /no changes in the working tree/);
  write(dir, 'src/core.ts', '// Never call this twice per request, otherwise the ledger double counts.\nexport function post(s: string) { return s + "!"; }\n');
  r = cli(dir, 'graph', 'impact');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /impact of 1 changed file\(s\), 1 dependent file\(s\)/);
  assert.match(r.out, /src\/core\.ts  \|  touched post  \|  imported by 1, 1 use the touched exports  \|  no test imports it/);
  assert.match(r.out, /changed exports without a covering test: src\/core\.ts/);
  r = cli(dir, 'graph', 'impact', 'src/a.ts');
  assert.match(r.out, /src\/a\.ts  \|  no symbols touched  \|  imported by 0/);
  const json = JSON.parse(cli(dir, 'graph', 'impact', '--json').out);
  assert.equal(json.files[0].touched[0], 'post');
});
