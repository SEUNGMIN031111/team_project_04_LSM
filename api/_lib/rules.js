// 1차 표현 목록 검사 — 시연용 소규모 목록 [시연 값 · 기획안의 약 1,200개 목록이 아님].
// 띄어쓰기 · 특수문자 · 자모 분리로 돌려 쓴 표현을 잡도록 글자를 먼저 다듬어서 비교한다.

export const RULES_INFO = { termCount: 0, note: '시연 값 · 약 1,200개 목록이 아니에요' };

// level: strong = 차단후보 근거, weak = 검토필요 근거
const TERMS = [
  // 욕설
  ['씨발', '욕설', 'strong'], ['시발', '욕설', 'strong'], ['ㅅㅂ', '욕설', 'strong'], ['ㅆㅂ', '욕설', 'strong'],
  ['병신', '욕설', 'strong'], ['ㅂㅅ', '욕설', 'strong'], ['개새끼', '욕설', 'strong'], ['지랄', '욕설', 'strong'],
  ['꺼지라', '욕설', 'strong'], ['닥쳐', '욕설', 'strong'], // '꺼져'는 「꺼져 있어」에 걸려 뺐다
  ['좆', '욕설', 'strong'], ['꺼져라', '욕설', 'strong'],
  // 모욕
  ['미친놈', '모욕', 'strong'], ['미친년', '모욕', 'strong'], ['머저리', '모욕', 'strong'], ['멍청이', '모욕', 'strong'],
  ['쓰레기', '모욕', 'strong'], ['버러지', '모욕', 'strong'], ['한심한놈', '모욕', 'strong'],
  // 협박
  ['가만안둔다', '협박', 'strong'], ['가만두지', '협박', 'strong'], ['죽여', '협박', 'strong'], ['죽인다', '협박', 'strong'],
  ['목날아', '협박', 'strong'], ['불질러', '협박', 'strong'], ['칼들고', '협박', 'strong'], ['흉기', '협박', 'strong'],
  ['해코지', '협박', 'strong'], ['각오해', '협박', 'weak'],
  // 성희롱
  ['예쁘게하고나와', '성희롱', 'strong'], ['몸매', '성희롱', 'strong'], ['섹시', '성희롱', 'strong'],
  ['사줄게', '성희롱', 'weak'], ['목소리들으니', '성희롱', 'weak'],
  // 비꼬기 · 조롱 (검토필요)
  ['신선놀음', '비꼬기', 'weak'], ['커피만', '비꼬기', 'weak'], ['초등학생도', '비꼬기', 'weak'], ['수준이네', '비꼬기', 'weak'],
  ['월급루팡', '비꼬기', 'weak'], ['세금도둑', '비꼬기', 'weak'], ['한심', '비꼬기', 'weak'], ['ㅋㅋ', '비꼬기', 'weak'],
];
RULES_INFO.termCount = TERMS.length;

function squash(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\s​\.\-_*~!@#$%^&()·ㆍ,:;'"`|\\/<>?+=\[\]{}]/g, '');
}
const NORMALIZED_TERMS = TERMS.map(([term, category, level]) => ({ term, category, level, key: squash(term) }));

const MASK_MARK = '○○';

export function analyzeSentence(sentence) {
  const key = squash(sentence);
  const hits = [];
  for (const t of NORMALIZED_TERMS) {
    if (key.includes(t.key)) hits.push({ term: t.term, category: t.category, level: t.level });
  }
  const marks = (String(sentence).match(/○○/g) || []).length;
  if (marks >= 2) hits.push({ term: MASK_MARK + ' ×' + marks, category: '가림 표현', level: 'strong' });
  else if (marks === 1) hits.push({ term: MASK_MARK, category: '가림 표현', level: 'weak' });
  return hits;
}

export function analyze(text) {
  const sentences = String(text).split(/(?<=[.!?。\n])\s*/).map((s) => s.trim()).filter(Boolean);
  const flagged = [];
  const hits = [];
  for (const s of sentences) {
    const h = analyzeSentence(s);
    if (h.length) { flagged.push({ sentence: s, hits: h }); hits.push(...h); }
  }
  // 가림 표현(○○)이 글 전체에 걸쳐 2번 이상이면 문장이 달라도 뚜렷한 표현으로 본다
  let stage = '정상';
  if (hits.some((h) => h.level === 'strong')) stage = '차단후보';
  else if (hits.length) stage = '검토필요';
  const markTotal = (String(text).match(/○○/g) || []).length;
  if (markTotal >= 2 && stage !== '차단후보' && !hits.some((h) => h.category !== '가림 표현')) stage = '차단후보';
  return { stage, hits, flagged };
}

/** 표현에 걸린 부분을 ○○ 로 바꾼 글 (AI 가 모두 실패했을 때의 시연 값) */
export function redact(text) {
  let out = String(text);
  for (const t of TERMS) {
    const raw = t[0];
    if (raw.length >= 2) out = out.split(raw).join('○○');
  }
  return out;
}
