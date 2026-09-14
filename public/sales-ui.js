(() => {
  const GRADERS = ['PSA','BGS','CGC','TAG'];
  let lastKey = null;

  function gradeLabel(sale) {
    const bits = [];
    if (sale?.grader) bits.push(String(sale.grader));
    if (sale?.displayGrade) bits.push(String(sale.displayGrade));
    else if (sale?.grade) bits.push(String(sale.grade));
    return bits.join(' ') || 'Graded';
  }

  function saleCard(sale, type = 'RAW') {
    const href = safeUrl(sale?.url);
    const date = sale?.date ? new Date(sale.date).toLocaleDateString() : 'Date unavailable';
    const badge = type === 'RAW' ? 'RAW' : gradeLabel(sale);
    const meta = [money(sale?.price), date, Number.isFinite(sale?.match) ? `match ${sale.match}` : null].filter(Boolean).join(' · ');
    return `<div class="sale-link-card">
      <div class="sale-link-top"><span class="sale-type-badge ${type === 'RAW' ? 'raw' : `g-${String(sale?.grader || '').toLowerCase()}`}">${esc(badge)}</span><b>${money(sale?.price)}</b></div>
      <div class="sale-link-title">${esc(sale?.title || 'Sold listing')}</div>
      <div class="sale-link-meta">${esc(meta)}</div>
      ${href ? `<a class="sale-open-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open sold listing ↗</a>` : '<span class="sale-no-link">Listing link unavailable</span>'}
    </div>`;
  }

  function graderGroup(grader, sales) {
    const rows = (sales || []).slice().sort((a,b) => Number(b?.grade || 0) - Number(a?.grade || 0) || Number(b?.price || 0) - Number(a?.price || 0));
    return `<section class="grader-sales-group">
      <div class="grader-sales-heading"><span class="grader-big-badge g-${grader.toLowerCase()}">${grader}</span><span>${rows.length} accepted sale${rows.length === 1 ? '' : 's'}</span></div>
      ${rows.length ? rows.map(s => saleCard(s, grader)).join('') : `<div class="muted grader-empty">No accepted ${grader} sale links in this scan.</div>`}
    </section>`;
  }

  function enhanceDialog() {
    if (!lastKey) return;
    const dialog = document.querySelector('#cardDetailDialog');
    if (!dialog?.open) return;
    const card = state.cards.find(c => keyOf(c) === lastKey);
    const live = card?.live;
    if (!live) return;

    const panels = [...dialog.querySelectorAll('.detail-panel')];
    const rawPanel = panels.find(p => p.querySelector('h3')?.textContent.includes('Raw sold listings'));
    const slabPanel = panels.find(p => p.querySelector('h3')?.textContent.includes('slab sold listings'));

    if (rawPanel) {
      const rawSales = live.rawSales || [];
      rawPanel.innerHTML = `<h3>Raw sale links</h3><div class="section-help">These are the raw listings actually used for the current estimate.</div><div class="clean-sales-list">${rawSales.length ? rawSales.map(s => saleCard(s, 'RAW')).join('') : '<div class="muted">No accepted raw sold listings.</div>'}</div>`;
    }

    if (slabPanel) {
      const byGrader = live.gradedSales || {};
      slabPanel.classList.add('graded-links-panel');
      slabPanel.innerHTML = `<h3>Graded sale links by company</h3><div class="section-help">Open the exact sold listing under PSA, BGS, CGC or TAG. Grade and special label are shown on each sale.</div><div class="grader-sales-grid">${GRADERS.map(g => graderGroup(g, byGrader[g] || [])).join('')}</div>`;
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .section-help{color:var(--muted);font-size:12px;margin:-4px 0 10px}.clean-sales-list{display:grid;gap:8px}.sale-link-card{background:#0c1220;border:1px solid #2b3550;border-radius:11px;padding:10px;display:grid;gap:6px}.sale-link-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.sale-link-title{font-size:12px;line-height:1.35}.sale-link-meta{font-size:11px;color:var(--muted)}.sale-open-btn{display:inline-flex;align-items:center;justify-content:center;width:max-content;padding:6px 9px;border-radius:8px;border:1px solid #385477;background:#111d31;color:var(--cyan);font-weight:800;text-decoration:none;font-size:11px}.sale-open-btn:hover{background:#162741;text-decoration:none}.sale-no-link{font-size:11px;color:var(--muted)}.sale-type-badge,.grader-big-badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:900;letter-spacing:.04em;border:1px solid #44506a;background:#151c2d}.sale-type-badge.raw{color:#d8e1f3}.g-psa{color:#ffb0b5!important;border-color:#74343b!important;background:#2a1217!important}.g-bgs{color:#ffd28d!important;border-color:#775625!important;background:#2b210f!important}.g-cgc{color:#9cebb5!important;border-color:#2c6742!important;background:#102619!important}.g-tag{color:#9fdfff!important;border-color:#2a637c!important;background:#0d2230!important}.graded-links-panel{grid-column:1/-1}.grader-sales-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grader-sales-group{background:#0d1321;border:1px solid #29344c;border-radius:12px;padding:10px;display:grid;gap:8px}.grader-sales-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px}.grader-big-badge{font-size:12px}.grader-empty{padding:8px 2px;font-size:12px}
    @media(max-width:800px){.grader-sales-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  document.addEventListener('click', e => {
    const opener = e.target.closest?.('.open-card');
    if (!opener?.dataset?.k) return;
    lastKey = opener.dataset.k;
    setTimeout(enhanceDialog, 0);
  });

  const observer = new MutationObserver(() => {
    const dialog = document.querySelector('#cardDetailDialog');
    if (dialog?.open && lastKey) enhanceDialog();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();
