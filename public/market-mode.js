(() => {
  function applyMarketMode() {
    // The free source only exposes a 3-day sales window. We therefore present the
    // accepted medians as a current market estimate, while keeping the underlying
    // recent transactions visible as evidence. Nothing is persisted beyond session data.
    const subtitle = document.querySelector('.sub');
    if (subtitle) subtitle.textContent = 'Free current-market estimator for English Pokémon TCG cards. Market estimates are calculated from accepted recent sold comps, with the actual sales kept underneath as evidence. Compare raw value with PSA, BGS/Beckett, CGC and TAG grades 7+, including half grades and special labels when the source identifies them.';

    const headers = [...document.querySelectorAll('thead th')];
    for (const th of headers) {
      const t = th.textContent.trim();
      if (t === 'Raw recent') th.textContent = 'Raw market est.';
      if (t === 'Best deal') th.textContent = 'Best market deal';
    }

    const pricedLabel = document.querySelector('#priced')?.parentElement?.querySelector('span');
    if (pricedLabel) pricedLabel.textContent = 'with market estimates';

    const budgetNote = document.querySelector('.budget .tiny.muted');
    if (budgetNote && !budgetNote.dataset.marketMode) {
      budgetNote.dataset.marketMode = '1';
      budgetNote.textContent += ' Market estimates use the median of accepted matching sales; thin samples remain visibly flagged instead of being presented as a reliable guide price.';
    }

    const foot = document.querySelector('.foot');
    if (foot) foot.innerHTML = '<b>How “market estimate” works:</b> the free data source exposes a maximum 3-day rolling sales window, so the estimate is the median of accepted matching transactions available in that window—not a hidden 30/90-day price guide. Recent sold listings remain visible in each card’s details so you can verify the estimate. Thin or missing samples are shown as such rather than filled with invented values. Live API responses remain session-only.';

    // Keep wording in the large card dialog aligned with the market-estimate model.
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector('#cardDetailDialog');
      if (!dialog) return;
      dialog.querySelectorAll('.detail-summary-grid span').forEach(span => {
        if (span.textContent.trim() === 'Raw median') span.textContent = 'Raw market estimate';
      });
      dialog.querySelectorAll('.detail-panel h3').forEach(h => {
        if (h.textContent.trim() === 'Raw sold listings used') h.textContent = 'Recent raw sales supporting estimate';
        if (h.textContent.trim() === 'Best slab sold listings used') h.textContent = 'Recent slab sales supporting estimate';
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyMarketMode, { once: true });
  else applyMarketMode();
})();
