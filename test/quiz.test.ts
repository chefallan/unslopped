import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseQuiz, renderQuiz, parseAnswers, gradeQuiz } from '../src/quiz.ts';
import { mergePractices, practiceDefaults, quizCheck } from '../src/practices.ts';
import { newCycle } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { runGate } from '../src/gates.ts';
import { loadState } from '../src/state.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

const ARTIFACT = `# Quiz for the change

1. Why does resolveBase fall back to origin/main?
- a) the config demands it
- b) a detached head has no upstream to read
- c) it makes the diff smaller
answer: b

2. What breaks if the early return in quizCheck is removed?
- a) projects without the quiz key get a gate they never configured
- b) the diff count is wrong
- c) nothing
answer: a
`;

function repo(quiz: Record<string, unknown> | null = null) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, quiz } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('Add a quiz gate', 'h', git(dir, 'rev-parse', 'HEAD'));
  return { dir, cycle, ctx: () => ({ root: dir, config: loadConfig(dir)!, cycle }) };
}

function change(dir: string, lines: number) {
  fs.writeFileSync(path.join(dir, 'src.txt'), Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + '\n');
}

test('parseQuiz reads the questions, options, answer key', () => {
  const { questions, problems } = parseQuiz(ARTIFACT);
  assert.deepEqual(problems, []);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].n, 1);
  assert.equal(questions[0].text, 'Why does resolveBase fall back to origin/main?');
  assert.equal(questions[0].options.length, 3);
  assert.deepEqual(questions[0].options[1], { letter: 'b', text: 'a detached head has no upstream to read' });
  assert.equal(questions[0].answer, 'b');
  assert.equal(questions[1].answer, 'a');
});

test('parseQuiz reports a question with no answer key', () => {
  const { problems } = parseQuiz('1. Why?\n- a) one\n- b) two\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /question 1.*answer/i);
});

test('parseQuiz reports a question with fewer than two options', () => {
  const { problems } = parseQuiz('1. Why?\n- a) one\nanswer: a\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /question 1.*option/i);
});

test('parseQuiz reports an answer key that names no option', () => {
  const { problems } = parseQuiz('1. Why?\n- a) one\n- b) two\nanswer: d\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /question 1.*\bd\b/i);
});

test('renderQuiz prints the options without the answer key', () => {
  const { questions } = parseQuiz(ARTIFACT);
  const shown = renderQuiz(questions);
  assert.match(shown, /1\. Why does resolveBase/);
  assert.match(shown, /b\) a detached head has no upstream to read/);
  assert.equal(/answer:/i.test(shown), false);
});

test('parseAnswers accepts letters run together, separated, upper case', () => {
  assert.deepEqual(parseAnswers('ba'), ['b', 'a']);
  assert.deepEqual(parseAnswers('b,a'), ['b', 'a']);
  assert.deepEqual(parseAnswers('B, A'), ['b', 'a']);
  assert.deepEqual(parseAnswers('1b 2a'), ['b', 'a']);
});

test('gradeQuiz scores every answer right', () => {
  const { questions } = parseQuiz(ARTIFACT);
  assert.deepEqual(gradeQuiz(questions, ['b', 'a']), { total: 2, correct: 2, missed: [] });
});

test('gradeQuiz names the missed question numbers', () => {
  const { questions } = parseQuiz(ARTIFACT);
  assert.deepEqual(gradeQuiz(questions, ['c', 'a']), { total: 2, correct: 1, missed: [1] });
});

test('gradeQuiz counts a missing answer as wrong', () => {
  const { questions } = parseQuiz(ARTIFACT);
  assert.deepEqual(gradeQuiz(questions, ['b']), { total: 2, correct: 1, missed: [2] });
});

test('the quiz practice defaults to off, so an existing project gains no gate', () => {
  assert.equal(practiceDefaults().quiz!.enabled, false);
  assert.equal(mergePractices({}).quiz!.enabled, false);
});

test('quizCheck is absent when the practice is off', () => {
  const r = repo();
  assert.equal(quizCheck(r.ctx(), null), null);
});

test('quizCheck is absent when the key is present, disabled', () => {
  const r = repo({ enabled: false, minLines: 1, pass: 100, maxAttempts: 3 });
  assert.equal(quizCheck(r.ctx(), null), null);
});

test('quizCheck skips a diff under the line threshold', () => {
  const r = repo({ enabled: true, minLines: 50, pass: 100, maxAttempts: 3 });
  change(r.dir, 3);
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, true);
  assert.match(c.detail, /under the 50-line threshold/);
});

test('quizCheck asks for a quiz when none is recorded', () => {
  const r = repo({ enabled: true, minLines: 1, pass: 100, maxAttempts: 3 });
  change(r.dir, 10);
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /unslopped quiz --file=/);
});

test('quizCheck fails a wrong answer with the missed numbers, the attempts left', () => {
  const r = repo({ enabled: true, minLines: 1, pass: 100, maxAttempts: 3 });
  change(r.dir, 10);
  r.cycle.quiz = { at: new Date().toISOString(), total: 2, correct: 1, missed: [1], attempts: 1, passed: false, questions: parseQuiz(ARTIFACT).questions };
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /question 1/);
  assert.match(c.detail, /2 attempt\(s\) left/);
});

test('quizCheck fails when the attempts are used up', () => {
  const r = repo({ enabled: true, minLines: 1, pass: 100, maxAttempts: 3 });
  change(r.dir, 10);
  r.cycle.quiz = { at: new Date().toISOString(), total: 2, correct: 0, missed: [1, 2], attempts: 3, passed: false, questions: parseQuiz(ARTIFACT).questions };
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /no attempts left/);
});

test('quizCheck passes a quiz that met the pass mark', () => {
  const r = repo({ enabled: true, minLines: 1, pass: 100, maxAttempts: 3 });
  change(r.dir, 10);
  r.cycle.quiz = { at: new Date().toISOString(), total: 2, correct: 2, missed: [], attempts: 1, passed: true, questions: parseQuiz(ARTIFACT).questions };
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, true);
  assert.match(c.detail, /2\/2/);
});

test('quizCheck fails a passing quiz taken before the last commit', () => {
  const r = repo({ enabled: true, minLines: 1, pass: 100, maxAttempts: 3 });
  change(r.dir, 10);
  r.cycle.quiz = { at: new Date(Date.now() - 60000).toISOString(), total: 2, correct: 2, missed: [], attempts: 1, passed: true, questions: parseQuiz(ARTIFACT).questions };
  const c = quizCheck(r.ctx(), Date.now())!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /changed after/);
});

const RULES = { enabled: true, minLines: 1, pass: 100, maxAttempts: 3 };

function started(rules: Record<string, unknown> = RULES) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS, deploy: PASS }, { practices: { ...PRACTICES_OFF, quiz: rules } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  cli(dir, 'start', 'Add a quiz gate');
  change(dir, 10);
  return dir;
}

function record(dir: string) {
  const file = path.join(dir, 'quiz.md');
  fs.writeFileSync(file, ARTIFACT);
  return { file, result: cli(dir, 'quiz', `--file=${file}`) };
}

test('the quiz command records the questions without printing the answer key', () => {
  const dir = started();
  const { result } = record(dir);
  assert.equal(result.code, 0);
  assert.match(result.out, /2 question\(s\)/);
  assert.match(result.out, /b\) a detached head has no upstream to read/);
  assert.equal(/answer:/i.test(result.out), false);
});

test('the quiz command removes the artifact so the key stays out of the diff', () => {
  const dir = started();
  const { file } = record(dir);
  assert.equal(fs.existsSync(file), false);
});

test('the quiz command refuses an artifact with no answer key', () => {
  const dir = started();
  const file = path.join(dir, 'bad.md');
  fs.writeFileSync(file, ['1. Why?', '- a) one', '- b) two', ''].join('\n'));
  const r = cli(dir, 'quiz', `--file=${file}`);
  assert.equal(r.code, 2);
  assert.match(r.out, /no answer key/);
});

test('the quiz command grades right answers as a pass', () => {
  const dir = started();
  record(dir);
  const r = cli(dir, 'quiz', '--answer=ba');
  assert.equal(r.code, 0);
  assert.match(r.out, /2\/2 right \(100%\), passed/);
  assert.equal(loadState(dir).cycle!.quiz!.passed, true);
});

test('the quiz command names the missed question on a wrong answer', () => {
  const dir = started();
  record(dir);
  const r = cli(dir, 'quiz', '--answer=ca');
  assert.equal(r.code, 1);
  assert.match(r.out, /missed question 1/);
  assert.match(r.out, /2 attempt\(s\) left/);
  assert.equal(loadState(dir).cycle!.quiz!.attempts, 1);
});

test('the quiz command refuses to grade once the attempts run out', () => {
  const dir = started({ ...RULES, maxAttempts: 1 });
  record(dir);
  cli(dir, 'quiz', '--answer=ca');
  const r = cli(dir, 'quiz', '--answer=ba');
  assert.equal(r.code, 2);
  assert.match(r.out, /no attempts left/);
});

test('the deploy gate stays shut until the quiz passes', () => {
  const dir = started();
  record(dir);
  const state = loadState(dir);
  const cycle = state.cycle!;
  const config = loadConfig(dir)!;
  const shut = runGate('deploy', { root: dir, config, cycle });
  assert.equal(shut.pass, false);
  assert.deepEqual(shut.checks.map((c) => c.name), ['quiz']);
  cycle.quiz = { ...cycle.quiz!, correct: 2, missed: [], passed: true, attempts: 1 };
  const open = runGate('deploy', { root: dir, config, cycle });
  assert.equal(open.checks.find((c) => c.name === 'quiz')!.ok, true);
});
