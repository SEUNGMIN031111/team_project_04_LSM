// 공공 API 공통: 시간 초과 · 실패 이유(키 비어 있음 / 승인 안 됨 / 시간 초과) 분류.
// 공공 API 는 api(서버)에서만 부른다. 화면(public)은 이 서버만 부른다.

export class PublicApiError extends Error {
  constructor(reason, detail = '') {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

export function requireKey(envName) {
  const v = (process.env[envName] || '').trim();
  if (!v) throw new PublicApiError('키 비어 있음', envName + ' 값이 비어 있어요');
  return v;
}

export async function govFetch(url, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json, application/xml, text/xml, */*' } });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new PublicApiError('승인 안 됨', 'HTTP ' + res.status);
    if (/사용자\s*정보\s*검증|미신청|등록되지\s*않은|IP\s*주소|인증\s*키|SERVICE[_ ]KEY|NOT\s*REGISTERED|UNAUTHORIZED/i.test(text.slice(0, 600))) {
      let hint = '키 또는 서버 IP 승인이 필요해요';
      try { const j = JSON.parse(text); hint = String(j.msg || j.result || hint).slice(0, 160); } catch { /* JSON 아님 */ }
      throw new PublicApiError('승인 안 됨', hint);
    }
    if (!res.ok) throw new PublicApiError('오류', 'HTTP ' + res.status);
    return { text, contentType: res.headers.get('content-type') || '' };
  } catch (e) {
    if (e instanceof PublicApiError) throw e;
    if (e.name === 'AbortError') throw new PublicApiError('시간 초과', timeoutMs / 1000 + '초 안에 답이 없었어요');
    throw new PublicApiError('연결 오류', e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** 공공데이터포털 키: Encoding(%가 든 값) · Decoding(원문) 어느 쪽을 넣어도 한 번만 인코딩해 쓴다. */
export function normalizeServiceKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return '';
  let decoded = k;
  if (/%[0-9A-Fa-f]{2}/.test(k)) {
    try { decoded = decodeURIComponent(k); } catch { decoded = k; }
  }
  return encodeURIComponent(decoded);
}

export function parseMaybeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** 아주 단순한 XML → 행 목록 (처음 반복되는 요소를 행으로 본다) */
export function xmlRows(xml) {
  const body = xml.replace(/<\?xml[^>]*\?>/g, '');
  const counts = {};
  for (const m of body.matchAll(/<([A-Za-z_][\w-]*)>/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const candidates = Object.entries(counts).filter(([, n]) => n >= 1).map(([t]) => t);
  for (const tag of candidates) {
    const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g');
    const blocks = [...body.matchAll(re)].map((m) => m[1]);
    const rows = blocks
      .filter((b) => /<[A-Za-z_][\w-]*>/.test(b) && !/<[A-Za-z_][\w-]*>[^<]*<[A-Za-z_][\w-]*>/.test(b.replace(/<[A-Za-z_][\w-]*>[^<]*<\/[A-Za-z_][\w-]*>/g, '')) )
      .map((b) => {
        const row = {};
        for (const f of b.matchAll(/<([A-Za-z_][\w-]*)>(?:<!\[CDATA\[)?([^<\]]*)(?:\]\]>)?<\/\1>/g)) row[f[1]] = f[2].trim();
        return row;
      })
      .filter((r) => Object.keys(r).length >= 2);
    if (rows.length && blocks.length === rows.length) return rows;
  }
  return [];
}
