import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLines, scanDiffText, redactSecrets, configSecretProblem, entropy, scanStyle, styleDefaults, styleCheck, DEFAULT_FILLER_WORDS } from '../src/practices.ts';
import { parseUnifiedDiff } from '../src/git.ts';
import { runGate } from '../src/gates.ts';
import { newCycle } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { protocolBody } from '../src/protocol.ts';
import { ciWorkflow } from '../src/init.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PRACTICES_OFF } from './helpers.ts';

const line = (file: string, text: string, n = 1) => ({ file, line: n, text });

test('secret patterns cover the common providers, skip placeholders', () => {
  const hits = scanLines([
    line('a.js', `const k = "AKIA${'A'.repeat(16)}"`),
    line('a.js', 'const doc = "AKIAIOSFODNN7EXAMPLE"', 2),
    line('b.js', `token: "npm_${'a'.repeat(36)}"`),
    line('c.py', 'DB = "postgres://app:s3cr3tpass@db.internal:5432/app"'),
    line('c.py', 'DB = "postgres://app:password@localhost/app"', 2),
    line('d.ts', `headers.Authorization = "Bearer ${'a1B2'.repeat(10)}"`),
    line('d.ts', 'headers.Authorization = `Bearer ${token}`', 2),
    line('e.json', '"private_key_id": "0123456789abcdef0123456789abcdef01234567"'),
    line('f.go', 'url := "https://hooks.slack.com/services/T0000/B0000/Abc123Def456Ghi789Jkl012"'),
    line('g.rb', 'ENV_KEY = ENV.fetch("API_KEY")'),
    line('h.ts', 'const apiKey = process.env.API_KEY'),
    line('i.ts', 'const sessionToken = "9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6"'),
    line('j.ts', 'const authKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'),
  ]);
  const names = hits.map((h) => `${h.file}:${h.line} ${h.name}`);
  assert.deepEqual(names, [
    'a.js:1 AWS access key',
    'b.js:1 npm token',
    'c.py:1 connection string with password',
    'd.ts:1 bearer token',
    'e.json:1 GCP service account',
    'f.go:1 Slack webhook',
    'i.ts:1 high-entropy value assigned to a secret-looking name',
  ]);
  assert.ok(entropy('aaaaaaaa') < 1);
  assert.ok(entropy('9f8e7d6c5b4a39281706f5e4d3c2b1a0') > 3.5);
});

test('committed env files are flagged once, examples are fine, lockfiles are skipped', () => {
  const hits = scanLines([line('.env', 'A=1'), line('.env', 'B=2', 2), line('config/.env.production', 'X=y'), line('.env.example', `KEY=AKIA${'A'.repeat(16)}`), line('package-lock.json', `"AKIA${'B'.repeat(16)}"`)]);
  assert.deepEqual(hits, [
    { file: '.env', line: 1, name: 'environment file committed' },
    { file: 'config/.env.production', line: 1, name: 'environment file committed' },
  ]);
});

test('unified diffs are parsed with correct line numbers, scanned', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1,2 +1,4 @@', ' keep', '+const a = 1;', `+const key = "ghp_${'z'.repeat(36)}";`, ' end', '@@ -10,0 +13,1 @@', '+tail'].join('\n');
  const added = parseUnifiedDiff(diff);
  assert.deepEqual(added.map((l) => [l.file, l.line]), [['x.js', 2], ['x.js', 3], ['x.js', 13]]);
  const hits = scanDiffText(diff);
  assert.deepEqual(hits, [{ file: 'x.js', line: 3, name: 'GitHub token' }]);
});

test('redaction removes tokens from output while keeping the rest readable', () => {
  const text = `connecting with Bearer ${'q'.repeat(40)}\nusing postgres://svc:topsecretpw@db/app\nkey ghp_${'k'.repeat(36)} rejected\nplain line`;
  const r = redactSecrets(text);
  assert.equal(r.count, 3);
  assert.match(r.text, /Bearer \[redacted\]/);
  assert.match(r.text, /postgres:\/\/svc:\[redacted\]@db\/app/);
  assert.match(r.text, /key \[redacted GitHub token\] rejected/);
  assert.match(r.text, /plain line/);
  assert.doesNotMatch(r.text, /topsecretpw|qqqq|kkkk/);
  assert.equal(redactSecrets('nothing here').count, 0);
});

test('credentials in unslopped.config.json are refused', () => {
  assert.equal(configSecretProblem({ commands: { test: 'npm test' }, tracker: { provider: 'linear' } }), null);
  const bad = configSecretProblem({ commands: { deploy: `curl -H "Authorization: Bearer ${'t'.repeat(40)}" https://x` } });
  assert.match(bad!, /bearer token.*credentials belong in environment variables/);
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: 'npm test', deploy: `curl -H "Authorization: Bearer ${'t'.repeat(40)}" https://x` });
  const r = cli(dir, 'status');
  assert.equal(r.code, 2);
  assert.match(r.out, /contains what looks like a bearer token/);
});

test('failing gate output is redacted before it is shown or logged', () => {
  const dir = tmpDir();
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'leak.cjs'), `console.error("auth failed for Bearer ${'L'.repeat(40)}"); process.exit(1);`);
  writeConfig(dir, { test: 'node leak.cjs' });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: leak');
  const cycle = newCycle('g', 'h', git(dir, 'rev-parse', 'HEAD'));
  const r = runGate('test', { root: dir, config: loadConfig(dir)!, cycle });
  assert.equal(r.pass, false);
  assert.match(r.checks[0].detail, /Bearer \[redacted\]/);
  assert.match(r.checks[0].detail, /1 credential-looking value\(s\) redacted/);
  assert.doesNotMatch(r.checks[0].detail, /LLLL/);
});

test('style scan flags dashes, filler in comments, prose, comment-heavy files', () => {
  const rules = styleDefaults();
  const hits = scanStyle(
    [
      line('README.md', `Unslopped is a gatekeeper ${String.fromCharCode(0x2014)} it runs commands`),
      line('README.md', 'It is very fast and basically free', 2),
      line('src/a.ts', 'const just = "just a string, not a comment"'),
      line('src/a.ts', '// simply increment the counter', 2),
      line('src/a.ts', 'const range = "2020–2021";', 3),
      line('notes.txt', 'In order to run it, call run()'),
    ],
    rules
  );
  const problems = hits.map((h) => `${h.file}:${h.line} ${h.problem.split(' in ')[0]}`);
  assert.deepEqual(problems, ['README.md:1 em dash', 'README.md:2 filler word "very"', 'src/a.ts:2 filler word "simply"', 'src/a.ts:3 en dash', 'notes.txt:1 filler word "In order to"']);

  const commentHeavy = Array.from({ length: 12 }, (_, i) => line('src/b.ts', i < 5 ? `// note ${i}` : `const v${i} = ${i};`, i + 1));
  const ratio = scanStyle(commentHeavy, rules);
  assert.equal(ratio.length, 1);
  assert.match(ratio[0].problem, /42% of added lines are comments \(limit 25%\)/);
  assert.equal(scanStyle(commentHeavy, { ...rules, maxCommentRatio: 0.5 }).length, 0);
  assert.equal(scanStyle([line('a.md', 'a — b')], { ...rules, forbidden: [] }).length, 0);
});

test('style gate runs on the diff, can be disabled', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: 'x' }, { practices: { ...PRACTICES_OFF, style: styleDefaults() } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('g', 'h', git(dir, 'rev-parse', 'HEAD'));
  const ctx = () => ({ root: dir, config: loadConfig(dir)!, cycle });
  fs.writeFileSync(path.join(dir, 'doc.md'), 'Plain sentence.\n');
  assert.equal(styleCheck(ctx())!.ok, true);
  fs.writeFileSync(path.join(dir, 'doc.md'), 'Gates — they just work.\n');
  const fail = styleCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /doc\.md:1 em dash/);
  assert.match(fail.detail, /filler word "just"/);
  const off = tmpDir();
  initRepo(off);
  writeConfig(off, { test: 'x' });
  assert.equal(styleCheck({ root: off, config: loadConfig(off)!, cycle }), null);
  assert.equal(loadConfig(off)!.practices.style, null);
  writeConfig(off, { test: 'x' }, { practices: { ...PRACTICES_OFF, style: { maxCommentRatio: 0.5 } } });
  assert.deepEqual(loadConfig(off)!.practices.style!.forbidden, ['—', '–']);
  assert.equal(loadConfig(off)!.practices.style!.maxCommentRatio, 0.5);
});

test('Unslopped runs its own review workflow on its own pull requests', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = path.join(root, '.github', 'workflows', 'unslopped-review.yml');
  assert.equal(fs.existsSync(workflow), true);
  assert.equal(fs.readFileSync(workflow, 'utf8').replace(/\r\n/g, '\n'), ciWorkflow());
  assert.equal(fs.existsSync(path.join(root, '.github', 'pull_request_template.md')), true);
});

test('Unslopped itself passes its own style rules', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rules = styleDefaults();
  const files = ['README.md', 'LICENSE', ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`), ...fs.readdirSync(path.join(root, 'test')).map((f) => `test/${f}`)];
  const definesRules = new Set(['src/practices.ts', 'test/style-secrets.test.ts', 'test/init.test.ts', 'test/rigor.test.ts']);
  const lines: Array<{ file: string; line: number; text: string }> = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    text.split(/\r?\n/).forEach((t, i) => lines.push({ file: f, line: i + 1, text: t }));
  }
  const hits = scanStyle(lines, rules).filter((h) => !definesRules.has(h.file));
  assert.deepEqual(hits, []);
  const protocol = protocolBody().split(/\r?\n/).map((t, i) => ({ file: 'protocol.md', line: i + 1, text: t }));
  assert.deepEqual(scanStyle(protocol, rules), []);
  assert.ok(DEFAULT_FILLER_WORDS.includes('just'));
});
