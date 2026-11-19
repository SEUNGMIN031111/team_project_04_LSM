// AI 호출: CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 어느 AI 가 답했는지 돌려준다.
// 모델 이름은 키로 모델 목록을 조회해 정한다(404 → 모델 이름부터 의심하고 목록을 다시 받는다).

const PROVIDERS = [
  { id: 'claude', label: 'Claude', env: 'CLAUDE_API_KEY' },
  { id: 'groq', label: 'Groq', env: 'GROQ_API_KEY' },
  { id: 'gemini', label: 'Gemini', env: 'GEMINI_API_KEY' },
];

const CALL_TIMEOUT_MS = 10000; // 한 곳당 10초 [팀 협의 제안값]
const LIST_TIMEOUT_MS = 6000;
const modelCache = {};

class AiError extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.reason = reason;
    Object.assign(this, extra);
  }
}

async function fetchJson(url, options, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* 본문이 JSON 이 아님 */ }
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    if (e.name === 'AbortError') throw new AiError('시간 초과');
    throw new AiError('연결 오류');
  } finally {
    clearTimeout(timer);
  }
}

function statusToReason(status) {
  if (status === 404) return '모델 이름 오류(404)';
  if (status === 401 || status === 403) return '키 승인 안 됨(' + status + ')';
  if (status === 429) return '사용 한도 초과(429)';
  return '오류(' + status + ')';
}

// ---- 모델 목록 조회 ----
async function listModels(id, key) {
  if (id === 'claude') {
    const r = await fetchJson('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }, LIST_TIMEOUT_MS);
    if (!r.ok) throw new AiError(statusToReason(r.status));
    return (r.json?.data || []).map((m) => m.id);
  }
  if (id === 'groq') {
    const r = await fetchJson('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: 'Bearer ' + key },
    }, LIST_TIMEOUT_MS);
    if (!r.ok) throw new AiError(statusToReason(r.status));
    return (r.json?.data || []).map((m) => m.id);
  }
  const r = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key), {}, LIST_TIMEOUT_MS);
  if (!r.ok) throw new AiError(statusToReason(r.status));
  return (r.json?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
}

// 후보 모델을 좋은 순서로 늘어놓는다. 목록에 있어도 이 키로는 못 쓰는 모델이 있어서(404 · 503) 여러 개를 둔다.
function rankModels(id, ids) {
  if (id === 'claude') {
    return [...ids.filter((m) => /sonnet/.test(m)), ...ids.filter((m) => /haiku/.test(m)), ...ids.filter((m) => !/sonnet|haiku/.test(m))];
  }
  if (id === 'groq') {
    const ok = ids.filter((m) => !/whisper|guard|tts|playai|orpheus|distil|embed/.test(m));
    const first = [
      ok.find((m) => m === 'llama-3.3-70b-versatile'),
      ok.find((m) => /llama.*70b/.test(m)),
      ok.find((m) => /gpt-oss-120b/.test(m)),
    ].filter(Boolean);
    return [...new Set([...first, ...ok])];
  }
  const g = ids.filter((m) => /^gemini-/.test(m) && /flash/.test(m) && !/image|tts|embedding|vision|thinking|live|audio|robotics|computer|native|omni|customtools|latest|exp/.test(m));
  const byNewest = (a, b) => b.localeCompare(a, 'en', { numeric: true });
  // 2026-11-19 실측: 가장 새 안정 버전(3.5~3.8 flash)은 몰려서 503 · 무응답, preview 와 lite 는 2초 안에 답했다.
  // 그래서 빠르게 답한 종류를 먼저 두고, 막히면(404 · 429 · 503) 다음 후보로 넘어간다.
  const stable = g.filter((m) => !/preview|lite/.test(m)).sort(byNewest);
  const lite = g.filter((m) => /lite/.test(m) && !/preview/.test(m)).sort(byNewest);
  const preview = g.filter((m) => /preview/.test(m) && !/lite/.test(m)).sort(byNewest);
  const litePreview = g.filter((m) => /preview/.test(m) && /lite/.test(m)).sort(byNewest);
  return [...new Set([...preview, ...lite, ...litePreview, ...stable])];
}

async function getModels(provider, key, force = false) {
  if (!force && modelCache[provider.id]) return modelCache[provider.id];
  const ids = await listModels(provider.id, key);
  const list = rankModels(provider.id, ids);
  if (!list.length) throw new AiError('쓸 수 있는 모델 없음');
  modelCache[provider.id] = list;
  return list;
}

// ---- 호출 ----
async function callOnce(provider, key, model, { system, user, json }) {
  if (provider.id === 'claude') {
    const r = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      // 최신 Claude 모델은 temperature 를 받지 않는다(400) — 보내지 않는다
      body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
    }, CALL_TIMEOUT_MS);
    if (!r.ok) throw new AiError(statusToReason(r.status), { status: r.status });
    const text = (r.json?.content || []).map((c) => c.text || '').join('');
    if (!text) throw new AiError('빈 답');
    return text;
  }
  if (provider.id === 'groq') {
    const body = {
      model, temperature: 0.2, max_tokens: 1500,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, CALL_TIMEOUT_MS);
    if (!r.ok) throw new AiError(statusToReason(r.status), { status: r.status });
    const text = r.json?.choices?.[0]?.message?.content;
    if (!text) throw new AiError('빈 답');
    return text;
  }
  const generationConfig = { temperature: 0.2, maxOutputTokens: 2500 };
  if (json) generationConfig.responseMimeType = 'application/json';
  const r = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    }),
  }, CALL_TIMEOUT_MS);
  if (!r.ok) throw new AiError(statusToReason(r.status), { status: r.status });
  const text = (r.json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new AiError('빈 답');
  return text;
}

async function tryProvider(provider, opts) {
  const key = (process.env[provider.env] || '').trim();
  if (!key) throw new AiError('키 비어 있음');
  const list = await getModels(provider, key);
  let lastError = null;
  // 404(모델 이름 · 사용 불가) · 429(한도) · 503(몰림)이면 다음 후보 모델로. 시간 초과는 바로 다음 AI 로 넘어간다.
  for (const model of list.slice(0, 3)) {
    try {
      const text = await callOnce(provider, key, model, opts);
      modelCache[provider.id] = [model, ...list.filter((m) => m !== model)]; // 통한 모델을 앞으로
      return { text, model };
    } catch (e) {
      lastError = e;
      if (![404, 429, 503].includes(e.status)) throw e;
    }
  }
  throw lastError;
}

export function parseJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new AiError('JSON 형식 아님');
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new AiError('JSON 형식 아님'); }
}

/**
 * @returns {{ok:true,text,provider,model,attempts}|{ok:false,attempts}}
 * attempts: 시도한 순서대로 [{provider, ok, reason}]
 */
export async function callAI({ system, user, json = false, only = null }) {
  const attempts = [];
  for (const p of PROVIDERS) {
    if (only && only !== p.id) continue;
    try {
      const { text, model } = await tryProvider(p, { system, user, json });
      if (json) parseJson(text); // 형식이 깨졌으면 다음 AI 로
      attempts.push({ provider: p.id, ok: true });
      console.log('[AI] 답한 곳:', p.label, model);
      return { ok: true, text, provider: p.id, providerLabel: p.label, model, attempts };
    } catch (e) {
      attempts.push({ provider: p.id, ok: false, reason: e.reason || '오류' });
      console.log('[AI] 실패:', p.label, '-', e.reason || e.message);
    }
  }
  return { ok: false, attempts };
}

export function keyStatus() {
  return PROVIDERS.map((p) => ({ provider: p.id, env: p.env, hasKey: Boolean((process.env[p.env] || '').trim()) }));
}
