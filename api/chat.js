// 안내 챗봇 — docs/답변참고문서/청킹 에 있는 내용으로만 답한다.
// 문서에 없으면 모른다고 답하고 문의처를 안내한다. 답마다 근거 문서 이름을 붙인다.
// AI 는 안내까지만 — 개별 민원의 단계 · 처분을 단정하지 않는다.
import { callAI, parseJson } from './_lib/ai.js';
import { search } from './_lib/rag.js';

const MIN_SCORE = 10; // 이 점수보다 낮으면 근거 문서가 없다고 본다(무관한 질문 6.4 · 관련 질문 15 이상으로 확인)
const CONTACT = '성북구 감사담당관(「구청장에게 바란다」 정보 제공 부서)';

const SYSTEM = `너는 "성북 안심 민원 필터" 서비스의 안내 챗봇이야. 아래 규칙을 반드시 지켜.
1. 사용자 메시지에 붙은 [근거 문서] 안의 내용으로만 답해. 문서에 없는 내용은 추측하지 마.
2. 근거 문서만으로 답할 수 없으면 answer 에 "문서에서 확인하지 못했어요"라고 쓰고 used 는 빈 배열로 둬.
3. 개별 민원 글의 단계(정상·검토필요·차단후보)나 처분, 자격을 단정하지 마. AI 는 심사 보조까지만 해. 그런 질문에는 일반 기준만 설명하고 담당 공무원이 결정한다고 알려 줘.
4. 팀이 정한 값(소명 기한 7일 등)은 "시제품 기준"이라고 밝혀.
5. 쉬운 해요체로, 5문장 이내로 답해.
반드시 아래 JSON 한 개만 출력해.
{"answer":"답변","used":["근거로 쓴 문서 이름", "..."]}
used 에는 [근거 문서] 머리에 적힌 문서 이름만 그대로 써.`;

function unknownAnswer(extra = '') {
  return `문서에서 확인하지 못했어요. ${extra}${CONTACT}에 문의해 주세요.`.replace('  ', ' ');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST 로 보내 주세요' });
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ ok: false, error: '질문을 입력해 주세요' });
  if (question.length > 500) return res.status(400).json({ ok: false, error: '500자 이하로 입력해 주세요' });

  const { top, best } = search(question, 5);
  if (!top.length || best < MIN_SCORE) {
    return res.status(200).json({
      ok: true, known: false, mode: '실시간', provider: null,
      answer: unknownAnswer(), sources: [],
      note: '참고 문서에서 관련 내용을 찾지 못해 AI 를 부르지 않았어요',
    });
  }

  const docs = top.filter((t) => t.score >= best * 0.35);
  const context = docs
    .map((t, i) => `[근거 문서 ${i + 1}] 문서 이름: ${t.chunk.doc}\n부분: ${t.chunk.section}\n${t.chunk.body.slice(0, 1400)}`)
    .join('\n\n');
  const names = [...new Set(docs.map((t) => t.chunk.doc))];

  const ai = await callAI({
    system: SYSTEM,
    user: `${context}\n\n질문: ${question}\n\n(문서 이름 후보: ${names.join(' / ')})`,
    json: true,
  });

  if (ai.ok) {
    let parsed = null;
    try { parsed = parseJson(ai.text); } catch { parsed = null; }
    if (parsed && typeof parsed.answer === 'string') {
      const used = (Array.isArray(parsed.used) ? parsed.used : []).filter((u) => names.includes(u));
      const known = used.length > 0;
      return res.status(200).json({
        ok: true,
        known,
        mode: '실시간',
        provider: ai.provider, providerLabel: ai.providerLabel, model: ai.model, attempts: ai.attempts,
        answer: known ? parsed.answer : unknownAnswer(),
        sources: known
          ? used.map((u) => ({ doc: u, parts: [...new Set(docs.filter((t) => t.chunk.doc === u).map((t) => t.chunk.section))] }))
          : [],
      });
    }
  }

  // 모든 AI 가 실패 — 찾은 조각을 그대로 보여 준다(시연 값, AI 가 만든 글이 아님)
  res.status(200).json({
    ok: true, known: true, mode: '시연 값', provider: null, attempts: ai.attempts,
    answer: 'AI 가 답하지 못해 관련 문서 내용을 그대로 보여 줘요.\n\n' + docs.slice(0, 2).map((t) => `• ${t.chunk.doc} › ${t.chunk.section}\n${t.chunk.body.slice(0, 300)}`).join('\n\n'),
    sources: names.slice(0, 3).map((u) => ({ doc: u, parts: [...new Set(docs.filter((t) => t.chunk.doc === u).map((t) => t.chunk.section))] })),
  });
}
