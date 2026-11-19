// docs/답변참고문서/청킹 만 읽는다(원본 · 청킹전 · 답변제외는 읽지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/답변참고문서/청킹');

let cache = null;

function docNameOf(file) {
  return file.replace(/\.md$/, '').replace(/_\d{2}_.*$/, '');
}

function bigrams(s) {
  const out = new Set();
  for (const word of String(s).toLowerCase().match(/[가-힣a-z0-9]+/g) || []) {
    if (word.length === 1) { out.add(word); continue; }
    for (let i = 0; i < word.length - 1; i++) out.add(word.slice(i, i + 2));
  }
  return out;
}

export function loadChunks() {
  if (cache) return cache;
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')); } catch { files = []; }
  const chunks = files.map((file) => {
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    const lines = raw.split(/\r?\n/);
    const source = (lines.find((l) => l.startsWith('출처:')) || '').replace(/^출처:\s*/, '');
    const keywords = (lines.find((l) => l.startsWith('키워드:')) || '').replace(/^키워드:\s*/, '');
    const body = lines.filter((l) => !l.startsWith('출처:') && !l.startsWith('키워드:')).join('\n').trim();
    const doc = docNameOf(file);
    const section = (source.split('·').pop() || '').replace(/^[\s#]+/, '').trim() || file.replace(/\.md$/, '').replace(/^.*_\d{2}_/, '');
    const head = (doc + ' ' + section + ' ' + keywords).toLowerCase();
    return { file, doc, section, source, keywords, body, headGrams: bigrams(head), bodyGrams: bigrams(body) };
  });
  const df = new Map();
  for (const c of chunks) for (const g of new Set([...c.headGrams, ...c.bodyGrams])) df.set(g, (df.get(g) || 0) + 1);
  cache = { chunks, df, n: chunks.length };
  return cache;
}

export function search(question, limit = 5) {
  const { chunks, df, n } = loadChunks();
  if (!n) return { top: [], best: 0 };
  const q = bigrams(question);
  const scored = chunks.map((c) => {
    let score = 0;
    for (const g of q) {
      const d = df.get(g);
      if (!d) continue;
      const idf = Math.log(1 + n / d);
      if (c.headGrams.has(g)) score += idf * 2;
      else if (c.bodyGrams.has(g)) score += idf;
    }
    return { chunk: c, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  return { top, best: top[0]?.score || 0 };
}
