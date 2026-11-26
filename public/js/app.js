/* 성북 안심 민원 필터 — 화면 동작 (public 에는 키를 두지 않는다. AI · 공공 API 는 /api 서버만 부른다) */
(() => {
  'use strict';

  // ---------- 공통 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가여도 화면은 동작 */ } },
  };
  const STAGES = ['정상', '검토필요', '차단후보'];
  const ICON = {
    check: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    x: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chev: '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    pen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/></svg>',
    inbox: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5"/></svg>',
    chart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  };
  const loader = '<span class="loader" aria-label="불러오는 중"><i></i><i></i><i></i></span>';
  const nowText = () => new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function post(url, body) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 70000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      const j = await r.json().catch(() => ({ ok: false, error: '답을 읽지 못했어요' }));
      if (!r.ok || j.ok === false) throw new Error(j.error || '요청에 실패했어요. 잠시 뒤 다시 해 주세요');
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('시간이 너무 오래 걸렸어요. 다시 해 주세요');
      throw e;
    } finally { clearTimeout(t); }
  }

  // ---------- 상태 ----------
  const S = {
    route: 'home',
    samples: [],
    draft: '',
    busy: false,
    err: '',
    done: null,
    prevFlagged: false,
    officerTab: '차단후보',
    manual: store.get('sb_manual', false),
    sheet: null,
    chat: [],
    chatBusy: false,
  };
  const subs = () => store.get('sb_sub', []);
  const decs = () => store.get('sb_dec', {});
  const lives = () => store.get('sb_live', {});

  function logAI(kind, r) {
    if (!r) return;
    const log = store.get('sb_ailog', []);
    log.unshift({ at: nowText(), kind, provider: r.providerLabel || (r.provider ? r.provider : '없음'), mode: r.mode, tried: (r.attempts || []).map((a) => a.provider + (a.ok ? ' 성공' : ' ' + a.reason)).join(' → ') });
    store.set('sb_ailog', log.slice(0, 30));
  }

  // ---------- 항목(가상 샘플 + 방금 접수) ----------
  function allItems() {
    const liveMap = lives();
    const dec = decs();
    const samples = S.samples.map((s) => {
      const live = liveMap[s.id];
      const base = {
        id: s.id, source: '가상 샘플', at: null, text: s.text, border: s.border, mode: '시연 값', provider: null, providerLabel: null,
        aiStage: s.stage, ai: { stage: s.stage, reason: s.reason, normalEvidence: s.normalEvidence, suggestion: s.suggestion, summary: s.summary, flagged: [] },
        rules: { hits: [] }, stage: s.stage, choice: null,
      };
      if (live) {
        base.mode = live.mode; base.provider = live.provider; base.providerLabel = live.providerLabel; base.model = live.model;
        base.ai = live.ai; base.rules = live.rules; base.aiStage = live.ai.stage || live.rules.stage; base.stage = live.stage;
      }
      return base;
    });
    const mine = subs().map((r) => ({ ...r, source: '방금 접수' }));
    return [...mine, ...samples].map((it) => ({ ...it, currentStage: it.manual ? null : (dec[it.id]?.stage || it.stage), decision: dec[it.id] || null }));
  }

  // ---------- 화면: 위쪽 ----------
  function renderTop() {
    const tabs = [['citizen', '민원인'], ['officer', '공무원'], ['admin', '관리자']];
    $('#topbar').innerHTML = `
      <div class="appbar">
        <a class="brand" href="#/home" data-act="nav" data-to="home" aria-label="홈으로 가기">${ICON.home}성북 안심 민원</a>
        <span class="demo-pill">시연용</span>
      </div>
      <div class="roles"><div class="seg" role="tablist" aria-label="화면 선택">
        ${tabs.map(([k, v]) => `<button type="button" role="tab" aria-selected="${S.route === k}" data-act="nav" data-to="${k}">${v}</button>`).join('')}
      </div></div>`;
  }

  // ---------- 화면: 홈 ----------
  function viewHome() {
    return `<section class="view">
      <p class="demo-pill" style="display:inline-block">가상 민원만 써요 · 서버에 저장되지 않아요</p>
      <h1>AI는 표시만 하고,<br>결정은 사람이 해요</h1>
      <p class="lead">욕설이나 협박이 섞인 온라인 민원 글을 담당 공무원이 원문 그대로 읽지 않아도 되게 도와요. 민원인은 어떤 글이든 그대로 제출할 수 있어요.</p>
      <div class="section-head" style="margin-top:24px !important"><h2>1. 성북 안심민원이란?</h2></div>
      <p>온라인으로 들어오는 민원 글에 섞인 욕설·협박 표현을 AI가 미리 순화해서, 담당 공무원이 원문을 그대로 읽지 않아도 되게 돕는 서비스예요.</p>
      <p>AI는 표시와 단계 제안까지만 하고, 최종 결정은 담당 공무원이 해요.</p>
      <table class="flow">
        <caption class="sr-only">민원 처리 흐름</caption>
        <thead><tr><th scope="col">민원 제출</th><th scope="col">AI 검토</th><th scope="col">단계 제안</th><th scope="col">공무원 최종 확인</th></tr></thead>
        <tbody>
          <tr><td><span class="badge demo">민원인</span></td><td><span class="badge ai">AI</span></td><td><span class="badge ai">AI</span></td><td><span class="badge confirmed">공무원</span></td></tr>
          <tr><td>글을 써서 내요</td><td>표현을 확인해요</td><td>3단계로 제안해요</td><td>확정하거나 바꿔요</td></tr>
        </tbody>
      </table>
      <div class="section-head" style="margin-top:24px !important"><h2>2. 처음이라면 이 순서로 눌러 보세요</h2></div>
      <p class="muted">카드를 누르면 그 화면으로 이동해요. 위쪽 탭이나 집 모양 아이콘으로 언제든 돌아올 수 있어요.</p>
      <ol class="steps">
        <li><a class="step" href="#/citizen" data-act="nav" data-to="citizen">
          <span class="step-no" aria-hidden="true">1</span>
          <span class="grow"><span class="badge demo">민원인 화면</span><span class="title">민원 글을 써서 제출해 보기</span><span class="sub">예시 글을 눌러 채우고 제출하면, AI가 표현을 확인해요</span></span>
          <span class="step-go">써 보기 ${ICON.chev}</span></a></li>
        <li><a class="step" href="#/officer" data-act="nav" data-to="officer">
          <span class="step-no" aria-hidden="true">2</span>
          <span class="grow"><span class="badge demo">공무원 화면</span><span class="title">들어온 민원을 확인하고 확정하기</span><span class="sub">1번에서 낸 글이 정상 · 검토필요 · 차단후보로 나뉘어 보여요</span></span>
          <span class="step-go">확인하기 ${ICON.chev}</span></a></li>
        <li><a class="step" href="#/admin" data-act="nav" data-to="admin">
          <span class="step-no" aria-hidden="true">3</span>
          <span class="grow"><span class="badge demo">관리자 화면</span><span class="title">확정·변경 기록과 통계 살펴보기</span><span class="sub">판단 변경률 · 판단 이력 · AI 호출 기록을 봐요</span></span>
          <span class="step-go">살펴보기 ${ICON.chev}</span></a></li>
      </ol>
      <div class="section-head"><h2>3. 이 서비스가 하지 않는 일</h2></div>
      <div class="card">
        <ul style="padding-left:18px;color:var(--grey-800)">
          <li>접수를 거부하거나 글을 삭제하지 않아요</li>
          <li>민원을 자동으로 끝내지 않아요</li>
          <li>제출 횟수 · 시간대 · IP로 글을 가려내지 않아요</li>
          <li>특정 민원인을 목록으로 만들거나 제재하지 않아요</li>
        </ul>
      </div>
      <p class="muted">궁금한 점은 오른쪽 아래 「물어보기」에서 물어보세요. 참고 문서에 있는 내용으로만 답해요.</p>
    </section>`;
  }

  // ---------- 화면: 민원인 ----------
  function viewCitizen() {
    if (S.done) return viewCitizenDone();
    const samples = [['S03', '강한 불만'], ['S05', '비꼬는 말'], ['S09', '위협 표현']];
    return `<section class="view">
      <h1>민원 내용을<br>적어 주세요</h1>
      <div class="notice">${ICON.info}<span>표현을 확인하는 데 <b>AI가 쓰여요</b>. AI는 안내만 하고, 어떤 글이든 그대로 제출할 수 있어요.${S.manual ? '<br><b>지금은 관리자가 AI 표시를 멈춘 수동 모드예요.</b>' : ''}</span></div>
      <div class="field">
        <label for="draft">민원 내용</label>
        <textarea id="draft" maxlength="2000" placeholder="예) 성북동 골목 가로등이 꺼져 있어요. 빨리 고쳐 주세요." ${S.busy ? 'disabled' : ''}>${esc(S.draft)}</textarea>
        <div class="counter num"><span id="count">${S.draft.length}</span> / 2,000</div>
        ${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ''}
      </div>
      <div>
        <p class="muted" style="margin-bottom:8px">시연용 예시 글(가상)</p>
        <div class="chips">${samples.map(([id, label]) => `<button type="button" class="chip" data-act="fill" data-id="${id}">${label}</button>`).join('')}</div>
      </div>
      <p class="muted">이름 · 전화번호 · 주소는 AI에 보내기 전에 *** 로 가려져요. 시연에서는 실제 개인정보를 쓰지 마세요.</p>
      <div class="bottom-cta"><button class="btn xl" type="button" data-act="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? loader : '제출하기'}</button></div>
    </section>`;
  }

  function viewCitizenDone() {
    const d = S.done;
    const flaggedAsIs = d.stage === '차단후보' && d.choice === '그대로 제출';
    return `<section class="view">
      <div class="result">
        <div class="mark">${ICON.check}</div>
        <h1>접수됐어요</h1>
        <p>${flaggedAsIs ? '접수되었습니다. 일부 표현은 가려진 채 담당자에게 전달됩니다.' : '담당 공무원이 확인해요.'}</p>
        <p>주말·공휴일을 빼고 7일 안에 답변을 드려요. 필요하면 처리 기간이 늘어날 수 있어요.</p>
      </div>
      ${d.providerLabel ? `<p class="muted" style="text-align:center">표현 확인: ${esc(d.providerLabel)} (${esc(d.mode)})</p>` : ''}
      <div class="btn-stack" style="margin-top:32px">
        <button class="btn xl" type="button" data-act="nav" data-to="officer">공무원 화면에서 보기</button>
        <button class="btn xl secondary" type="button" data-act="again">새 민원 쓰기</button>
      </div>
    </section>`;
  }

  // ---------- 화면: 공무원 ----------
  function stageBadge(s) { return s ? `<span class="badge s-${s}">${s}</span>` : ''; }

  function viewOfficer() {
    const items = allItems();
    const manual = S.manual;
    const counts = Object.fromEntries(STAGES.map((s) => [s, items.filter((i) => i.currentStage === s).length]));
    const tab = S.officerTab;
    const shown = manual ? items : items.filter((i) => i.currentStage === tab);
    return `<section class="view">
      <h1>${manual ? '들어온 민원' : '분류 현황판'}</h1>
      <p class="lead">${manual ? 'AI 표시가 멈춰 있어요. 원문을 그대로 확인해 주세요.' : 'AI가 제안한 단계예요. 확정하거나 바꾸는 건 담당 공무원이에요.'}</p>
      ${manual ? '' : `<div class="chips" role="tablist" aria-label="단계">${STAGES.map((s) => `<button type="button" class="chip" role="tab" aria-pressed="${tab === s}" data-act="otab" data-s="${s}">${s} <span class="count">${counts[s]}</span></button>`).join('')}</div>`}
      <div class="list">
        ${shown.length ? shown.map((it) => `
          <button type="button" class="row" data-act="open" data-id="${esc(it.id)}">
            ${manual ? '<span class="avatar">' + ICON.inbox + '</span>' : `<span class="stage-avatar s-${it.currentStage}">${it.currentStage}</span>`}
            <span class="grow">
              <span class="title">${esc(manual ? it.text : (it.ai?.summary || it.text))}</span>
              <span class="sub">${esc(it.source)}${it.at ? ' · ' + esc(it.at) : ''}${it.decision ? ' · <span class="confirmed-text">✓ 단계 확정됨</span>' : ''}</span>
            </span>${ICON.chev}
          </button>`).join('') : '<div class="row"><span class="grow sub">이 단계에 해당하는 민원이 없어요</span></div>'}
      </div>
      <p class="muted">가상 샘플 10건의 단계는 기획안 표 2의 값이고(시연 값), 「AI로 다시 분석」을 누르면 실제 AI가 다시 판단해요.</p>
    </section>`;
  }

  function highlightOriginal(text, flagged) {
    let html = esc(text);
    (flagged || []).forEach((f) => {
      const e = esc(f.sentence || '');
      if (e && html.includes(e)) html = html.replace(e, '<mark>' + e + '</mark>');
    });
    return html;
  }

  function itemSheet(id, showOrig) {
    const it = allItems().find((i) => i.id === id);
    if (!it) return '';
    const manual = S.manual;
    const hitsByCat = {};
    (it.rules?.hits || []).forEach((h) => { hitsByCat[h.category] = (hitsByCat[h.category] || 0) + 1; });
    const aiMade = '<span class="badge ai">AI가 만든 문장</span>';
    const hist = it.decision?.history || [];
    const last = hist.at(-1);
    const locked = !manual && Boolean(it.decision) && !S.sheet.editing;
    const lastText = !last ? '' : (last.kind === '확정'
      ? `AI 제안 그대로 「${last.to}」로 확정했어요 · ${last.at}`
      : `「${last.from}」에서 「${last.to}」${last.to === '정상' ? '으로' : '로'} 바꿔 확정했어요 · ${last.at}`);
    const ai = it.ai || {};
    const stage = it.currentStage;
    return `
      <div class="sheet-head"><div><h2>${manual ? '민원 원문' : '민원 확인'}</h2><p class="muted">${esc(it.source)}${it.at ? ' · ' + esc(it.at) : ''}</p></div><button class="icon-btn" type="button" data-act="close" aria-label="닫기">${ICON.x}</button></div>
      ${manual ? '' : `
      <div class="chips">${stageBadge(stage)}${it.decision ? '<span class="badge confirmed">✓ 단계 확정됨</span>' : ''}
        <span class="badge ${it.mode === '실시간' ? 'live' : 'demo'}">${esc(it.mode)}</span>
        ${it.providerLabel ? '<span class="badge demo">' + esc(it.providerLabel) + ' 답변</span>' : ''}</div>
      <div class="aibox"><div class="label">핵심 요약 ${aiMade}</div><p>${esc(ai.summary)}</p></div>
      ${stage === '정상' ? '' : `<div class="aibox"><div class="label">순화본 · 요구는 그대로, 표현만 바꿨어요 ${aiMade}</div><p>${esc(ai.suggestion)}</p></div>`}
      <div class="pair">
        <div class="aibox"><div class="label">AI 판단 이유</div><p>${esc(ai.reason || '-')}</p></div>
        <div class="aibox"><div class="label">정상 민원일 수 있는 근거</div><p>${esc(ai.normalEvidence || '-')}</p></div>
      </div>
      ${Object.keys(hitsByCat).length ? `<div><p class="muted" style="margin-bottom:8px">1차 표현 목록에서 걸린 것(표현은 가려서 보여 줘요)</p><div class="chips">${Object.entries(hitsByCat).map(([c, n]) => `<span class="chip">${esc(c)} <span class="count">${n}</span></span>`).join('')}</div></div>` : ''}
      `}
      ${showOrig || manual || stage === '정상'
        ? `<div class="aibox"><div class="label">원문${manual || stage === '정상' ? '' : ' · 문제 문장 표시'}</div><p>${highlightOriginal(it.text, ai.flagged)}</p></div>${manual || stage === '정상' ? '' : '<button class="btn m secondary" type="button" data-act="toggleorig" data-id="' + esc(it.id) + '">원문 닫기</button>'}`
        : `<button class="btn m secondary" type="button" data-act="toggleorig" data-id="${esc(it.id)}">원문 보기</button>`}
      ${manual ? '' : `
      ${locked ? `
      <div class="notice confirmed-box">${ICON.info}<span><b>단계를 확정했어요</b><br>${esc(lastText)}</span></div>
      <button class="btn secondary" type="button" data-act="edit" data-id="${esc(it.id)}">단계 수정하기</button>
      ` : `
      <div class="field">
        <label>${it.decision ? '단계 수정하기' : '단계 정하기'}</label>
        <div class="chips" role="group" aria-label="단계">${STAGES.map((s) => `<button type="button" class="chip" aria-pressed="${(S.sheet.pick || stage) === s}" data-act="pick" data-s="${s}">${s}</button>`).join('')}</div>
      </div>
      ${(S.sheet.pick && S.sheet.pick !== stage) ? `
      <div class="field">
        <label>바꾸는 이유(한 번만 골라 주세요)</label>
        <div class="chips" role="group" aria-label="이유">${['문맥상 정당한 표현이에요', '욕설·모욕이 뚜렷해요', '위협 표현이 있어요', '그 밖의 이유예요'].map((r) => `<button type="button" class="chip" aria-pressed="${S.sheet.why === r}" data-act="why" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      </div>` : ''}
      <div class="btn-row">
        <button class="btn" type="button" data-act="decide" data-id="${esc(it.id)}" ${(S.sheet.pick && S.sheet.pick !== stage && !S.sheet.why) ? 'disabled' : ''}>${(S.sheet.pick && S.sheet.pick !== stage) ? '단계 변경' : '단계 확정'}</button>
        ${it.decision
          ? '<button class="btn secondary" type="button" data-act="cancel-edit">취소</button>'
          : `<button class="btn secondary" type="button" data-act="reanalyze" data-id="${esc(it.id)}" ${S.sheet.busy ? 'disabled' : ''}>${S.sheet.busy ? loader : 'AI로 다시 분석'}</button>`}
      </div>
      `}
      ${S.sheet.err ? `<p class="err" role="alert">${esc(S.sheet.err)}</p>` : ''}
      ${it.attempts?.length ? `<p class="muted">AI 시도 기록: ${esc(it.attempts.map((a) => a.provider + (a.ok ? ' 성공' : ' ' + a.reason)).join(' → '))}</p>` : ''}
      ${hist.length ? `<div><h3 style="margin-bottom:8px">판단 이력</h3><div class="table-wrap"><table class="table"><thead><tr><th>시각</th><th>단계</th><th>구분</th><th>이유</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${esc(h.at)}</td><td>${esc(h.from)} → ${esc(h.to)}</td><td>${esc(h.kind)}</td><td>${esc(h.reason || '-')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      `}`;
  }

  // ---------- 화면: 관리자 ----------
  function viewAdmin() {
    return `<section class="view">
      <h1>통계 · 감독</h1>
      <p class="lead">오분류와 판단 변경 추이를 보고, 이상하면 AI 표시를 멈출 수 있어요.</p>
      ${adminStats()}
    </section>`;
  }

  function adminStats() {
    const items = allItems().filter((i) => !i.manual);
    const counts = Object.fromEntries(STAGES.map((s) => [s, items.filter((i) => i.currentStage === s).length]));
    const max = Math.max(1, ...Object.values(counts));
    const dec = decs();
    const reviewed = Object.values(dec).length;
    const changed = Object.values(dec).filter((d) => d.history.at(-1).kind === '변경').length;
    const rate = reviewed ? Math.round((changed / reviewed) * 1000) / 10 : null;
    const history = Object.entries(dec).flatMap(([id, d]) => d.history.map((h) => ({ id, ...h }))).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const log = store.get('sb_ailog', []);
    return `
      <div class="card plain">
        <h2>단계별 건수</h2>
        <div class="bars">${STAGES.map((s) => `<div class="col"><span class="val">${counts[s]}</span><div class="bar ${s === '차단후보' ? 'hi' : ''}" style="height:${Math.max(4, (counts[s] / max) * 90)}px"></div><span class="lab">${s}</span></div>`).join('')}</div>
        <p class="muted">가상 샘플 10건과 이 브라우저에서 접수한 글을 합친 값이에요(시연용 · 서버에 저장되지 않아요).</p>
      </div>
      <div class="card plain">
        <h2>판단 변경률</h2>
        <p class="big">${rate === null ? '-' : rate + '%'}</p>
        <p class="muted">담당 공무원이 AI 단계를 바꾼 비율 = 변경 ${changed}건 ÷ 검토 ${reviewed}건 × 100. ${rate === null ? '아직 검토한 글이 없어요.' : ''}</p>
      </div>
      <div class="card plain">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
          <div><h2>AI 표시 일시 중지</h2><p class="muted">켜면 수동 모드가 돼요. 민원인 안내 창과 공무원 화면의 AI 표시가 멈춰요.</p></div>
          <button type="button" class="switch" role="switch" aria-checked="${S.manual}" aria-label="AI 표시 일시 중지" data-act="manual"></button>
        </div>
      </div>
      <div class="card plain">
        <h2>판단 이력</h2>
        ${history.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>시각</th><th>글</th><th>단계</th><th>구분 · 이유</th></tr></thead><tbody>${history.map((h) => `<tr><td>${esc(h.at)}</td><td>${esc(h.id)}</td><td>${esc(h.from)} → ${esc(h.to)}</td><td>${esc(h.kind)}${h.reason ? ' · ' + esc(h.reason) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">공무원 화면에서 단계를 확정하거나 바꾸면 여기에 쌓여요.</p>'}
      </div>
      <div class="card plain">
        <h2>AI 호출 기록</h2>
        ${log.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>시각</th><th>용도</th><th>답한 AI</th><th>시도 순서</th></tr></thead><tbody>${log.map((l) => `<tr><td>${esc(l.at)}</td><td>${esc(l.kind)}</td><td>${esc(l.provider)} (${esc(l.mode)})</td><td>${esc(l.tried)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">민원을 제출하거나 챗봇에 물어보면 어느 AI가 답했는지 남아요.</p>'}
      </div>
      <button class="btn secondary" type="button" data-act="reset">시연 기록 모두 지우기</button>`;
  }

  // ---------- 시트(바텀시트) ----------
  function closeSheet() { S.sheet = null; renderSheet(); }

  function renderSheet() {
    const root = $('#sheet-root');
    const sh = S.sheet;
    if (!sh) { root.innerHTML = ''; return; }
    let inner = '';
    if (sh.type === 'item') inner = itemSheet(sh.id, sh.showOrig);
    if (sh.type === 'guide') inner = guideSheet(sh);
    if (sh.type === 'chat') inner = chatSheet();
    const labelled = sh.type === 'chat' ? '안내 챗봇' : sh.type === 'guide' ? '표현 확인' : '민원 확인';
    root.innerHTML = `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${labelled}">${inner}</div>`;
    if (sh.type === 'chat') {
      const log = $('.chat-log', root);
      if (log) log.scrollTop = log.scrollHeight;
      const inp = $('#chat-input', root);
      if (inp && !S.chatBusy) inp.focus();
    }
  }

  function guideSheet(sh) {
    const r = sh.r;
    const flagged = (r.ai?.flagged?.length ? r.ai.flagged : (r.rules?.flagged || []).map((f) => ({ sentence: f.sentence, why: f.hits.map((h) => h.category).join('·') }))) || [];
    return `
      <div class="sheet-head"><div><h2>표현을 한 번 확인해 주세요</h2><p class="muted">고치지 않아도 그대로 제출할 수 있어요</p></div><button class="icon-btn" type="button" data-act="close" aria-label="닫기">${ICON.x}</button></div>
      <div class="notice">${ICON.info}<span>이 안내에 <b>AI가 쓰였어요</b>. 아래 문장은 AI가 만든 제안이고, 접수와 처리 기한에는 영향이 없어요.</span></div>
      ${flagged.length ? `<div><h3 style="margin-bottom:8px">이 문장이 거칠게 읽힐 수 있어요</h3>${flagged.map((f) => `<div class="aibox" style="margin-bottom:8px"><p><mark>${esc(f.sentence)}</mark></p><p class="muted" style="margin-top:4px">${esc(f.why || '')}</p></div>`).join('')}</div>` : ''}
      <div class="aibox"><div class="label">제안 문장 <span class="badge ai">AI가 만든 문장</span></div><p>${esc(r.ai?.suggestion || '')}</p></div>
      <div class="btn-stack">
        <button class="btn" type="button" data-act="g-suggest" ${S.busy ? 'disabled' : ''}>${S.busy ? loader : '제안대로 고치기'}</button>
        <button class="btn secondary" type="button" data-act="g-edit" ${S.busy ? 'disabled' : ''}>직접 고치기</button>
        <button class="btn ghost" type="button" data-act="g-asis" ${S.busy ? 'disabled' : ''}>그대로 제출</button>
      </div>
      <p class="muted">분석: ${esc(r.providerLabel || '표현 목록')} (${esc(r.mode)})</p>`;
  }

  function chatSheet() {
    const chips = ['차단후보로 분류되면 접수가 거부되나요?', '구청장에게 바란다 처리 기간은 며칠이에요?', '개인정보를 AI에 보내도 되나요?', '악성 민원 종결 처리는 어떻게 되나요?'];
    return `
      <div class="sheet-head"><div><h2>무엇이든 물어보세요</h2><p class="muted">참고 문서에 있는 내용으로만 답해요</p></div><button class="icon-btn" type="button" data-act="close" aria-label="닫기">${ICON.x}</button></div>
      <div class="chat-log" id="chat-log">
        ${S.chat.length ? '' : `<div class="bubble bot">서비스 규칙이나 관련 법령이 궁금하면 물어보세요. 개별 민원의 단계는 담당 공무원이 정해요.</div><div class="chips">${chips.map((c) => `<button type="button" class="chip" data-act="chat-chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>`}
        ${S.chat.map((m) => m.role === 'me' ? `<div class="bubble me">${esc(m.text)}</div>` : `
          <div class="bubble bot">${esc(m.text)}
            ${m.sources?.length ? `<div class="src">${m.sources.map((s) => `<span>근거 · ${esc(s.doc)}</span>`).join('')}</div>` : ''}
            <div class="meta"><span class="badge ai">AI가 만든 문장</span>${m.provider ? `<span>${esc(m.provider)} · ${esc(m.mode)}</span>` : `<span>${esc(m.mode || '')}</span>`}</div>
          </div>`).join('')}
        ${S.chatBusy ? `<div class="bubble bot">${loader}</div>` : ''}
      </div>
      <form class="chat-form" id="chat-form"><input type="text" id="chat-input" placeholder="질문을 입력해 주세요" maxlength="500" autocomplete="off" aria-label="질문"><button class="btn" type="submit" ${S.chatBusy ? 'disabled' : ''}>보내기</button></form>`;
  }

  // ---------- 토스트 ----------
  let toastTimer;
  function toast(msg) {
    const root = $('#toast-root');
    root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, 2600);
  }

  // ---------- 그리기 ----------
  function render() {
    renderTop();
    const app = $('#app');
    const views = { home: viewHome, citizen: viewCitizen, officer: viewOfficer, admin: viewAdmin };
    app.innerHTML = (views[S.route] || viewHome)();
    $('#fab').hidden = S.sheet?.type === 'chat';
  }

  function go(to) {
    S.route = ['home', 'citizen', 'officer', 'admin'].includes(to) ? to : 'home';
    if (location.hash !== '#/' + S.route) history.replaceState(null, '', '#/' + S.route);
    S.err = '';
    if (S.route !== 'citizen') S.done = S.done; // 접수 결과는 화면을 오가도 유지
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- 동작 ----------
  function finalize({ text, result, choice }) {
    const masked = result?.maskedText ?? text;
    const rec = {
      id: 'U' + Date.now().toString(36).toUpperCase(),
      text: masked,
      at: nowText(),
      manual: !result,
      stage: result ? result.stage : null,
      aiStage: result ? (result.ai?.stage || result.rules?.stage) : null,
      ai: result ? result.ai : null,
      rules: result ? result.rules : { hits: [] },
      provider: result?.provider || null, providerLabel: result?.providerLabel || null, model: result?.model || null,
      mode: result?.mode || '수동', attempts: result?.attempts || [], choice,
    };
    const list = subs();
    list.unshift(rec);
    store.set('sb_sub', list.slice(0, 30));
    S.done = rec; S.draft = ''; S.busy = false; S.prevFlagged = false; S.err = '';
    S.sheet = null; renderSheet(); render();
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    const text = S.draft.trim();
    if (!text) { S.err = '민원 내용을 입력해 주세요'; render(); return; }
    S.err = ''; S.busy = true; render();
    try {
      if (S.manual) { finalize({ text, result: null, choice: null }); return; }
      const r = await post('/api/classify', { text });
      logAI('분류', r);
      if (r.stage === '차단후보') {
        S.busy = false; S.sheet = { type: 'guide', r, text }; render(); renderSheet();
      } else {
        finalize({ text, result: r, choice: S.prevFlagged ? '직접 고쳐 제출' : null });
      }
    } catch (e) {
      S.busy = false; S.err = e.message; render();
    }
  }

  async function guideChoice(kind) {
    const sh = S.sheet;
    if (!sh) return;
    if (kind === 'edit') {
      S.prevFlagged = true; S.draft = sh.text; closeSheet(); render();
      const ta = $('#draft'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    if (kind === 'asis') { finalize({ text: sh.text, result: sh.r, choice: '그대로 제출' }); return; }
    // 제안대로 고치기: 제안 문장으로 바꿔 다시 확인한 뒤 접수(어느 쪽이든 접수된다)
    S.busy = true; renderSheet();
    try {
      const nextText = sh.r.ai?.suggestion || sh.text;
      const r2 = await post('/api/classify', { text: nextText });
      logAI('분류', r2);
      finalize({ text: nextText, result: r2, choice: '제안대로 고치기' });
    } catch (e) {
      S.busy = false; renderSheet(); toast(e.message);
    }
  }

  function decide(id) {
    const it = allItems().find((i) => i.id === id);
    if (!it) return;
    const to = S.sheet.pick || it.currentStage;
    const from = it.currentStage;
    const kind = to === from ? '확정' : '변경';
    const dec = decs();
    const entry = dec[id] || { stage: from, history: [] };
    entry.stage = to;
    entry.history.push({ from, to, kind, reason: kind === '변경' ? S.sheet.why : '', at: nowText(), ts: Date.now() });
    dec[id] = entry;
    store.set('sb_dec', dec);
    // 시트를 닫지 않고 「단계 확정됨」 표시와 「단계 수정하기」 버튼을 바로 보여 준다
    S.sheet.pick = null; S.sheet.why = null; S.sheet.editing = false;
    render(); renderSheet();
    toast(kind === '확정' ? '단계를 확정했어요' : '단계를 바꿔 확정했어요');
  }

  async function reanalyze(id) {
    const it = allItems().find((i) => i.id === id);
    if (!it) return;
    S.sheet.busy = true; S.sheet.err = ''; renderSheet();
    try {
      const r = await post('/api/classify', { text: it.text });
      logAI('분류', r);
      if (id.startsWith('U')) {
        const list = subs().map((x) => (x.id === id ? { ...x, stage: r.stage, aiStage: r.ai?.stage || r.rules.stage, ai: r.ai, rules: r.rules, provider: r.provider, providerLabel: r.providerLabel, model: r.model, mode: r.mode, attempts: r.attempts } : x));
        store.set('sb_sub', list);
      } else {
        const lv = lives(); lv[id] = r; store.set('sb_live', lv);
      }
      const dec = decs(); delete dec[id]; store.set('sb_dec', dec);
      S.sheet.busy = false; S.sheet.pick = null; S.sheet.why = null;
      render(); renderSheet();
      toast(r.mode === '실시간' ? (r.providerLabel + '가 다시 분석했어요') : 'AI가 답하지 못해 시연 값으로 보여 줘요');
    } catch (e) {
      S.sheet.busy = false; S.sheet.err = e.message; renderSheet();
    }
  }

  async function ask(q) {
    const question = String(q || '').trim();
    if (!question || S.chatBusy) return;
    S.chat.push({ role: 'me', text: question });
    S.chatBusy = true; renderSheet();
    try {
      const r = await post('/api/chat', { question });
      logAI('챗봇', r);
      S.chat.push({ role: 'bot', text: r.answer, sources: r.sources, provider: r.providerLabel, mode: r.mode, known: r.known });
    } catch (e) {
      S.chat.push({ role: 'bot', text: '답을 가져오지 못했어요. ' + e.message, mode: '오류' });
    }
    S.chatBusy = false; renderSheet();
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'nav') { e.preventDefault(); if (el.dataset.to === 'citizen' && S.route === 'citizen' && S.done) { /* 그대로 */ } go(el.dataset.to); return; }
    if (act === 'fill') { const s = S.samples.find((x) => x.id === el.dataset.id); if (s) { S.draft = s.text; render(); } return; }
    if (act === 'submit') return submit();
    if (act === 'again') { S.done = null; S.draft = ''; render(); return; }
    if (act === 'otab') { S.officerTab = el.dataset.s; render(); return; }
    if (act === 'open') { S.sheet = { type: 'item', id: el.dataset.id, showOrig: false, pick: null, why: null, editing: false }; renderSheet(); return; }
    if (act === 'close') { closeSheet(); render(); return; }
    if (act === 'toggleorig') { S.sheet.showOrig = !S.sheet.showOrig; renderSheet(); return; }
    if (act === 'pick') { S.sheet.pick = el.dataset.s; S.sheet.why = null; renderSheet(); return; }
    if (act === 'why') { S.sheet.why = el.dataset.r; renderSheet(); return; }
    if (act === 'decide') return decide(el.dataset.id);
    if (act === 'edit') { S.sheet.editing = true; S.sheet.pick = null; S.sheet.why = null; renderSheet(); return; }
    if (act === 'cancel-edit') { S.sheet.editing = false; S.sheet.pick = null; S.sheet.why = null; renderSheet(); return; }
    if (act === 'reanalyze') return reanalyze(el.dataset.id);
    if (act === 'g-suggest') return guideChoice('suggest');
    if (act === 'g-edit') return guideChoice('edit');
    if (act === 'g-asis') return guideChoice('asis');
    if (act === 'manual') { S.manual = !S.manual; store.set('sb_manual', S.manual); render(); toast(S.manual ? 'AI 표시를 멈췄어요(수동 모드)' : 'AI 표시를 다시 켰어요'); return; }
    if (act === 'reset') { ['sb_sub', 'sb_dec', 'sb_live', 'sb_ailog'].forEach((k) => { try { localStorage.removeItem(k); } catch { /* 무시 */ } }); S.done = null; render(); toast('시연 기록을 지웠어요'); return; }
    if (act === 'chat-open') { S.sheet = { type: 'chat' }; renderSheet(); render(); return; }
    if (act === 'chat-chip') return ask(el.dataset.q);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'draft') {
      S.draft = e.target.value;
      const c = $('#count'); if (c) c.textContent = S.draft.length;
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'chat-form') {
      e.preventDefault();
      const inp = $('#chat-input');
      const q = inp ? inp.value : '';
      ask(q);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sheet) { closeSheet(); render(); }
  });

  window.addEventListener('hashchange', () => {
    const to = location.hash.replace('#/', '');
    if (to && to !== S.route) go(to);
  });

  // ---------- 시작 ----------
  fetch('data/sample-complaints.json')
    .then((r) => r.json())
    .then((j) => { S.samples = j.items || []; })
    .catch(() => { S.samples = []; })
    .finally(() => {
      const to = location.hash.replace('#/', '');
      S.route = ['home', 'citizen', 'officer', 'admin'].includes(to) ? to : 'home';
      render();
    });
})();
