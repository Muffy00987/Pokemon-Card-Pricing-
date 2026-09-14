(() => {
  const GRADERS = ['PSA','BGS','CGC','TAG'];
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

  function ladderHtml(graderData, detailed = false) {
    const rows = tierEntries(graderData);
    if (!rows.length) return detailed ? '<div class="muted">No accepted grade 7+ sales in this 3-day window.</div>' : '—';
    if (detailed) {
      return rows.map(x => `<div class="detail-grade-row"><span><b>${esc(x.display)}</b>${x.label ? ` <span class="special-label">${esc(x.label)}</span>` : ''}</span><span>${money(x.median)} <small>n=${x.count} · match ${x.avgMatch ?? '—'}</small></span></div>`).join('');
    }
    return `<div class="mini-ladder">${rows.map(x => `<div><span>${esc(x.display)}</span><b>${money(x.median)}</b><small>n=${x.count}</small></div>`).join('')}</div>`;
  }

  function imageSource(c, k) {
    const live = c.live;
    const a = state.activity[k];
    return safeUrl(live?.image || live?.rawSales?.find(x => x.thumbnail || x.image)?.thumbnail || live?.rawSales?.find(x => x.image)?.image || a?.latest?.thumbnail || a?.latest?.image);
  }

  function cardImage(c, k) {
    const src = imageSource(c, k);
    if (!src) return `<button class="card-thumb-btn open-card" data-k="${esc(k)}" title="Open card details"><span class="card-thumb placeholder">No image</span></button>`;
    return `<button class="card-thumb-btn open-card" data-k="${esc(k)}" title="Open card details"><img class="card-thumb" src="${esc(src)}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer"></button>`;
  }

  function qualityLines(live) {
    if (!live) return ['Not scanned yet.'];
    const sc = live.saleCounts || {};
    const lines = [`Raw: ${sc.rawReturned ?? 0} returned / ${sc.rawAccepted ?? 0} accepted`];
    for (const g of GRADERS) lines.push(`${g}: ${sc.gradedReturned?.[g] ?? 0} returned / ${sc.gradedAccepted?.[g] ?? 0} accepted`);
    const attempts = live.attempts || {};
    const fmt = a => (a || []).map(x => `${x.mode} ${x.returned}`).join(' → ');
    if (attempts.raw?.length) lines.push(`Raw attempts: ${fmt(attempts.raw)}`);
    for (const g of GRADERS) if (attempts.graders?.[g]?.length) lines.push(`${g} attempts: ${fmt(attempts.graders[g])}`);
    const fall = [];
    if ((attempts.raw || []).some(x => x.mode === 'fallback')) fall.push('Raw');
    for (const g of GRADERS) if ((attempts.graders?.[g] || []).some(x => x.mode === 'fallback')) fall.push(g);
    lines.push(fall.length ? `Fallback search used: ${fall.join(', ')}` : 'Fallback search: not needed');
    return lines;
  }

  function qualityHtml(live) {
    return `<div class="diag">${qualityLines(live).map(x => `<div>${esc(x)}</div>`).join('')}</div>`;
  }

  function saleListHtml(items, empty) {
    return (items || []).map(saleHtml).join('') || `<div class="muted">${esc(empty)}</div>`;
  }

  function ensureDetailDialog() {
    if ($('#cardDetailDialog')) return $('#cardDetailDialog');
    const dialog = document.createElement('dialog');
    dialog.id = 'cardDetailDialog';
    dialog.innerHTML = `<div class="card-detail-modal"><button class="detail-close" type="button" aria-label="Close">×</button><div id="cardDetailContent"></div></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.detail-close').onclick = () => dialog.close();
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    return dialog;
  }

  function openCardDetails(k) {
    const c = state.cards.find(x => keyOf(x) === k);
    if (!c) return;
    const live = c.live;
    const src = imageSource(c, k);
    const raw = live?.raw?.median;
    const best = live?.best;
    const bestDisplay = best?.displayGrade || `${best?.grade ?? ''}${best?.label ? ` ${best.label}` : ''}`;
    const saving = best && Number.isFinite(best.saving) ? best.saving : null;
    const dialog = ensureDetailDialog();
    const content = dialog.querySelector('#cardDetailContent');
    const graderPanels = GRADERS.map(g => `<section class="detail-panel"><h3>${g} grades 7+</h3>${ladderHtml(live?.graders?.[g], true)}</section>`).join('');
    const reasons = (live?.confidence?.reasons || []).map(r => `<div>• ${esc(r)}</div>`).join('') || '<div class="muted">No confidence assessment yet.</div>';
    content.innerHTML = `
      <div class="detail-hero">
        <div class="detail-image-wrap">${src ? `<img class="detail-image" src="${esc(src)}" alt="${esc(c.name)}" referrerpolicy="no-referrer">` : '<div class="detail-image placeholder">No image</div>'}</div>
        <div class="detail-title">
          <h2>${esc(c.name)}</h2>
          <div class="muted">${esc(c.set || '')}${c.number ? ` · #${esc(c.number)}` : ''}${c.era ? ` · ${esc(c.era)}` : ''}</div>
          <div class="detail-summary-grid">
            <div><span>Raw median</span><b>${money(raw)}</b><small>${live?.raw?.count ? `n=${live.raw.count}${live.raw.nearMintConfirmed ? ` · ${live.raw.nearMintConfirmed} NM` : ''}` : 'No accepted raw comps'}</small></div>
            <div><span>Best slab deal</span><b>${best ? `${esc(best.grader)} ${esc(bestDisplay)} · ${money(best.price)}` : '—'}</b><small>${saving != null ? `${(saving * 100).toFixed(1)}% ${saving > 0 ? 'cheaper than raw' : 'vs raw'}` : 'No bargain calculated'}</small></div>
            <div><span>Confidence</span><b>${confBadge(live?.confidence)}</b><small>${live?.updatedAt ? `Updated ${new Date(live.updatedAt).toLocaleString()}` : 'Not scanned'}</small></div>
          </div>
          <div class="detail-actions"><button type="button" class="detail-scan" data-k="${esc(k)}">Deep scan this card</button><button type="button" class="detail-identity" data-k="${esc(k)}">Edit identity</button></div>
        </div>
      </div>
      <div class="detail-section-title">Grading ladders</div>
      <div class="detail-grader-grid">${graderPanels}</div>
      <div class="detail-two-col">
        <section class="detail-panel"><h3>Data quality</h3>${qualityHtml(live)}<div class="tiny muted detail-meta">Window: ${esc(live?.lookback || 'Not scanned')}</div>${live?.query ? `<div class="tiny muted detail-meta">API search: ${esc(live.query)}</div>` : ''}</section>
        <section class="detail-panel"><h3>Why this is a bargain</h3>${best ? `<div><b>${esc(best.grader)} ${esc(bestDisplay)}</b> median ${money(best.price)} versus raw median ${money(raw)} = <b class="${saving > 0 ? 'savings' : 'negative'}">${(saving * 100).toFixed(1)}%</b> ${saving > 0 ? 'cheaper' : 'more expensive'}.</div>` : '<div class="muted">No raw-versus-grade bargain can be calculated from accepted recent comps.</div>'}<div class="detail-reasons">${reasons}</div></section>
        <section class="detail-panel"><h3>Raw sold listings used</h3><div class="sales-list">${saleListHtml(live?.rawSales, 'No accepted raw sold listings.')}</div></section>
        <section class="detail-panel"><h3>Best slab sold listings used</h3><div class="sales-list">${saleListHtml(live?.bestGradedSales, 'No accepted slab sold listings for the best grade tier.')}</div></section>
      </div>`;
    content.querySelector('.detail-scan').onclick = () => { dialog.close(); updateCards([c]); };
    content.querySelector('.detail-identity').onclick = () => { dialog.close(); openIdentity(k); };
    dialog.showModal();
  }

  const style = document.createElement('style');
  style.textContent = `
    .card-cell{display:flex;gap:10px;align-items:flex-start}.card-thumb-btn{border:0;padding:0;background:transparent;border-radius:7px;cursor:pointer}.card-thumb{width:58px;height:80px;object-fit:contain;border-radius:7px;background:#080b13;border:1px solid #2b3550;flex:0 0 auto}.card-thumb.placeholder{font-size:9px;color:#78839a;display:flex;align-items:center;justify-content:center;text-align:center}.card-meta{min-width:0}.card-link{border:0;background:transparent;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;font-weight:800}.card-link:hover{text-decoration:underline;color:var(--cyan)}.card-inline-actions{display:flex;gap:5px;margin-top:6px}.card-inline-actions button{padding:4px 7px;font-size:10px;border-radius:7px}.mini-ladder{display:grid;gap:4px}.mini-ladder>div{display:grid;grid-template-columns:minmax(50px,1fr) auto;gap:2px 6px;padding-bottom:4px;border-bottom:1px solid #222a3e;font-size:11px}.mini-ladder b{white-space:nowrap}.mini-ladder small{grid-column:1/-1;color:#8994aa}.special-label{color:#ffd36a;font-weight:800}
    #cardDetailDialog{width:min(1180px,96vw);max-height:92vh;padding:0;overflow:auto;background:#0d1120;border:1px solid #35405d;border-radius:18px;color:var(--text);box-shadow:0 30px 100px #000d}#cardDetailDialog::backdrop{background:#000c}.card-detail-modal{position:relative;padding:24px}.detail-close{position:sticky;float:right;top:10px;z-index:4;width:38px;height:38px;padding:0;border-radius:999px;font-size:24px;background:#161d30}.detail-hero{display:grid;grid-template-columns:minmax(210px,300px) 1fr;gap:24px;align-items:start}.detail-image-wrap{display:flex;justify-content:center}.detail-image{width:100%;max-height:430px;object-fit:contain;border-radius:14px;background:#070a12;border:1px solid #2a3550}.detail-image.placeholder{min-height:320px;display:flex;align-items:center;justify-content:center;color:var(--muted)}.detail-title h2{font-size:30px;margin:6px 0}.detail-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:10px;margin-top:20px}.detail-summary-grid>div,.detail-panel{background:#111727;border:1px solid #29334c;border-radius:13px;padding:12px}.detail-summary-grid span,.detail-summary-grid small{display:block;color:var(--muted)}.detail-summary-grid b{display:block;font-size:17px;margin:4px 0}.detail-actions{display:flex;gap:8px;margin-top:14px}.detail-section-title{font-size:18px;font-weight:800;margin:24px 0 10px}.detail-grader-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.detail-panel h3{margin:0 0 10px}.detail-grade-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #273048;padding:8px 0}.detail-grade-row small{color:var(--muted)}.detail-two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.detail-reasons{margin-top:10px}.detail-meta{margin-top:8px}.diag{display:grid;gap:5px}.row-quality{margin-top:6px;padding:6px 8px;border:1px solid #2b3550;border-radius:8px;background:#0d1322;font-size:10px;color:#aeb8cc;white-space:normal}.row-quality b{color:#fff}.actions-cell button{margin:0 4px 4px 0}
    @media(max-width:850px){.detail-hero{grid-template-columns:1fr}.detail-image{max-width:320px}.detail-summary-grid,.detail-grader-grid,.detail-two-col{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  window.render = function() {
    const all = filtered();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const view = all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    $('#body').innerHTML = view.map((c,i) => {
      const k = keyOf(c), live = c.live, raw = live?.raw?.median, best = live?.best;
      const save = best && Number.isFinite(best.saving) ? best.saving : null;
      const activity = state.activity[k]?.active ? '<span class="activity-pill">recent sale</span>' : '';
      const bestDisplay = best?.displayGrade || `${best?.grade ?? ''}${best?.label ? ` ${best.label}` : ''}`;
      const bestCell = best ? `${esc(best.grader)} ${esc(bestDisplay)}<br>${money(best.price)}` : '—';
      const q = qualityLines(live);
      const quickQuality = live ? `<div class="row-quality"><b>Scan data:</b> ${esc(q.slice(0,5).join(' · '))}</div>` : '';
      return `<tr>
        <td><input class="watchbox sel" data-k="${esc(k)}" type="checkbox" ${state.selected.has(k)?'checked':''}></td>
        <td><div class="card-cell">${cardImage(c,k)}<div class="card-meta"><button class="card-link open-card" data-k="${esc(k)}">${esc(c.name)}</button>${activity}<div class="set">${esc(c.set)}${c.number?` · #${esc(c.number)}`:''} · ${esc(c.era||'')}</div><div class="card-inline-actions"><button class="open-card" data-k="${esc(k)}">Details / data quality</button></div>${quickQuality}</div></div></td>
        <td class="price">${money(raw)}${live?.raw?.count?` <span class="tiny muted">n=${live.raw.count}${live.raw.nearMintConfirmed?` · ${live.raw.nearMintConfirmed} NM`:''}</span>`:''}</td>
        <td>${ladderHtml(live?.graders?.PSA)}</td><td>${ladderHtml(live?.graders?.BGS)}</td><td>${ladderHtml(live?.graders?.CGC)}</td><td>${ladderHtml(live?.graders?.TAG)}</td>
        <td>${bestCell}</td><td class="${save!=null?(save>0?'savings':'negative'):''}">${save!=null?(save*100).toFixed(1)+'%':'—'}</td><td>${confBadge(live?.confidence)}</td><td class="tiny muted">${live?.updatedAt?new Date(live.updatedAt).toLocaleString():'—'}</td>
        <td class="actions-cell"><button class="refresh" data-k="${esc(k)}">Scan</button><button class="open-card" data-k="${esc(k)}">Details</button><button class="edit" data-k="${esc(k)}">Identity</button></td>
      </tr>`;
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
    document.querySelectorAll('.open-card').forEach(b=>b.onclick=()=>openCardDetails(b.dataset.k));
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
  render();
})();
