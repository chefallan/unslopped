import type { QuizQuestion } from './types.ts';

const QUESTION = /^\s*(?:#{1,6}\s*)?(\d+)[.)]\s+(.+)$/;
const OPTION = /^\s*[-*]?\s*([a-z])[.)]\s+(.+)$/;
const KEY = /^\s*[-*]?\s*answer\s*[:=]\s*([a-z])\s*$/i;

export interface ParsedQuiz {
  questions: QuizQuestion[];
  problems: string[];
}

export interface QuizScore {
  total: number;
  correct: number;
  missed: number[];
}

export function parseQuiz(text: string): ParsedQuiz {
  const questions: QuizQuestion[] = [];
  let current: QuizQuestion | null = null;
  for (const line of text.split(/\r?\n/)) {
    const key = line.match(KEY);
    if (key && current) {
      current.answer = key[1].toLowerCase();
      continue;
    }
    const q = line.match(QUESTION);
    if (q) {
      current = { n: Number(q[1]), text: q[2].trim(), options: [], answer: '' };
      questions.push(current);
      continue;
    }
    const o = line.match(OPTION);
    if (o && current) current.options.push({ letter: o[1].toLowerCase(), text: o[2].trim() });
  }
  const problems: string[] = [];
  for (const q of questions) {
    if (q.options.length < 2) problems.push(`question ${q.n} has ${q.options.length} option(s). give at least two, so the answer cannot be guessed from the shape`);
    else if (!q.answer) problems.push(`question ${q.n} has no answer key. add a line reading "answer: <letter>" under its options`);
    else if (!q.options.some((o) => o.letter === q.answer)) problems.push(`question ${q.n} keys ${q.answer}, which is not one of its options`);
  }
  if (!questions.length) problems.push('no questions found. number each question, list its options as "- a) text", key it with "answer: <letter>"');
  return { questions, problems };
}

export function renderQuiz(questions: QuizQuestion[]): string {
  const out: string[] = [];
  for (const q of questions) {
    out.push(`${q.n}. ${q.text}`);
    for (const o of q.options) out.push(`   ${o.letter}) ${o.text}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

export function parseAnswers(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .split('');
}

export function gradeQuiz(questions: QuizQuestion[], answers: string[]): QuizScore {
  const missed: number[] = [];
  questions.forEach((q, i) => {
    if (answers[i] !== q.answer) missed.push(q.n);
  });
  return { total: questions.length, correct: questions.length - missed.length, missed };
}
