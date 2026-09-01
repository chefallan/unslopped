import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanExploitable, EXPLOIT_CAP } from '../src/vulns.ts';
import { DEFAULT_TEST_PATTERNS } from '../src/practices.ts';
import { tmpDir, initRepo, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

const P = DEFAULT_TEST_PATTERNS;

function at(file: string, line: number, text: string) {
  return { file, line, text };
}

function hits(text: string): number {
  return scanExploitable([at('src/app.js', 1, text)], P).length;
}

test('flags eval, code built from strings', () => {
  assert.equal(hits('eval(payload)'), 1);
  assert.equal(hits('const f = new Function(body)'), 1);
  assert.equal(hits('const evaluation = score(x)'), 0);
});

test('flags shell commands built from variables', () => {
  assert.equal(hits('exec(cmd)'), 1);
  assert.equal(hits('subprocess.run(cmd, shell=True)'), 1);
  assert.equal(hits("exec('ls -la')"), 0);
});

test('flags SQL built from string pieces', () => {
  assert.equal(hits('db.query(`SELECT * FROM users WHERE id = ${id}`)'), 1);
  assert.equal(hits("db.query('SELECT * FROM users WHERE id = ' + id)"), 1);
  assert.equal(hits("db.query('SELECT * FROM users WHERE id = ?', [id])"), 0);
});

test('flags HTML sinks, unsafe deserialization', () => {
  assert.equal(hits('el.innerHTML = userBio'), 1);
  assert.equal(hits('return <div dangerouslySetInnerHTML={{ __html: bio }} />'), 1);
  assert.equal(hits('data = yaml.load(raw)'), 1);
  assert.equal(hits('data = yaml.load(raw, Loader=SafeLoader)'), 0);
  assert.equal(hits('obj = pickle.loads(blob)'), 1);
});

test('flags weak password hashing, guessable tokens, disabled certificate checks', () => {
  assert.equal(hits('const stored = md5(password)'), 1);
  assert.equal(hits('const resetToken = Math.random().toString(36)'), 1);
  assert.equal(hits('const agent = new https.Agent({ rejectUnauthorized: false })'), 1);
  assert.equal(hits('requests.get(url, verify=False)'), 1);
  assert.equal(hits('const checksum = sha1(fileBytes)'), 0);
});

test('flags request-built paths, redirects', () => {
  assert.equal(hits('fs.readFile(base + req.query.name, cb)'), 1);
  assert.equal(hits('res.redirect(req.query.next)'), 1);
  assert.equal(hits("res.redirect('/home')"), 0);
});

test('skips test files, lockfiles, markdown', () => {
  const lines = [at('test/app.test.js', 1, 'eval(payload)'), at('package-lock.json', 1, 'eval(payload)'), at('docs/a.md', 1, 'eval(payload)')];
  assert.equal(scanExploitable(lines, P).length, 0);
});

test('caps findings so a generated file cannot flood the review', () => {
  const lines = Array.from({ length: 30 }, (_, i) => at('src/gen.js', i + 1, 'eval(payload)'));
  assert.equal(scanExploitable(lines, P).length, EXPLOIT_CAP);
});

test('one finding per line even when several patterns match', () => {
  assert.equal(hits('eval(md5(password))'), 1);
});

test('finding text carries the file, the line, the exploit story', () => {
  const f = scanExploitable([at('src/db.js', 42, 'db.query(`SELECT ${col}`)')], P)[0];
  assert.equal(f.severity, 'major');
  assert.equal(f.file, 'src/db.js');
  assert.equal(f.line, 42);
  assert.match(f.text, /^src\/db\.js:42 SQL built from string pieces/);
});

test('local review records exploit findings in the artifact', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, exploitScan: true } });
  assert.equal(cli(dir, 'start', 'risky change').code, 0);
  fs.writeFileSync(path.join(dir, 'app.js'), 'eval(payload)\n');
  fs.writeFileSync(path.join(dir, 'r.md'), '- [minor] naming nit\n');
  const r = cli(dir, 'review', '--file=r.md');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 exploitable-looking line\(s\) added as findings/);
  assert.match(r.out, /1 major, 1 minor/);
  const id = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8')).cycle.id;
  const artifact = fs.readFileSync(path.join(dir, '.unslopped', 'reviews', `${id}.md`), 'utf8');
  assert.match(artifact, /- \[major\] app\.js:1 whatever reaches this runs as code/);
});

test('exploitScan off leaves the review untouched', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  assert.equal(cli(dir, 'start', 'quiet change').code, 0);
  fs.writeFileSync(path.join(dir, 'app.js'), 'eval(payload)\n');
  fs.writeFileSync(path.join(dir, 'r.md'), '- [minor] naming nit\n');
  const r = cli(dir, 'review', '--file=r.md');
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /exploitable-looking/);
});

test('an exploit finding round-trips into an inline Worth fixing comment', async () => {
  const { parseFindings } = await import('../src/practices.ts');
  const { reviewPayload } = await import('../src/github.ts');
  const f = scanExploitable([at('src/db.js', 42, 'db.query(`SELECT ${col}`)')], P)[0];
  const parsed = parseFindings(`- [major] ${f.text}`);
  assert.equal(parsed[0].file, 'src/db.js');
  assert.equal(parsed[0].line, 42);
  const p = reviewPayload(parsed, new Map([['src/db.js', new Set([42])]]));
  assert.equal(p.comments.length, 1);
  assert.match(p.comments[0].body, /^\*\*Worth fixing\*\*: src\/db\.js:42 SQL built from string pieces/);
});
