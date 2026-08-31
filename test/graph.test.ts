import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extract, refreshGraph, loadGraph, queryGraph, report, graphContext, summarize, graphDefaults, formatHits, findFile, nodeView, formatNode, shortestPath, formatPath, crossAreaEdges, fullReport, htmlPage } from '../src/graph.ts';
import { promptContext, sessionContext } from '../src/hooks.ts';
import { init } from '../src/init.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, NO_TRACKER_ENV } from './helpers.ts';

function write(dir: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

test('extract reads symbols, imports for the main languages', () => {
  const ts = extract('ts', "import fs from 'node:fs';\nimport { a, b } from './util.js';\nimport type { T } from './types.ts';\nexport function run(x: number) {}\nfunction hidden() {}\nexport class Runner {}\nexport const LIMIT = 3;\nconst local = 1;\nexport interface Shape {}\ntype Alias = string;\nexport { hidden };\n");
  assert.deepEqual(ts.specifiers, ['node:fs', './util.js', './types.ts']);
  assert.deepEqual(ts.symbols.map((s) => [s.name, s.kind, s.exported, s.line]), [['run', 'function', true, 4], ['hidden', 'function', true, 5], ['Runner', 'class', true, 6], ['LIMIT', 'const', true, 7], ['local', 'const', false, 8], ['Shape', 'interface', true, 9], ['Alias', 'type', false, 10]]);

  const py = extract('py', 'from .models import User\nimport os\n\ndef handle(req):\n    def inner():\n        pass\n\nclass Service:\n    def run(self):\n        pass\n\n_private = 1\nMAX_RETRIES = 3\n');
  assert.deepEqual(py.specifiers, ['.models', 'os']);
  assert.deepEqual(py.symbols.map((s) => s.name), ['handle', 'Service', 'MAX_RETRIES']);

  const go = extract('go', 'package api\n\nimport (\n\t"fmt"\n\t"example.com/app/store"\n)\n\ntype Server struct{}\n\nfunc (s *Server) Start() error { return nil }\n\nfunc helper() {}\n');
  assert.deepEqual(go.specifiers, ['fmt', 'example.com/app/store']);
  assert.deepEqual(go.symbols.map((s) => [s.name, s.exported]), [['Server', true], ['Start', true], ['helper', false]]);

  const rs = extract('rs', 'use crate::store::Store;\nmod config;\npub fn main() {}\nfn private() {}\npub struct App;\n');
  assert.deepEqual(rs.specifiers, ['crate::store::Store', 'mod:config']);
  assert.deepEqual(rs.symbols.map((s) => [s.name, s.kind, s.exported]), [['main', 'fn', true], ['private', 'fn', false], ['App', 'struct', true]]);

  const md = extract('md', '# Title\n\nsome text\n\n## Install\n\n### Details\n\n#### too deep\n');
  assert.deepEqual(md.headings, ['Title', 'Install', 'Details']);
});

test('refreshGraph resolves imports, records uses, updates incrementally', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/util.ts', 'export function add(a: number, b: number) { return a + b; }\nexport const NAME = "x";\nexport function unused() {}\n');
  write(dir, 'src/main.ts', "import { add, NAME } from './util.js';\nimport express from 'express';\nexport function run() { return add(1, 2) + NAME; }\n");
  write(dir, 'src/index.ts', "import { run } from './main.ts';\nrun();\n");
  write(dir, 'docs/GUIDE.md', '# Guide\n\n## Running\n');
  write(dir, 'node_modules/express/index.js', 'module.exports = 1;\n');
  const first = refreshGraph(dir, graphDefaults());
  assert.equal(first.changed, 5);
  const g = first.graph;
  assert.ok(!Object.keys(g.files).some((f) => f.startsWith('node_modules')));
  assert.deepEqual(g.files['src/main.ts'].imports, ['src/util.ts']);
  assert.deepEqual(g.files['src/main.ts'].external, ['express']);
  assert.deepEqual(g.files['src/main.ts'].uses, { 'src/util.ts': ['add', 'NAME'] });
  assert.deepEqual(g.files['src/index.ts'].imports, ['src/main.ts']);
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'graph.json')));

  const second = refreshGraph(dir, graphDefaults());
  assert.equal(second.changed, 0);
  assert.equal(second.removed, 0);

  fs.unlinkSync(path.join(dir, 'docs/GUIDE.md'));
  const later = new Date(Date.now() + 5000);
  write(dir, 'src/util.ts', 'export function add(a: number, b: number) { return a + b; }\nexport const NAME = "x";\nexport function extra() {}\n');
  fs.utimesSync(path.join(dir, 'src/util.ts'), later, later);
  const third = refreshGraph(dir, graphDefaults());
  assert.equal(third.changed, 1);
  assert.equal(third.removed, 1);
  assert.ok(!third.graph.files['docs/GUIDE.md']);
  assert.deepEqual(third.graph.files['src/util.ts'].symbols.map((s) => s.name), ['add', 'NAME', 'extra']);
  assert.deepEqual(loadGraph(dir)!.files['src/main.ts'].uses, { 'src/util.ts': ['add', 'NAME'] });
});

test('query, report, prompt context surface the right files with little text', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/auth/login.ts', "import { hash } from '../crypto.ts';\nexport async function loginUser(email: string) { return hash(email); }\nexport class LoginError extends Error {}\n");
  write(dir, 'src/crypto.ts', 'export function hash(s: string) { return s; }\n');
  write(dir, 'src/billing/invoice.ts', "import { hash } from '../crypto.ts';\nexport function createInvoice() { return hash('x'); }\n");
  write(dir, 'src/app.ts', "import { loginUser } from './auth/login.ts';\nimport { createInvoice } from './billing/invoice.ts';\nloginUser('a'); createInvoice();\n");
  const graph = refreshGraph(dir, graphDefaults()).graph;

  const hits = queryGraph(graph, 'fix the login flow for users', 3);
  assert.equal(hits[0].file, 'src/auth/login.ts');
  assert.ok(hits[0].symbols[0].startsWith('loginUser():'));
  assert.deepEqual(hits[0].imports, ['src/crypto.ts']);
  assert.deepEqual(hits[0].importedBy, ['src/app.ts']);
  assert.equal(queryGraph(graph, 'zzz qqq').length, 0);
  assert.match(formatHits(hits).join('\n'), /src\/auth\/login\.ts  \(ts, 3 lines\)\n  symbols    loginUser\(\):2/);

  const s = summarize(graph);
  assert.equal(s.files, 5);
  assert.equal(s.godFiles[0].file, 'src/crypto.ts');
  assert.equal(s.godFiles[0].importers, 2);
  assert.deepEqual(s.entryPoints, ['src/app.ts']);
  const text = report(graph);
  assert.match(text, /# Code map: 5 files/);
  assert.match(text, /- src\/crypto\.ts: imported by 2, exports hash/);
  assert.match(text, /## Entry points\n- src\/app\.ts/);
  assert.match(text, /Query: ade graph/);

  const ctx = graphContext(graph, 'invoice totals are wrong');
  assert.equal(ctx.length, 3);
  assert.match(ctx[1], /src\/billing\/invoice\.ts: createInvoice\(\):2 \(imported by 1\)/);
  assert.match(graphContext(graph, 'zzz')[0], /5 files indexed\. Before reading/);
});

test('node, path, cross-area report, html views', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/auth/login.ts', "import { hash } from '../crypto.ts';\nexport async function loginUser(email: string) { return hash(email); }\nfunction helper() {}\n");
  write(dir, 'src/crypto.ts', "import { log } from '../lib/log.ts';\nexport function hash(s: string) { log(s); return s; }\n");
  write(dir, 'lib/log.ts', 'export function log(s: string) { return s; }\nexport function unusedExport() {}\n');
  write(dir, 'src/app.ts', "import { loginUser } from './auth/login.ts';\nloginUser('a');\n");
  write(dir, 'scripts/report.ts', "import { log } from '../lib/log.ts';\nlog('x');\n");
  const graph = refreshGraph(dir, graphDefaults()).graph;

  assert.deepEqual(findFile(graph, 'src/crypto.ts'), ['src/crypto.ts']);
  assert.deepEqual(findFile(graph, 'crypto'), ['src/crypto.ts']);
  assert.deepEqual(findFile(graph, 'log.ts'), ['lib/log.ts']);
  assert.deepEqual(findFile(graph, 'auth/login.ts'), ['src/auth/login.ts']);
  assert.deepEqual(findFile(graph, 'nothing'), []);

  const v = nodeView(graph, 'src/crypto.ts')!;
  assert.deepEqual(v.imports, [{ file: 'lib/log.ts', uses: ['log'] }]);
  assert.deepEqual(v.importedBy, [{ file: 'src/auth/login.ts', uses: ['hash'] }]);
  const text = formatNode(v).join('\n');
  assert.match(text, /src\/crypto\.ts  \(ts, 2 lines, 1 symbols\)/);
  assert.match(text, /exports     hash:2/);
  assert.match(text, /lib\/log\.ts  uses log/);
  assert.match(text, /imported by \n    src\/auth\/login\.ts  uses hash/);
  assert.equal(nodeView(graph, 'missing.ts'), null);

  const p = shortestPath(graph, 'src/app.ts', 'lib/log.ts')!;
  assert.equal(p.directed, true);
  assert.deepEqual(p.files, ['src/app.ts', 'src/auth/login.ts', 'src/crypto.ts', 'lib/log.ts']);
  const chain = formatPath(graph, p).join('\n');
  assert.match(chain, /import chain, 3 hop\(s\)/);
  assert.match(chain, /imports src\/crypto\.ts  \(hash\)/);
  const back = shortestPath(graph, 'lib/log.ts', 'scripts/report.ts')!;
  assert.equal(back.directed, false);
  assert.deepEqual(back.files, ['lib/log.ts', 'scripts/report.ts']);
  assert.match(formatPath(graph, back)[2], /imported by scripts\/report\.ts  \(log\)/);
  write(dir, 'lonely.ts', 'export const x = 1;\n');
  const g2 = refreshGraph(dir, graphDefaults()).graph;
  assert.equal(shortestPath(g2, 'lonely.ts', 'lib/log.ts'), null);
  assert.equal(shortestPath(g2, 'nope.ts', 'lib/log.ts'), null);

  const cross = crossAreaEdges(graph);
  assert.deepEqual(cross.pairs.map((c) => [c.from, c.to, c.count]), [['scripts', 'lib', 1], ['src', 'lib', 1]]);
  assert.equal(cross.surprising.length, 2);
  const full = fullReport(graph);
  assert.match(full, /## Cross-area imports\n- scripts -> lib: 1 import\(s\)\n- src -> lib: 1 import\(s\)/);
  assert.match(full, /## Surprising connections[^\n]*\n- scripts\/report\.ts -> lib\/log\.ts uses log\n- src\/crypto\.ts -> lib\/log\.ts uses log/);
  assert.match(full, /## Suggested queries\n- ade graph node/);
  assert.match(full, /ade graph path src\/app\.ts /);
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'GRAPH.md')));
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'graph.html')));

  const html = htmlPage(graph);
  assert.match(html, /<title>ADE code map<\/title>/);
  assert.match(html, /"id":"src\/crypto\.ts"/);
  assert.match(html, /"edges":\[\["src\/auth\/login\.ts","src\/crypto\.ts"\]/);
  assert.doesNotMatch(html.slice(html.indexOf('const DATA')), /<\/script>[\s\S]*<\/script>/);
  const small = htmlPage(graph, 2);
  assert.equal((small.match(/"id":/g) ?? []).length, 2);
});

test('hooks refresh the map, inject code context; init installs git hooks; ade graph works from the CLI', () => {
  const dir = tmpDir();
  initRepo(dir);
  write(dir, 'src/payments.ts', 'export function chargeCard(amount: number) { return amount; }\n');
  writeConfig(dir, { test: PASS });
  const prompt = promptContext(dir, 'charge the card twice on retry');
  assert.match(prompt, /Code map for this request/);
  assert.match(prompt, /src\/payments\.ts: chargeCard\(\):1/);
  const session = sessionContext(dir);
  assert.match(session, /## Code map \(\d+ files, \d+ symbols\)/);
  assert.match(session, /Areas: src \(1\)/);
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'graph.json')));

  const r = init(dir, { env: NO_TRACKER_ENV, only: ['agents'] });
  assert.deepEqual(r.gitHooks, ['.git/hooks/post-commit', '.git/hooks/post-checkout', '.git/hooks/post-merge']);
  const hook = fs.readFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh\n# ade: refresh the code map\ncommand -v ade/);
  assert.deepEqual(init(dir, { env: NO_TRACKER_ENV, only: ['agents'] }).gitHooks, []);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.ade\/graph\.json/);

  let c = cli(dir, 'graph', 'charge', 'card');
  assert.equal(c.code, 0);
  assert.match(c.out, /src\/payments\.ts/);
  c = cli(dir, 'graph');
  assert.match(c.out, /# Code map/);
  c = cli(dir, 'graph', 'refresh');
  assert.match(c.out, /code map: \d+ files scanned/);
  assert.equal(cli(dir, 'graph', 'refresh', '--quiet').out, '');
  c = cli(dir, 'graph', 'nothing-like-this-anywhere');
  assert.match(c.out, /nothing in the code map matches/);
  c = cli(dir, 'graph', 'node', 'payments');
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /src\/payments\.ts  \(ts, 1 lines, 1 symbols\)\n  exports     chargeCard:1/);
  c = cli(dir, 'graph', 'node', 'missing');
  assert.equal(c.code, 2);
  assert.match(c.out, /no file in the code map matches "missing"/);
  c = cli(dir, 'graph', 'path', 'payments', 'README.md');
  assert.equal(c.code, 1);
  assert.match(c.out, /not connected by imports/);
  c = cli(dir, 'graph', 'report');
  assert.match(c.out, /wrote \.ade\/GRAPH\.md/);
  assert.match(fs.readFileSync(path.join(dir, '.ade', 'GRAPH.md'), 'utf8'), /## Suggested queries/);
  c = cli(dir, 'graph', 'html');
  assert.match(c.out, /wrote \.ade\/graph\.html\. open it in a browser/);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.ade\/graph\.html\n\.ade\/GRAPH\.md/);

  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const s = cli(dir, 'start', 'refund a charged card');
  assert.equal(s.code, 0, s.out);
  const id = s.out.match(/started cycle (\S+)/)![1];
  const plan = fs.readFileSync(path.join(dir, '.ade', 'plans', `${id}.md`), 'utf8');
  assert.match(plan, /## Relevant code\n- src\/payments\.ts: chargeCard\(\):1/);
});
