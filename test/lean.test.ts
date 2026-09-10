import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanBloat, scanBloatFiles, BLOAT_CAP } from '../src/lean.ts';
import { trackedFiles } from '../src/git.ts';
import { practiceDefaults, DEFAULT_TEST_PATTERNS } from '../src/practices.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

function added(text: string, file = 'src/a.ts') {
  return [{ file, line: 7, text }];
}

function scan(text: string, file = 'src/a.ts') {
  return scanBloat(added(text, file), DEFAULT_TEST_PATTERNS);
}

test('flags a deep clone built from JSON, names structuredClone', () => {
  const f = scan('const copy = JSON.parse(JSON.stringify(input));');
  assert.equal(f.length, 1);
  assert.match(f[0].text, /structuredClone/);
  assert.equal(f[0].file, 'src/a.ts');
  assert.equal(f[0].line, 7);
});

test('flags a presence test built from filter, names some', () => {
  assert.match(scan('if (rows.filter((r) => r.ok).length > 0) return;')[0].text, /\bsome\b/);
  assert.match(scan('const none = rows.filter((r) => r.ok).length === 0;')[0].text, /\bsome\b/);
});

test('flags taking the first filter match, names find', () => {
  assert.match(scan('const first = rows.filter((r) => r.ok)[0];')[0].text, /\bfind\b/);
});

test('flags indexOf compared against minus one, names includes', () => {
  assert.match(scan('if (names.indexOf(name) !== -1) return;')[0].text, /\bincludes\b/);
  assert.match(scan('if (names.indexOf(name) === -1) return;')[0].text, /\bincludes\b/);
  assert.match(scan('if (names.indexOf(name) > -1) return;')[0].text, /\bincludes\b/);
});

test('flags Object.assign onto a fresh literal, names the spread', () => {
  assert.match(scan('const merged = Object.assign({}, base, extra);')[0].text, /spread/);
});

test('flags a catch that only rethrows', () => {
  assert.match(scan('} catch (e) { throw e; }')[0].text, /remove/i);
});

test('flags rebuilding values from keys, names Object.values', () => {
  assert.match(scan('const vals = Object.keys(map).map((k) => map[k]);')[0].text, /Object\.values/);
});

test('flags a comparison against a boolean literal', () => {
  assert.match(scan('if (ready === true) return;')[0].text, /\bif \(ready\)|the value itself/i);
});

test('leaves a forEach that appends to an accumulator alone', () => {
  assert.deepEqual(scan('rows.forEach((r) => out.push(r.id));'), []);
});

test('leaves a boolean comparison alone when the condition has more to it', () => {
  assert.deepEqual(scan('if (prNumber !== null || flags.pr === true) return 1;'), []);
});

test('does not run the filter patterns past the closing paren', () => {
  assert.deepEqual(scan("const area = [...keys].filter((f) => f.includes('/')).map((f) => f.split('/')[0]);"), []);
  assert.deepEqual(scan("for (const c of checks.filter((x) => !x.ok)) push(c.detail.split('\\n')[0]);"), []);
});

test('leaves plain code alone', () => {
  assert.deepEqual(scan('const copy = structuredClone(input);'), []);
  assert.deepEqual(scan('if (rows.some((r) => r.ok)) return;'), []);
  assert.deepEqual(scan('const merged = { ...base, ...extra };'), []);
  assert.deepEqual(scan('} catch (e) { log(e); throw new Error("wrapped"); }'), []);
});

test('skips test files, lockfiles, minified files, markdown', () => {
  assert.deepEqual(scan('const c = JSON.parse(JSON.stringify(x));', 'test/a.test.ts'), []);
  assert.deepEqual(scan('const c = JSON.parse(JSON.stringify(x));', 'package-lock.json'), []);
  assert.deepEqual(scan('const c = JSON.parse(JSON.stringify(x));', 'dist/app.min.js'), []);
  assert.deepEqual(scan('const c = JSON.parse(JSON.stringify(x));', 'README.md'), []);
});

test('caps findings so one generated file cannot flood a review', () => {
  const lines = Array.from({ length: BLOAT_CAP + 8 }, (_, i) => ({ file: 'src/a.ts', line: i + 1, text: 'const c = JSON.parse(JSON.stringify(x));' }));
  assert.equal(scanBloat(lines, DEFAULT_TEST_PATTERNS).length, BLOAT_CAP);
});

test('one finding per line even when several patterns match', () => {
  const f = scan('const c = Object.assign({}, JSON.parse(JSON.stringify(x)));');
  assert.equal(f.length, 1);
});

test('every bloat finding is minor, so it never shuts the release gate', () => {
  const f = scan('const c = JSON.parse(JSON.stringify(x));');
  assert.equal(f[0].severity, 'minor');
});

test('the bloat scan defaults on', () => {
  assert.equal(practiceDefaults().bloatScan, true);
});

function repo() {
  const dir = tmpDir();
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

test('trackedFiles lists what git tracks, with forward slashes', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'const a = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: add');
  assert.ok(trackedFiles(dir).includes('src/a.ts'));
});

test('scanBloatFiles reads tracked files across the repository', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'const c = JSON.parse(JSON.stringify(x));\n');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'const ok = rows.some((r) => r.ok);\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: add');
  const f = scanBloatFiles(dir, DEFAULT_TEST_PATTERNS);
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'src/a.ts');
  assert.match(f[0].text, /structuredClone/);
});

function reviewRepo(practices: Record<string, unknown> = {}) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, ...practices } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  cli(dir, 'start', 'do a thing');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'const c = JSON.parse(JSON.stringify(x));\n');
  git(dir, 'add', '.');
  return dir;
}

test('review folds the diff bloat findings into the artifact', () => {
  const dir = reviewRepo({ bloatScan: true });
  const file = path.join(dir, 'r.md');
  fs.writeFileSync(file, '- [minor] something a human noticed\n');
  const r = cli(dir, 'review', `--file=${file}`);
  assert.equal(r.code, 0);
  const artifact = fs.readFileSync(path.join(dir, '.unslopped', 'reviews', fs.readdirSync(path.join(dir, '.unslopped', 'reviews'))[0]), 'utf8');
  assert.match(artifact, /structuredClone/);
  assert.match(artifact, /something a human noticed/);
});

test('bloatScan off leaves the review artifact untouched', () => {
  const dir = reviewRepo({ bloatScan: false });
  const file = path.join(dir, 'r.md');
  fs.writeFileSync(file, '- [minor] something a human noticed\n');
  cli(dir, 'review', `--file=${file}`);
  const artifact = fs.readFileSync(path.join(dir, '.unslopped', 'reviews', fs.readdirSync(path.join(dir, '.unslopped', 'reviews'))[0]), 'utf8');
  assert.equal(/structuredClone/.test(artifact), false);
});

test('review --repo prints findings from tracked files, records no artifact', () => {
  const dir = reviewRepo({ bloatScan: true });
  git(dir, 'commit', '-q', '-m', 'chore: land it');
  const r = cli(dir, 'review', '--repo');
  assert.equal(r.code, 0);
  assert.match(r.out, /structuredClone/);
  assert.match(r.out, /src\/a\.ts/);
  assert.equal(fs.existsSync(path.join(dir, '.unslopped', 'reviews')), false);
});

test('review --repo says so plainly when it finds nothing', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, bloatScan: true } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const r = cli(dir, 'review', '--repo');
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing to flag/i);
});
