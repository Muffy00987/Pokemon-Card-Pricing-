const CARD_API = 'https://thecardapi.com/api/v1/market/sales';
const GRADERS = ['PSA', 'BGS', 'CGC', 'TAG'];
const FATAL_UPSTREAM = new Set([401, 403, 429]);

function cors(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    }),
  });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCardNumber(name, explicit = '') {
  if (String(explicit || '').trim()) return String(explicit).trim().replace(/^#/, '');
  const hash = String(name || '').match(/#\s*([A-Za-z0-9-]+)/);
  if (hash) return hash[1];
  return '';
}

function nameWithoutHashNumber(name) {
  return String(name || '').replace(/#\s*[A-Za-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function usableSetName(setName) {
  const s = String(setName || '').trim();
  if (!s) return '';
  const generic = /era$|^pokemon promo$|english black star|gold star cards|diamond\s*&\s*pearl|^hgss$|call of legends|sun\s*&\s*moon era|sword\s*&\s*shield era|scarlet\s*&\s*violet era/i;
  return generic.test(s) ? '' : s;
}

function buildQuery(name, setName, explicitNumber = '', mode = 'precise') {
  const number = extractCardNumber(name, explicitNumber);
  const cardName = nameWithoutHashNumber(name);
  const set = mode === 'precise' ? usableSetName(setName) : '';
  // Preserve variant words (Alternate Art, Gold, Holo, SIR, Staff, etc.). They are identity data.
  // Fallback deliberately drops only the set name; identity filtering still runs afterward.
  return [cardName, number, set, '-Japanese', '-Korean', '-Chinese']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowKey(row) {
  return String(row?.id || row?.sale_id || row?.listing_url || `${row?.title || ''}|${salePrice(row) || ''}|${row?.sale_date || row?.sold_at || ''}`);
}

function mergeUniqueRows(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) for (const row of (group || [])) {
    const k = rowKey(row);
    if (!seen.has(k)) { seen.add(k); out.push(row); }
  }
  return out;
}

function median(values) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function salePrice(row) {
  const v = Number(row?.price ?? row?.sale_price);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function normalizeGrader(value) {
  const s = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
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

function safeListingUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

const GENERIC = new Set(['pokemon','card','cards','tcg','rare','promo','set','the','and','with','edition']);
function importantTokens(text) {
  return normalizeText(text).split(' ').filter(t => t.length >= 2 && !GENERIC.has(t));
}

function numberMatches(title, number) {
  if (!number) return null;
  const want = normalizeText(number).replace(/\s+/g, '');
  const flat = normalizeText(title).replace(/\s+/g, '');
  return flat.includes(want);
}

function scoreSale(row, identity) {
  const title = String(row?.title || '');
  const norm = normalizeText(title);
  if (!norm) return 0;
  let score = 0;
  const number = identity.number;
  const nm = numberMatches(title, number);
  if (nm === true) score += 42;
  else if (nm === false) score -= 28;

  const nameTokens = importantTokens(nameWithoutHashNumber(identity.name));
  const matchedName = nameTokens.filter(t => norm.includes(t)).length;
  if (nameTokens.length) score += 35 * (matchedName / nameTokens.length);

  const setTokens = importantTokens(usableSetName(identity.set));
  if (setTokens.length) {
    const matchedSet = setTokens.filter(t => norm.includes(t)).length;
    score += 13 * (matchedSet / setTokens.length);
  } else score += 4;

  const variantGroups = [
    ['alternate art', ['alternate art','alt art']],
    ['special illustration rare', ['special illustration rare','sir']],
    ['illustration rare', ['illustration rare']],
    ['rainbow', ['rainbow']],
    ['gold', ['gold']],
    ['holo', ['holo','holographic']],
    ['staff', ['staff']],
    ['full art', ['full art']],
  ];
  const nameNorm = normalizeText(identity.name);
  for (const [, aliases] of variantGroups) {
    const requested = aliases.some(a => nameNorm.includes(normalizeText(a)));
    if (requested) score += aliases.some(a => norm.includes(normalizeText(a))) ? 8 : -3;
  }

  if (/\b(lot|bundle|collection|repack|proxy|custom)\b/i.test(title)) score -= 35;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function rawCondition(row) {
  const text = `${row?.condition || ''} ${row?.title || ''}`.toLowerCase();
  if (/\b(damaged|damage|dmg|heavily played|heavy played|hp|moderately played|mp|lightly played|lp)\b/.test(text)) return 'lower';
  if (/\b(near mint|nm\+?|mint)\b/.test(text)) return 'near_mint';
  return 'unknown';
}

function publicSale(row, match, condition = null) {
  return {
    title: String(row?.title || '').slice(0, 220),
    price: salePrice(row),
    date: row?.sale_date || row?.sold_at || null,
    url: safeListingUrl(row?.listing_url),
    grader: normalizeGrader(row?.grader || row?.grading_company),
    grade: row?.grade == null ? null : String(row.grade),
    condition: row?.condition || null,
    conditionClass: condition,
    match,
  };
}

function readRateHeaders(response) {
  const limit = Number(response.headers.get('X-RateLimit-Limit'));
  const remaining = Number(response.headers.get('X-RateLimit-Remaining'));
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    reset: Number.isFinite(reset) ? reset : null,
  };
}

function mergeRate(rates) {
  const valid = rates.filter(Boolean);
  const limits = valid.map(r => r.limit).filter(Number.isFinite);
  const remain = valid.map(r => r.remaining).filter(Number.isFinite);
  const resets = valid.map(r => r.reset).filter(Number.isFinite);
  return {
    limit: limits.length ? Math.max(...limits) : null,
    remaining: remain.length ? Math.min(...remain) : null,
    reset: resets.length ? Math.max(...resets) : null,
  };
}

async function fetchSales(env, params) {
  const u = new URL(CARD_API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const response = await fetch(u.toString(), {
    headers: { 'x-market-api-key': env.THE_CARD_API_KEY },
  });
  const rate = readRateHeaders(response);
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const rawMessage = body?.message ?? body?.error ?? body?.detail ?? `The Card API returned HTTP ${response.status}`;
    const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
    const err = new Error(message);
    err.status = response.status;
    err.rate = rate;
    err.upstream = true;
    throw err;
  }
  return { rows: Array.isArray(body?.data) ? body.data : [], rate };
}

function filterRawRows(rows, identity) {
  return rows.map(row => {
    const match = scoreSale(row, identity);
    const condition = rawCondition(row);
    return { row, match, condition };
  }).filter(x => x.match >= 42 && x.condition !== 'lower' && Number.isFinite(salePrice(x.row)));
}

function filterGradedRows(rows, identity, expectedGrader) {
  return rows.map(row => ({ row, match: scoreSale(row, identity) }))
    .filter(x => {
      const g = normalizeGrader(x.row?.grader || x.row?.grading_company);
      const grade = numericGrade(x.row?.grade);
      return x.match >= 42 && g === expectedGrader && grade != null && grade >= 7 && Number.isFinite(salePrice(x.row));
    });
}

function summarize(identity, rawRows, graderRows) {
  const rawAccepted = filterRawRows(rawRows, identity);
  const rawPrices = rawAccepted.map(x => salePrice(x.row));
  const nmConfirmed = rawAccepted.filter(x => x.condition === 'near_mint').length;
  const raw = rawPrices.length ? {
    median: median(rawPrices),
    count: rawPrices.length,
    nearMintConfirmed: nmConfirmed,
    conditionUnknown: rawAccepted.filter(x => x.condition === 'unknown').length,
  } : null;

  const graders = {};
  let best = null;
  let bestAcceptedRows = [];
  for (const grader of GRADERS) {
    const accepted = filterGradedRows(graderRows[grader] || [], identity, grader);
    const buckets = {};
    for (const item of accepted) {
      const grade = String(numericGrade(item.row.grade));
      (buckets[grade] ||= []).push(item);
    }
    graders[grader] = {};
    for (const [grade, items] of Object.entries(buckets)) {
      const med = median(items.map(x => salePrice(x.row)));
      const avgMatch = Math.round(items.reduce((s, x) => s + x.match, 0) / items.length);
      graders[grader][grade] = { median: med, count: items.length, avgMatch };
      if (raw?.median && Number.isFinite(med)) {
        const saving = (raw.median - med) / raw.median;
        if (!best || saving > best.saving) {
          best = { grader, grade, price: med, saving, count: items.length, avgMatch };
          bestAcceptedRows = items;
        }
      }
    }
  }

  const rawAvgMatch = rawAccepted.length ? Math.round(rawAccepted.reduce((s, x) => s + x.match, 0) / rawAccepted.length) : 0;
  let confidence = { level: 'none', score: 0, reasons: ['No comparable raw and graded sales were found in the available window.'] };
  if (raw && best) {
    let score = 0;
    const reasons = [];
    score += Math.min(25, raw.count * 6);
    score += Math.min(25, best.count * 8);
    score += Math.min(30, Math.round(((rawAvgMatch + best.avgMatch) / 2) * 0.30));
    if (nmConfirmed > 0) { score += 15; reasons.push(`${nmConfirmed} raw comp${nmConfirmed === 1 ? '' : 's'} explicitly looked Near Mint/Mint.`); }
    else reasons.push('Raw condition was not explicitly confirmed; treat the raw median cautiously.');
    if (identity.number) { score += 5; reasons.push(`Card number ${identity.number} was used for identity matching.`); }
    else reasons.push('No card number is stored for this card, which lowers identity confidence.');
    if (raw.count < 3 || best.count < 2) reasons.push('The recent sample is thin.');
    if (rawAvgMatch < 60 || best.avgMatch < 60) reasons.push('Some listing titles are only moderate identity matches.');
    score = Math.min(100, score);
    const level = score >= 78 ? 'high' : score >= 55 ? 'medium' : 'low';
    confidence = { level, score, reasons };
  }

  return {
    raw,
    graders,
    best,
    confidence,
    rawSales: rawAccepted.slice(0, 8).map(x => publicSale(x.row, x.match, x.condition)),
    bestGradedSales: bestAcceptedRows.slice(0, 8).map(x => publicSale(x.row, x.match)),
    saleCounts: {
      rawReturned: rawRows.length,
      rawAccepted: rawAccepted.length,
      gradedReturned: Object.fromEntries(GRADERS.map(g => [g, (graderRows[g] || []).length])),
      gradedAccepted: Object.fromEntries(GRADERS.map(g => [g, Object.values(graders[g]).reduce((s, v) => s + v.count, 0)])),
    },
  };
}

async function deepHealth(env) {
  if (!env.THE_CARD_API_KEY) return { ok: false, keyConfigured: false, auth: 'not_configured', message: 'THE_CARD_API_KEY is not configured in Runtime variables and secrets.' };
  try {
    const result = await fetchSales(env, { q: 'Pikachu', platform: 'ebay', graded: false, sort: 'date_desc', limit: 1 });
    return { ok: true, keyConfigured: true, auth: 'passed', message: 'The Card API accepted the runtime secret.', rate: result.rate };
  } catch (e) {
    return { ok: false, keyConfigured: true, auth: 'failed', upstreamStatus: e.status || null, message: e.message || 'The Card API authentication test failed.', rate: e.rate || null };
  }
}

export { buildQuery, scoreSale, rawCondition, summarize, extractCardNumber, deepHealth };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    if (url.pathname === '/api/health') {
      const result = await deepHealth(env);
      const status = result.auth === 'failed' && result.upstreamStatus ? result.upstreamStatus : (result.keyConfigured ? 200 : 503);
      return json({ source: 'The Card API', freeMode: true, ...result }, status);
    }

    if (url.pathname === '/api/activity' && request.method === 'POST') {
      if (!env.THE_CARD_API_KEY) return json({ error: 'THE_CARD_API_KEY is not configured in Runtime variables and secrets.', fatal: true }, 503);
      let body = null;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
      const cards = Array.isArray(body?.cards) ? body.cards.slice(0, 20) : [];
      if (!cards.length) return json({ error: 'No cards supplied.' }, 400);
      try {
        const tasks = cards.map(async card => {
          const identity = {
            name: String(card?.name || '').trim(),
            set: String(card?.set || '').trim(),
            number: extractCardNumber(card?.name || '', card?.number || ''),
          };
          if (!identity.name) return null;
          const q = buildQuery(identity.name, identity.set, identity.number, 'fallback');
          const r = await fetchSales(env, { q, platform: 'ebay', sort: 'date_desc', limit: 1 });
          const first = r.rows[0] || null;
          const match = first ? scoreSale(first, identity) : 0;
          return {
            result: { key: String(card?.key || ''), active: !!first && match >= 35, returned: r.rows.length, match, latest: first ? publicSale(first, match) : null },
            rate: r.rate,
          };
        });
        const settled = (await Promise.all(tasks)).filter(Boolean);
        const results = settled.map(x => x.result);
        return json({ ok: true, checked: results.length, maxRows: results.length, rate: mergeRate(settled.map(x => x.rate)), results });
      } catch (e) {
        const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
        return json({ error: e.message || 'Upstream API error', upstreamStatus: e.status || null, fatal: FATAL_UPSTREAM.has(e.status), rate: e.rate || null }, status);
      }
    }

    if (url.pathname === '/api/card') {
      if (!env.THE_CARD_API_KEY) return json({ error: 'THE_CARD_API_KEY is not configured in Runtime variables and secrets.', code: 'secret_missing', fatal: true }, 503);
      const name = (url.searchParams.get('name') || '').trim();
      const setName = (url.searchParams.get('set') || '').trim();
      const number = extractCardNumber(name, url.searchParams.get('number') || '');
      if (!name) return json({ error: 'Missing card name.', code: 'missing_name', fatal: false }, 400);

      const rawLimit = clampInt(url.searchParams.get('rawLimit'), 12, 3, 25);
      const graderLimit = clampInt(url.searchParams.get('graderLimit'), 10, 3, 20);
      const identity = { name, set: setName, number };
      const preciseQ = buildQuery(name, setName, number, 'precise');
      const fallbackQ = buildQuery(name, setName, number, 'fallback');

      try {
        const rates = [];
        const attempts = { raw: [], graders: {} };

        const rawFirst = await fetchSales(env, { q: preciseQ, platform: 'ebay', graded: false, sort: 'date_desc', limit: rawLimit });
        rates.push(rawFirst.rate);
        let rawRows = rawFirst.rows;
        attempts.raw.push({ mode: 'precise', query: preciseQ, returned: rawFirst.rows.length });
        let rawAcceptedNow = filterRawRows(rawRows, identity).length;
        if (rawAcceptedNow < 2 && fallbackQ !== preciseQ) {
          const rawFallback = await fetchSales(env, { q: fallbackQ, platform: 'ebay', graded: false, sort: 'date_desc', limit: rawLimit });
          rates.push(rawFallback.rate);
          attempts.raw.push({ mode: 'fallback', query: fallbackQ, returned: rawFallback.rows.length });
          rawRows = mergeUniqueRows(rawRows, rawFallback.rows);
        }

        const graderRows = {};
        for (const grader of GRADERS) {
          attempts.graders[grader] = [];
          const first = await fetchSales(env, { q: preciseQ, platform: 'ebay', graded: true, grader, sort: 'date_desc', limit: graderLimit });
          rates.push(first.rate);
          let rows = first.rows;
          attempts.graders[grader].push({ mode: 'precise', query: preciseQ, returned: first.rows.length });
          const acceptedNow = filterGradedRows(rows, identity, grader).length;
          if (acceptedNow < 1 && fallbackQ !== preciseQ) {
            const fallback = await fetchSales(env, { q: fallbackQ, platform: 'ebay', graded: true, grader, sort: 'date_desc', limit: graderLimit });
            rates.push(fallback.rate);
            attempts.graders[grader].push({ mode: 'fallback', query: fallbackQ, returned: fallback.rows.length });
            rows = mergeUniqueRows(rows, fallback.rows);
          }
          graderRows[grader] = rows;
        }

        const summary = summarize(identity, rawRows, graderRows);
        const rate = mergeRate(rates);
        const maxAttempts = 2;
        return json({
          ok: true,
          card: identity,
          query: preciseQ,
          queries: { precise: preciseQ, fallback: fallbackQ },
          attempts,
          updatedAt: new Date().toISOString(),
          source: 'The Card API',
          lookback: 'Free tier: maximum 3-day rolling window',
          limits: { rawLimit, graderLimit, estimatedMaximumRows: (rawLimit + graderLimit * GRADERS.length) * maxAttempts },
          rate,
          ...summary,
        });
      } catch (e) {
        const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
        return json({
          error: e.message || 'Upstream API error',
          code: e.upstream ? 'upstream_error' : 'worker_error',
          upstreamStatus: e.status || null,
          fatal: FATAL_UPSTREAM.has(e.status),
          rate: e.rate || null,
          query: preciseQ,
        }, status);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
