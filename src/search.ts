const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with you your we our i me my do does did not no yes so if then than into onto over under out up down when where which who whom what why how all any some can could should would may might must shall about after before again also just only very'.split(' '));

export function tokenize(text: string | null | undefined): string[] {
  const words = String(text ?? '').toLowerCase().match(/[a-z0-9][a-z0-9._/-]*[a-z0-9]|[a-z0-9]/g) ?? [];
  return words.filter((w) => w.length > 1 && !STOP.has(w));
}

export interface Doc {
  text: string;
}

export type Ranked<T extends Doc> = T & { score: number; matched: number; coverage: number };

export function rank<T extends Doc>(query: string, docs: T[], limit = 5): Ranked<T>[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avg = toks.reduce((a, t) => a + t.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  return docs
    .map((d, i) => {
      const tf = new Map<string, number>();
      for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      let matched = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        matched++;
        const n = df.get(w) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * toks[i].length) / avg));
      }
      return { ...d, score, matched, coverage: matched / q.length };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

export function snippet(text: string, query: string, width = 160): string {
  const q = new Set(tokenize(query));
  const lines = String(text ?? '').split(/\r?\n/);
  const hit = lines.find((l) => tokenize(l).some((w) => q.has(w))) ?? lines.find((l) => l.trim()) ?? '';
  return hit.trim().slice(0, width);
}
