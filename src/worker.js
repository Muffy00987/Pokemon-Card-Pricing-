const CARD_API = 'https://thecardapi.com/api/v1/market/sales';
const CACHE_TTL = 60 * 60 * 20; // 20 hours

function cors(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    ...headers,
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'content-type': 'application/json; charset=utf-8', ...headers }),
  });
}

function cleanQuery(name, setName) {
  let n = String(name || '')
    .replace(/\bAlternate Art\b/gi, '')
    .replace(/\bSpecial Illustration Rare\b/gi, '')
    .replace(/\bIllustration Rare\b/gi, '')
    .replace(/\bRainbow Rare\b/gi, '')
    .replace(/\bSecret Rare\b/gi, '')
    .replace(/\bFull Art\b/gi, '')
    .replace(/\bCharacter Rare\b/gi, '')
    .replace(/\bHolo\b/gi, '')
    .replace(/\bGold\b/gi, '')
    .replace(/\bchase candidate\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let s = String(setName || '').trim();
  const generic = /era$|\/|English Black Star|Gold Star cards|Diamond & Pearl|HGSS|Call of Legends|Sun & Moon era|Sword & Shield era|Scarlet & Violet era/i;
  if (generic.test(s)) s = '';

  // Exclude common non-English-language wording while keeping English listings that simply omit a language word.
  return `${n}${s ? ' ' + s : ''} -Japanese -Korean -Chinese`.replace(/\s+/g, ' ').trim();
}

function median(values) {
  const a = values.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

function normalizeGrader(g) {
  const s = String(g || '').toUpperCase().replace(/[^A-Z]/g,'');
  if (s === 'PSA') return 'PSA';
  if (s === 'BGS' || s.includes('BECKETT')) return 'BGS';
  if (s === 'CGC') return 'CGC';
  if (s === 'TAG') return 'TAG';
  return null;
}

function numericGrade(value) {
  const m = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function salePrice(row) {
  const v = Number(row?.sale_price ?? row?.price);
  return Number.isFinite(v) ? v : null;
}

async function fetchSales(env, q, graded, limit) {
  const u = new URL(CARD_API);
  u.searchParams.set('q', q);
  u.searchParams.set('platform', 'ebay');
  u.searchParams.set('category', 'tcg');
  u.searchParams.set('graded', String(graded));
  u.searchParams.set('sort', 'date_desc');
  u.searchParams.set('limit', String(limit));
  const r = await fetch(u.toString(), {
    headers: { 'x-market-api-key': env.THE_CARD_API_KEY }
  });
  let body;
  try { body = await r.json(); } catch { body = null; }
  if (!r.ok) {
    const msg = body?.message || body?.error || `The Card API returned HTTP ${r.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = r.status;
    throw err;
  }
  return Array.isArray(body?.data) ? body.data : [];
}

function summarize(rawRows, gradedRows) {
  const rawPrices = rawRows.map(salePrice).filter(Number.isFinite);
  const raw = median(rawPrices);
  const graders = { PSA:{}, BGS:{}, CGC:{}, TAG:{} };
  for (const row of gradedRows) {
    const g = normalizeGrader(row.grader || row.grading_company);
    const grade = numericGrade(row.grade);
    const price = salePrice(row);
    if (!g || grade == null || grade < 7 || !Number.isFinite(price)) continue;
    const key = String(grade);
    (graders[g][key] ||= []).push(price);
  }
  const out = {};
  let best = null;
  for (const [grader, buckets] of Object.entries(graders)) {
    out[grader] = {};
    for (const [grade, prices] of Object.entries(buckets)) {
      const med = median(prices);
      out[grader][grade] = { median: med, count: prices.length };
      if (raw && med != null) {
        const saving = (raw - med) / raw;
        if (!best || saving > best.saving) best = { grader, grade, price: med, saving };
      }
    }
  }
  return {
    raw: raw == null ? null : { median: raw, count: rawPrices.length },
    graders: out,
    best,
    rawSales: rawRows.slice(0,3).map(r=>({ price:salePrice(r), date:r.sale_date || r.sold_at || null, url:r.listing_url || null })),
    gradedSalesCount: gradedRows.length,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    if (url.pathname === '/api/health') {
      return json({ ok: true, source: 'The Card API', freeMode: true, keyConfigured: !!env.THE_CARD_API_KEY });
    }

    if (url.pathname === '/api/card') {
      if (!env.THE_CARD_API_KEY) return json({ error: 'THE_CARD_API_KEY is not configured in the Worker secret.' }, 500);
      const name = (url.searchParams.get('name') || '').trim();
      const setName = (url.searchParams.get('set') || '').trim();
      const force = url.searchParams.get('force') === '1';
      if (!name) return json({ error: 'Missing card name.' }, 400);

      const q = cleanQuery(name, setName);
      const cacheKey = new Request(`${url.origin}/__cache/card?name=${encodeURIComponent(name)}&set=${encodeURIComponent(setName)}`);
      const cache = caches.default;
      if (!force) {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      }

      try {
        // Free plan strategy: 3 raw + 10 graded rows per card = max 13 sales/card.
        // 363 cards × 13 = 4,719 rows/day, under the 5,000 sales/day free allowance.
        const [rawRows, gradedRows] = await Promise.all([
          fetchSales(env, q, false, 3),
          fetchSales(env, q, true, 10),
        ]);
        const summary = summarize(rawRows, gradedRows);
        const payload = {
          ok: true,
          card: { name, set: setName },
          query: q,
          updatedAt: new Date().toISOString(),
          lookback: 'The Card API free tier: recent 3-day window',
          ...summary,
        };
        const response = json(payload, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL}` });
        await cache.put(cacheKey, response.clone());
        return response;
      } catch (e) {
        return json({ error: e.message || 'Upstream API error', status: e.status || 500, query: q }, e.status && e.status >=400 && e.status <600 ? e.status : 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
