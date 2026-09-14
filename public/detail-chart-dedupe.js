(() => {
  const COMPANIES = ['RAW','PSA','BGS','CGC','TAG'];
  const companyColors = { RAW:'#dce6f7', PSA:'#ff7f89', BGS:'#f4c56b', CGC:'#75d79a', TAG:'#69c7ef' };
  const filterState = new Map();
  let activeKey = null;
  let deduped = false;

  const norm = v => String(v || '').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
  const numberOf = c => String(c?.number || '').trim().replace(/^#/,'') || String(c?.name || '').match(/#\s*([A-Za-z0-9-]+)/)?.[1] || '';
  const genericSet = s => !String(s || '').trim() || /\bera\b/i.test(String(s || ''));
  const cleanName = c => norm(String(c?.name || '').replace(/#\s*[A-Za-z0-9-]+/g,' '));

  function pickLatestLive(cards) {
    return cards.map(c => c?.live).filter(Boolean).sort((a,b) => new Date(b?.updatedAt || 0) - new Date(a?.updatedAt || 0))[0] || null;
  }

  function dedupeCards() {
    if (deduped || !window.state?.cards?.length || typeof keyOf !== 'function') return false;
    const numbered = new Map();
    const unnumbered = new Map();
    for (const card of state.cards) {
      const num = numberOf(card);
      if (num) {
        const base = `${cleanName(card)}|${norm(num)}`;
        if (!numbered.has(base)) numbered.set(base, []);
        numbered.get(base).push(card);
      } else {
        const exact = `${cleanName(card)}|${norm(card.set)}`;
        if (!unnumbered.has(exact)) unnumbered.set(exact, []);
        unnumbered.get(exact).push(card);
      }
    }

    const result = [];
    for (const group of numbered.values()) {
      const specifics = group.filter(c => !genericSet(c.set));
      const source = specifics.length ? specifics : group;
      const bySet = new Map();
      for (const card of source) {
        const setKey = norm(card.set) || 'generic';
        if (!bySet.has(setKey)) bySet.set(setKey, []);
        bySet.get(setKey).push(card);
      }
      for (const dupes of bySet.values()) {
        const keeper = dupes[0];
        const live = pickLatestLive(group);
        if (live && !keeper.live) keeper.live = live;
        const keeperKey = keyOf(keeper);
        for (const d of group) {
          const dk = keyOf(d);
          if (state.activity?.[dk] && !state.activity?.[keeperKey]) state.activity[keeperKey] = state.activity[dk];
        }
        result.push(keeper);
      }
    }
    for (const group of unnumbered.values()) {
      const keeper = group[0];
      const live = pickLatestLive(group);
      if (live && !keeper.live) keeper.live = live;
      result.push(keeper);
    }

    const before = state.cards.length;
    state.cards = result;
    if (state.selected instanceof Set) {
      const valid = new Set(result.map(keyOf));
      state.selected = new Set([...state.selected].filter(k => valid.has(k)));
      try { saveSelected(); } catch {}
    }
    deduped = true;
    console.info(`Card list deduplicated: ${before} -> ${result.length}`);
    if (typeof render === 'function') render();
    return true;
  }

  function simplifyMainTable() {
    const body = document.querySelector('#body');
    const table = body?.closest('table');
    if (!table) return;
    table.classList.add('raw-first-table');
    const th = table.querySelectorAll('thead th');
    if (th[2]) th[2].textContent = 'Raw market estimate';
    if (th[9]) th[9].textContent = 'Confidence';
    if (th[10]) th[10].textContent = 'Updated';
  }

  function salePoints(card) {
    const live = card?.live;
    const out = [];
    const add = (company, sale) => {
      const p = Number(sale?.price);
      const t = Date.parse(sale?.date || '');
      if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(t)) return;
      const grade = company === 'RAW' ? 'Raw' : String(sale?.displayGrade || sale?.grade || 'Grade 7+');
      out.push({ company, series: company === 'RAW' ? 'Raw' : `${company} ${grade}`, grade, price:p, time:t, sale });
    };
    for (const s of live?.rawSales || []) add('RAW', s);
    for (const g of ['PSA','BGS','CGC','TAG']) for (const s of live?.gradedSales?.[g] || []) add(g, s);
    return out.sort((a,b) => a.time - b.time);
  }

  function defaultFilters(key) {
    if (!filterState.has(key)) filterState.set(key, new Set(COMPANIES));
    return filterState.get(key);
  }

  function moneyText(v) { return Number.isFinite(v) ? `$${v.toFixed(2)}` : '—'; }
  function dateLabel(t) { return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

  function chartHtml(card, key) {
    const all = salePoints(card);
    if (!card?.live) return '<div class="trend-empty">Deep scan this card to load its live price trend.</div>';
    if (!all.length) return '<div class="trend-empty">No accepted dated sales are available for the trend yet.</div>';
    const enabled = defaultFilters(key);
    const visible = all.filter(p => enabled.has(p.company));
    const controls = COMPANIES.map(c => {
      const count = all.filter(p => p.company === c).length;
      const on = enabled.has(c);
      return `<button type="button" class="trend-filter ${on ? 'on' : ''}" data-company="${c}" aria-pressed="${on}" ${count ? '' : 'disabled'}>${c === 'RAW' ? 'Raw' : c}<span>${count}</span></button>`;
    }).join('');
    if (!visible.length) return `<div class="trend-controls">${controls}</div><div class="trend-empty">Turn on at least one series with sale data.</div>`;

    const W=760,H=245,L=54,R=18,T=18,B=42;
    let minT=Math.min(...visible.map(p=>p.time)), maxT=Math.max(...visible.map(p=>p.time));
    if (minT===maxT) { minT-=43200000; maxT+=43200000; }
    let minP=Math.min(...visible.map(p=>p.price)), maxP=Math.max(...visible.map(p=>p.price));
    if (minP===maxP) { minP=Math.max(0,minP*.9); maxP=maxP*1.1; }
    const pad=(maxP-minP)*.12; minP=Math.max(0,minP-pad); maxP+=pad;
    const x=t=>L+(t-minT)/(maxT-minT)*(W-L-R);
    const y=p=>T+(maxP-p)/(maxP-minP)*(H-T-B);
    const groups=new Map();
    for (const p of visible) { if(!groups.has(p.series)) groups.set(p.series,[]); groups.get(p.series).push(p); }
    let grid='';
    for(let i=0;i<5;i++){const yy=T+i*(H-T-B)/4;const val=maxP-i*(maxP-minP)/4;grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="trend-grid"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="trend-axis">${moneyText(val)}</text>`;}
    const xTicks=[0,.5,1].map(f=>{const tt=minT+(maxT-minT)*f,xx=x(tt);return `<text x="${xx}" y="${H-14}" text-anchor="middle" class="trend-axis">${dateLabel(tt)}</text>`;}).join('');
    let seriesSvg='',legend=[]; let idx=0;
    for(const [name,pts0] of groups){const pts=pts0.slice().sort((a,b)=>a.time-b.time);const company=pts[0].company;const color=companyColors[company];const dash=company==='RAW'?'':`${4+(idx%3)*2} ${3+(idx%2)*2}`;const path=pts.map((p,i)=>`${i?'L':'M'} ${x(p.time).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');seriesSvg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.3" ${dash?`stroke-dasharray="${dash}"`:''}/>`;for(const p of pts){seriesSvg+=`<circle cx="${x(p.time).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="4.4" fill="${color}" class="trend-point"><title>${name} · ${moneyText(p.price)} · ${new Date(p.time).toLocaleString()}${p.sale?.title?` · ${String(p.sale.title).slice(0,90)}`:''}</title></circle>`;}legend.push(`<span><i style="background:${color}"></i>${esc(name)}</span>`);idx++;}
    return `<div class="trend-controls">${controls}<button type="button" class="trend-refresh">Refresh live prices</button></div><svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recent raw and graded sale price trend">${grid}${seriesSvg}${xTicks}</svg><div class="trend-legend">${legend.join('')}</div><div class="trend-foot">Live chart from accepted sales in the free 3-day window. It updates whenever this card is deep-scanned; refreshing uses API rows.</div>`;
  }

  function enhanceDialog(key = activeKey) {
    if (!key) return;
    const dialog = document.querySelector('#cardDetailDialog');
    if (!dialog?.open) return;
    const card = state.cards.find(c => keyOf(c) === key);
    if (!card) return;
    const title = dialog.querySelector('.detail-title');
    const actions = title?.querySelector('.detail-actions');
    if (!title || !actions) return;
    let wrap = title.querySelector('.price-trend-panel');
    if (!wrap) {
      wrap = document.createElement('section');
      wrap.className = 'price-trend-panel';
      actions.insertAdjacentElement('afterend', wrap);
    }
    wrap.innerHTML = `<div class="trend-head"><div><h3>Live price trend</h3><p>Raw plus grade-specific PSA, BGS, CGC and TAG sales.</p></div></div>${chartHtml(card,key)}`;
    wrap.querySelectorAll('.trend-filter').forEach(btn => btn.addEventListener('click', () => {
      const set = defaultFilters(key), company = btn.dataset.company;
      set.has(company) ? set.delete(company) : set.add(company);
      enhanceDialog(key);
    }));
    const refresh = wrap.querySelector('.trend-refresh');
    if (refresh) refresh.onclick = async () => {
      refresh.disabled = true; refresh.textContent = 'Refreshing…';
      try { await Promise.resolve(updateCards([card])); } catch {}
      setTimeout(() => enhanceDialog(key), 100);
    };
  }

  const style = document.createElement('style');
  style.textContent = `
    .raw-first-table th:nth-child(n+4):nth-child(-n+9),.raw-first-table #body td:nth-child(n+4):nth-child(-n+9){display:none!important}
    .raw-first-table{table-layout:auto}.raw-first-table #body td:nth-child(2){min-width:360px}.raw-first-table #body td:nth-child(3){min-width:145px}
    .price-trend-panel{margin-top:16px;border:1px solid #2b3550;border-radius:14px;background:#0b1120;padding:12px;min-height:290px}.trend-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.trend-head h3{margin:0;font-size:17px}.trend-head p{margin:3px 0 0;color:var(--muted);font-size:11px}.trend-controls{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.trend-filter,.trend-refresh{padding:6px 9px;border-radius:999px;font-size:11px;border:1px solid #34415d;background:#111829;color:#aeb8cc}.trend-filter.on{background:#1a2940;color:white;border-color:#55739c}.trend-filter span{margin-left:5px;opacity:.7}.trend-filter:disabled{opacity:.35;cursor:not-allowed}.trend-refresh{margin-left:auto;border-radius:8px;color:var(--cyan);font-weight:800}.trend-svg{width:100%;height:auto;display:block;overflow:visible}.trend-grid{stroke:#263149;stroke-width:1}.trend-axis{fill:#8994aa;font-size:10px}.trend-point{stroke:#0b1120;stroke-width:1.5}.trend-legend{display:flex;flex-wrap:wrap;gap:8px 12px;font-size:10px;color:#b7c1d3}.trend-legend span{display:flex;align-items:center;gap:5px}.trend-legend i{width:9px;height:9px;border-radius:50%;display:inline-block}.trend-foot{margin-top:8px;font-size:10px;color:#7f8ba3}.trend-empty{min-height:190px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);border:1px dashed #2c3750;border-radius:10px;padding:20px}
    @media(max-width:850px){.raw-first-table #body td:nth-child(2){min-width:220px}.price-trend-panel{min-height:240px}.trend-refresh{margin-left:0}}
  `;
  document.head.appendChild(style);

  document.addEventListener('click', e => {
    const opener = e.target.closest?.('.open-card');
    if (opener?.dataset?.k) { activeKey = opener.dataset.k; setTimeout(() => enhanceDialog(activeKey), 0); }
  });

  const observer = new MutationObserver(() => {
    simplifyMainTable();
    const dialog = document.querySelector('#cardDetailDialog');
    if (dialog?.open && activeKey) enhanceDialog(activeKey);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    if (dedupeCards() || tries>80) { clearInterval(timer); simplifyMainTable(); }
  },100);
})();
