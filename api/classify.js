// 민원 글 3단계 분류: 가림 → 1차 표현 목록 → 2차 AI → 불일치면 검토필요.
// AI 는 단계를 「제안」할 뿐이다. 접수 거부 · 삭제 · 종료를 하지 않는다.
import { callAI, parseJson } from './_lib/ai.js';
import { maskPII } from './_lib/mask.js';
import { analyze, redact, RULES_INFO } from './_lib/rules.js';

const STAGES = ['정상', '검토필요', '차단후보'];

const SYSTEM = `너는 기초자치단체 온라인 민원 글을 읽고 표현 수위를 3단계로 "제안"하는 보조 도구야. 최종 결정은 담당 공무원이 해. 접수 거부나 삭제를 제안하지 마.

단계 기준(이름은 정상 / 검토필요 / 차단후보 셋뿐):
- 정상: 욕설·모욕·협박·성희롱 표현이 없다. 구정에 대한 강한 불만·비판·답답함도 정상이다.
- 검토필요: 비꼬기, 돌려 말한 비하처럼 애매하다.
- 차단후보: 욕설·모욕·협박·성희롱이 뚜렷하다.
글에 ○○ 가 있으면 욕설을 가린 표시야. 글에 *** 가 있으면 개인정보를 가린 표시야.

판단 예(가상):
- "도대체 몇 번을 건의해야 도로를 고쳐 줍니까? 정말 답답하고 화가 납니다." → 정상(강한 불만)
- "담당자가 일을 이렇게밖에 못 하나요? 업무 처리가 너무 미숙합니다." → 정상(업무 비판)
- "구청 직원분들은 하루 종일 커피만 마시며 신선놀음 하시나 봐요." → 검토필요(집단 비꼬기)
- "그렇게 일하면 목 날아갈 줄 알아. 정식으로 징계 청구할 테니 각오해." → 검토필요(징계 청구는 정당한 권리, 위협 표현 섞임)
- "내일까지 처리 안 되면 ○○ 들고 찾아가서 가만 안 둔다." → 차단후보(신체 위협)

반드시 아래 JSON 한 개만 출력해. 설명 문장은 쓰지 마. 한국어, 해요체.
{"stage":"정상|검토필요|차단후보","reason":"판단 이유 한 줄","normalEvidence":"정상 민원일 수 있는 근거 한 줄(요구나 불만의 핵심)","flagged":[{"sentence":"문제 문장 그대로","why":"이유 한 줄"}],"suggestion":"요구는 그대로 두고 공격적 표현만 바꾼 순화본","summary":"핵심 요약 1~2문장"}
정상이면 flagged 는 빈 배열, suggestion 은 원문 그대로 써.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST 로 보내 주세요' });
  const raw = String(req.body?.text ?? '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: '민원 글을 입력해 주세요' });
  if (raw.length > 2000) return res.status(400).json({ ok: false, error: '2,000자 이하로 입력해 주세요' });

  const masked = maskPII(raw); // AI 에 보내기 전
  const rules = analyze(masked.text); // 1차

  const ai = await callAI({ system: SYSTEM, user: '민원 글:\n' + masked.text, json: true });
  let parsed = null;
  if (ai.ok) {
    try { parsed = parseJson(ai.text); } catch { parsed = null; }
  }
  const aiStage = parsed && STAGES.includes(parsed.stage) ? parsed.stage : null;

  let stage;
  let agreed = null;
  if (aiStage) {
    agreed = aiStage === rules.stage;
    stage = agreed ? aiStage : '검토필요'; // 1·2차가 다르면 AI 가 고르지 않고 검토필요
  } else {
    stage = rules.stage;
  }

  const live = Boolean(aiStage);
  const firstSentence = masked.text.split(/(?<=[.!?\n])\s*/)[0] || masked.text;
  res.status(200).json({
    ok: true,
    stage,
    agreed,
    mode: live ? '실시간' : '시연 값',
    provider: live ? ai.provider : null,
    providerLabel: live ? ai.providerLabel : null,
    model: live ? ai.model : null,
    attempts: ai.attempts,
    masking: { count: masked.count, kinds: masked.kinds },
    rules: { stage: rules.stage, hits: rules.hits, flagged: rules.flagged, info: RULES_INFO },
    ai: live
      ? {
          stage: aiStage,
          reason: String(parsed.reason || ''),
          normalEvidence: String(parsed.normalEvidence || ''),
          flagged: Array.isArray(parsed.flagged) ? parsed.flagged.slice(0, 6) : [],
          suggestion: String(parsed.suggestion || ''),
          summary: String(parsed.summary || ''),
        }
      : {
          stage: null,
          reason: '표현 목록 결과만 보여 줘요(AI 답 없음)',
          normalEvidence: '',
          flagged: rules.flagged.map((f) => ({ sentence: f.sentence, why: f.hits.map((h) => h.category).join('·') })),
          suggestion: redact(masked.text),
          summary: firstSentence.length > 70 ? firstSentence.slice(0, 70) + '…' : firstSentence,
        },
    maskedText: masked.text,
  });
}
