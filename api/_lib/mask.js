// AI 에 보내기 전에 개인정보를 ***로 가린다 [팀 설계안: 정규식 방식].
const RULES = [
  ['주민등록번호', /\b\d{6}[-\s]?[1-4]\d{6}\b/g],
  ['전화번호', /\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g],
  ['이메일', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ['계좌·카드번호', /\b\d{2,6}(?:-\d{2,8}){2,4}\b/g],
  ['주소', /[가-힣0-9]+(?:로|길)\s?\d{1,4}(?:-\d{1,4})?(?:\s?\d{0,4}호)?/g],
  ['주소', /[가-힣]+동\s?\d{1,4}(?:-\d{1,4})?번지/g],
  ['이름', /((?:제\s?이름은|성명\s?[:：]?|저는)\s*)[가-힣]{2,4}(?=\s|입니다|이고|이며|[.,]|$)/g],
];

export function maskPII(text) {
  let out = String(text ?? '');
  const kinds = new Set();
  let count = 0;
  for (const [kind, re] of RULES) {
    out = out.replace(re, (...m) => {
      kinds.add(kind);
      count += 1;
      return kind === '이름' ? m[1] + '***' : '***';
    });
  }
  return { text: out, count, kinds: [...kinds] };
}
