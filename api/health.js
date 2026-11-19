// 키 이름과 「값이 있는지」만 알려 준다. 값은 절대 내보내지 않는다.
import { keyStatus } from './_lib/ai.js';
import { loadChunks } from './_lib/rag.js';

export default function handler(req, res) {
  const { n } = loadChunks();
  res.status(200).json({ ok: true, ai: keyStatus(), chunks: n });
}
