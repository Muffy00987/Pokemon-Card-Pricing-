(() => {
  const labelRank = s => {
    s = String(s || '').toLowerCase();
    if (s.includes('black')) return 5;
    if (s.includes('perfect')) return 4;
    if (s.includes('pristine')) return 3;
    if (s.includes('gem')) return 2;
    return 1;
  };
  const tierEntries = data => Object.entries(data || {}).map(([key, v]) => {
    const parsed = Number.parseFloat(String(key).split('|')[0]);
    const grade = Number.isFinite(Number(v?.grade)) ? Number(v.grade) : parsed;
    const label = String(v?.label || '').trim();
    const display = String(v?.displayGrade || `${Number.isFinite(grade) ? grade : key}${label ? ` ${label}` : ''}`);
    return { key, grade, label, display, ...v };
  }).filter(x => Number.isFinite(x.grade) && x.grade >= 7 && Number.isFinite(x.median))
    .sort((a,b) => b.grade - a.grade || labelRank(b.label) - labelRank(a.label));

  window.bestFor = function(graderData) {
    const entries = tierEntries(graderData);
    if (!entries.length) return null;
    return entries.slice().sort((a,b) => a.median - b.median)[0];
  };

  function ladderHtml(graderData) {
    const rows = tierEntries(graderData);
    if (!rows.length) return '—';
    return `<div class="mini-ladder">${rows.map(x => `<div><span>${esc(x.display)}</span><b>${money(x.median)}</b><small>n=${x.count}</small></div>`).join('')}</div>`;
  }
  function cardImage(c, k) {
    const live = c.live;
    const a = state.activity[k];
    const src = safeUrl(live?.image || live?.rawSales?.find(x => x.thumbnail || x.image)?.thumbnail || live?.rawSales?.find(x => x.image)?.image || a?.latest?.thumbnail || a?.latest?.image);
    if (!src) return '<div class="card-thumb placeholder">No image</div>';
    return `<img class="card-thumb" src="${esc(src)}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer">`;
  }

  const style = document.createElement('style');
  style.textContent = `
    .card-cell{display:flex;gap:10px;align-items:flex-start}.card-thumb{width:58px;height:80px;object-fit:contain;border-radius:7px;background:#080b13;border:1px solid #2b3550;flex:0 0 auto}.card-thumb.placeholder{font-size:9px;color:#78839a;display:flex;align-items:center;justify-content:center;text-align:center}.card-meta{min-width:0}.mini-ladder{display:grid;gap:4px}.mini-ladder>div{display:grid;grid-template-columns:minmax(50px,1fr) auto;gap:2px 6px;padding-bottom:4px;border-bottom:1px solid #222a3e;font-size:11px}.mini-ladder b{white-space:nowrap}.mini-ladder small{grid-column:1/-1;color:#8994aa}.gradechip .grade-name{font-weight:800}.special-label{color:#ffd36a;font-weight:800}
  `;
  document.head.appendChild(style);

  const originalRender = window.render;
  window.render = function() {
    const all = filtered();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const view = all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    $('#body').innerHTML = view.map((c,i) => {
      const k = keyOf(c), live = c.live, raw = live?.raw?.median, best = live?.best;
      const save = best && Number.isFinite(best.saving) ? best.saving : null;
      const gradeDetails = ['PSA','BGS','CGC','TAG'].map(gr => {
        const rows = tierEntries(live?.graders?.[gr]);
        const html = rows.length ? rows.map(v => `<div class="gradechip"><span class="grade-name">${gr} ${esc(v.display)}${v.label ? ' <span class="special-label">'+esc(v.label)+'</span>' : ''}</span><span>${money(v.median)} <span class="tiny muted">n=${v.count} · match ${v.avgMatch}</span></span></div>`).join('') : '<span class="muted">No accepted grade 7+ sales in this 3-day window.</span>';
        return `<div class="grader"><h4>${gr} — grades 7+</h4>${html}</div>`;
      }).join('');
      const reasons = (live?.confidence?.reasons || []).map(r => `<div>• ${esc(r)}</div>`).join('') || '<div class="muted">Run a deep scan to generate an evidence assessment.</div>';
      const bestDisplay = best?.displayGrade || `${best?.grade ?? ''}${best?.label ? ` ${best.label}` : ''}`;
      const why = best ? `<div><b>${best.grader} ${esc(bestDisplay)}</b> median ${money(best.price)} versus raw median ${money(raw)} = <b class="${save>0?'savings':'negative'}">${(save*100).toFixed(1)}%</b> ${save>0?'cheaper':'more expensive'}.</div>` : '<div class="muted">No raw-versus-grade bargain can be calculated from accepted recent comps.</div>';
      const rawSales = (live?.rawSales || []).map(saleHtml).join('') || '<div class="muted">No accepted raw listings.</div>';
      const slabSales = (live?.bestGradedSales || []).map(saleHtml).join('') || '<div class="muted">No accepted slab listings for the best grade tier.</div>';
      const activity = state.activity[k]?.active ? '<span class="activity-pill">recent sale</span>' : '';
      const bestCell = best ? `${best.grader} ${esc(bestDisplay)}<br>${money(best.price)}` : '—';
      return `<tr><td><input class="watchbox sel" data-k="${esc(k)}" type="checkbox" ${state.selected.has(k)?'checked':''}></td><td><div class="card-cell">${cardImage(c,k)}<div class="card-meta"><div class="cardname">${esc(c.name)}${activity}</div><div class="set">${esc(c.set)}${c.number?` · #${esc(c.number)}`:''} · ${esc(c.era||'')}</div></div></div></td><td class="price">${money(raw)}${live?.raw?.count?` <span class="tiny muted">n=${live.raw.count}${live.raw.nearMintConfirmed?` · ${live.raw.nearMintConfirmed} NM`:''}</span>`:''}</td><td>${ladderHtml(live?.graders?.PSA)}</td><td>${ladderHtml(live?.graders?.BGS)}</td><td>${ladderHtml(live?.graders?.CGC)}</td><td>${ladderHtml(live?.graders?.TAG)}</td><td>${bestCell}</td><td class="${save!=null?(save>0?'savings':'negative'):''}">${save!=null?(save*100).toFixed(1)+'%':'—'}</td><td>${confBadge(live?.confidence)}</td><td class="tiny muted">${live?.updatedAt?new Date(live.updatedAt).toLocaleString():'—'}</td><td><button class="refresh" data-k="${esc(k)}">Scan</button> <button class="grades" data-id="d${i}">Evidence</button> <button class="edit" data-k="${esc(k)}">Identity</button></td></tr><tr id="d${i}" class="details"><td colspan="12"><div class="grader-grid">${gradeDetails}</div><div class="why-grid"><div class="why"><h4>Why this is a bargain</h4>${why}<div style="margin-top:8px">${reasons}</div>${live?.query?`<div class="tiny muted" style="margin-top:8px">API search: ${esc(live.query)}</div>`:''}</div><div class="sales-box"><h4>Data quality</h4>${dataQualityHtml(live)}<div class="tiny muted" style="margin-top:6px">Window: ${esc(live?.lookback||'Not scanned')}</div></div><div class="sales-box"><h4>Raw sold listings used</h4><div class="sales-list">${rawSales}</div></div><div class="sales-box"><h4>Best slab sold listings used</h4><div class="sales-list">${slabSales}</div></div></div></td></tr>`;
    }).join('');
    $('#count').textContent=all.length;
    $('#priced').textContent=state.cards.filter(c=>c.live).length;
    $('#deals').textContent=state.cards.filter(c=>c.live?.best?.saving>0).length;
    $('#selected').textContent=state.selected.size;
    $('#updateSelected').textContent=`Deep scan selected (${state.selected.size})`;
    $('#pageInfo').textContent=`Page ${state.page} of ${pages}`;
    $('#prev').disabled=state.page<=1; $('#next').disabled=state.page>=pages; $('#quota').textContent=rateText();
    const matchKeys=all.map(keyOf), allSelected=matchKeys.length&&matchKeys.every(k=>state.selected.has(k)); $('#selectAll').textContent=allSelected?'Clear selected':'Select all';
    document.querySelectorAll('.sel').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.k):state.selected.delete(el.dataset.k);saveSelected();render()});
    document.querySelectorAll('.grades').forEach(b=>b.onclick=()=>$('#'+b.dataset.id).classList.toggle('open'));
    document.querySelectorAll('.refresh').forEach(b=>b.onclick=()=>{const c=state.cards.find(x=>keyOf(x)===b.dataset.k);updateCards([c])});
    document.querySelectorAll('.edit').forEach(b=>b.onclick=()=>openIdentity(b.dataset.k));
  };

  document.querySelectorAll('thead th').forEach(th => {
    const t = th.textContent.trim();
    if (t === 'PSA 7+') th.textContent = 'PSA grades 7–10';
    if (t === 'BGS 7+') th.textContent = 'BGS 7+ / Pristine / Black Label';
    if (t === 'CGC 7+') th.textContent = 'CGC 7+ / Pristine';
    if (t === 'TAG 7+') th.textContent = 'TAG 7+ / Pristine';
  });
  if (typeof originalRender === 'function') window.render();
})();
