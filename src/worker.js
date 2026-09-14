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
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }),
  });
}
function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[’']/g, '').replace(/[^a-zA-Z0-9.]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}
function extractCardNumber(name, explicit = '') {
  if (String(explicit || '').trim()) return String(explicit).trim().replace(/^#/, '');
  return String(name || '').match(/#\s*([A-Za-z0-9-]+)/)?.[1] || '';
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
  const set = mode === 'precise' ? usableSetName(setName) : '';
  return [nameWithoutHashNumber(name), number, set, '-Japanese', '-Korean', '-Chinese'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function rowKey(row) {
  return String(row?.id || row?.sale_id || row?.listing_url || `${row?.title || ''}|${salePrice(row) || ''}|${row?.sale_date || row?.sold_at || ''}`);
}
function mergeUniqueRows(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) for (const row of (group || [])) {
    const key = rowKey(row);
    if (!seen.has(key)) { seen.add(key); out.push(row); }
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
function safeHttps(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}
function gradeLabel(row, grader) {
  const explicit = String(row?.label || '').trim();
  const text = `${explicit} ${row?.title || ''} ${row?.grade || ''}`.toLowerCase();
  if (/black\s*label|perfect\s*pristine/.test(text)) return 'Black Label';
  if (/\bperfect\b/.test(text)) return 'Perfect';
  if (/\bpristine\b/.test(text)) return 'Pristine';
  if (/gem\s*(mint|mt)/.test(text)) return 'Gem Mint';
  if (explicit && !/^standard$/i.test(explicit)) return explicit.slice(0, 60);
  return '';
}
function gradeTier(row, grader) {
  const grade = numericGrade(row?.grade);
  if (grade == null) return null;
  const label = gradeLabel(row, grader);
  return {
    grade,
    label,
    key: `${grade}|${label.toLowerCase()}`,
    display: `${grade}${label ? ` ${label}` : ''}`,
  };
}
const GENERIC = new Set(['pokemon','card','cards','tcg','rare','promo','set','the','and','with','edition']);
function importantTokens(text) {
  return normalizeText(text).split(' ').filter(t => t.length >= 2 && !GENERIC.has(t));
}
function numberMatches(title, number) {
  if (!number) return null;
  return normalizeText(title).replace(/\s+/g, '').includes(normalizeText(number).replace(/\s+/g, ''));
}
function scoreSale(row, identity) {
  const title = String(row?.title || '');
  const norm = normalizeText(title);
  if (!norm) return 0;
  let score = 0;
  const nm = numberMatches(title, identity.number);
  if (nm === true) score += 42;
  else if (nm === false) score -= 28;
  const nameTokens = importantTokens(nameWithoutHashNumber(identity.name));
  if (nameTokens.length) score += 35 * (nameTokens.filter(t => norm.includes(t)).length / nameTokens.length);
  const setTokens = importantTokens(usableSetName(identity.set));
  if (setTokens.length) score += 13 * (setTokens.filter(t => norm.includes(t)).length / setTokens.length);
  else score += 4;
  const variantGroups = [
    ['alternate art', ['alternate art','alt art']], ['special illustration rare', ['special illustration rare','sir']],
    ['illustration rare', ['illustration rare']], ['rainbow', ['rainbow']], ['gold', ['gold']],
    ['holo', ['holo','holographic']], ['staff', ['staff']], ['full art', ['full art']],
  ];
  const nameNorm = normalizeText(identity.name);
  for (const [, aliases] of variantGroups) {
    if (aliases.some(a => nameNorm.includes(normalizeText(a)))) score += aliases.some(a => norm.includes(normalizeText(a))) ? 8 : -3;
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
  const grader = normalizeGrader(row?.grader || row?.grading_company);
  const tier = grader ? gradeTier(row, grader) : null;
  return {
    title: String(row?.title || '').slice(0, 220),
    price: salePrice(row),
    date: row?.sale_date || row?.sold_at || null,
    url: safeHttps(row?.listing_url),
    image: safeHttps(row?.image_url),
    thumbnail: safeHttps(row?.thumbnail_url || row?.image_url),
    grader,
    grade: tier ? String(tier.grade) : (row?.grade == null ? null : String(row.grade)),
    label: tier?.label || String(row?.label || '').trim() || null,
    displayGrade: tier?.display || null,
    condition: row?.condition || null,
    conditionClass: condition,
    match,
  };
}
function readRateHeaders(response) {
  const n = name => { const v = Number(response.headers.get(name)); return Number.isFinite(v) ? v : null; };
  return { limit: n('X-RateLimit-Limit'), remaining: n('X-RateLimit-Remaining'), reset: n('X-RateLimit-Reset') };
}
function mergeRate(rates) {
  const valid = rates.filter(Boolean);
  const take = (k, fn) => { const a = valid.map(r => r[k]).filter(Number.isFinite); return a.length ? fn(...a) : null; };
  return { limit: take('limit', Math.max), remaining: take('remaining', Math.min), reset: take('reset', Math.max) };
}
async function fetchSales(env, params) {
  const u = new URL(CARD_API);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const response = await fetch(u, { headers: { 'x-market-api-key': String(env?.THE_CARD_API_KEY || '').trim() } });
  const rate = readRateHeaders(response);
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const raw = body?.message ?? body?.error ?? body?.detail ?? `The Card API returned HTTP ${response.status}`;
    const err = new Error(typeof raw === 'string' ? raw : JSON.stringify(raw));
    err.status = response.status; err.rate = rate; err.upstream = true; throw err;
  }
  return { rows: Array.isArray(body?.data) ? body.data : [], rate };
}
function filterRawRows(rows, identity) {
  return rows.map(row => ({ row, match: scoreSale(row, identity), condition: rawCondition(row) }))
    .filter(x => x.match >= 42 && x.condition !== 'lower' && Number.isFinite(salePrice(x.row)));
}
function filterGradedRows(rows, identity, expectedGrader) {
  return rows.map(row => ({ row, match: scoreSale(row, identity) })).filter(x => {
    const grader = normalizeGrader(x.row?.grader || x.row?.grading_company);
    const grade = numericGrade(x.row?.grade);
    return x.match >= 42 && grader === expectedGrader && grade != null && grade >= 7 && Number.isFinite(salePrice(x.row));
  });
}
function tierRank(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('black')) return 5;
  if (s.includes('perfect')) return 4;
  if (s.includes('pristine')) return 3;
  if (s.includes('gem')) return 2;
  return 1;
}
function summarize(identity, rawRows, graderRows) {
  const rawAccepted = filterRawRows(rawRows, identity);
  const rawPrices = rawAccepted.map(x => salePrice(x.row));
  const raw = rawPrices.length ? {
    median: median(rawPrices), count: rawPrices.length,
    nearMintConfirmed: rawAccepted.filter(x => x.condition === 'near_mint').length,
    conditionUnknown: rawAccepted.filter(x => x.condition === 'unknown').length,
  } : null;
  const graders = {};
  let best = null;
  let bestAcceptedRows = [];
  let image = rawAccepted.map(x => safeHttps(x.row?.thumbnail_url || x.row?.image_url)).find(Boolean) || null;
  for (const grader of GRADERS) {
    const accepted = filterGradedRows(graderRows[grader] || [], identity, grader);
    const buckets = new Map();
    for (const item of accepted) {
      const tier = gradeTier(item.row, grader);
      if (!tier) continue;
      if (!buckets.has(tier.key)) buckets.set(tier.key, { tier, items: [] });
      buckets.get(tier.key).items.push(item);
      if (!image) image = safeHttps(item.row?.thumbnail_url || item.row?.image_url);
    }
    graders[grader] = {};
    for (const { tier, items } of buckets.values()) {
      const med = median(items.map(x => salePrice(x.row)));
      const avgMatch = Math.round(items.reduce((s, x) => s + x.match, 0) / items.length);
      graders[grader][tier.key] = {
        grade: tier.grade, label: tier.label || null, displayGrade: tier.display,
        median: med, count: items.length, avgMatch,
      };
      if (raw?.median && Number.isFinite(med)) {
        const saving = (raw.median - med) / raw.median;
        if (!best || saving > best.saving || (saving === best.saving && (tier.grade > best.grade || tierRank(tier.label) > tierRank(best.label)))) {
          best = { grader, grade: tier.grade, label: tier.label || null, displayGrade: tier.display, price: med, saving, count: items.length, avgMatch };
          bestAcceptedRows = items;
        }
      }
    }
  }
  const rawAvgMatch = rawAccepted.length ? Math.round(rawAccepted.reduce((s, x) => s + x.match, 0) / rawAccepted.length) : 0;
  let confidence = { level: 'none', score: 0, reasons: ['No comparable raw and graded sales were found in the available window.'] };
  if (raw && best) {
    let score = Math.min(25, raw.count * 6) + Math.min(25, best.count * 8) + Math.min(30, Math.round(((rawAvgMatch + best.avgMatch) / 2) * .30));
    const reasons = [];
    if (raw.nearMintConfirmed > 0) { score += 15; reasons.push(`${raw.nearMintConfirmed} raw comp${raw.nearMintConfirmed === 1 ? '' : 's'} explicitly looked Near Mint/Mint.`); }
    else reasons.push('Raw condition was not explicitly confirmed; treat the raw median cautiously.');
    if (identity.number) { score += 5; reasons.push(`Card number ${identity.number} was used for identity matching.`); }
    else reasons.push('No card number is stored for this card, which lowers identity confidence.');
    if (raw.count < 3 || best.count < 2) reasons.push('The recent sample is thin.');
    if (rawAvgMatch < 60 || best.avgMatch < 60) reasons.push('Some listing titles are only moderate identity matches.');
    score = Math.min(100, score);
    confidence = { level: score >= 78 ? 'high' : score >= 55 ? 'medium' : 'low', score, reasons };
  }
  return {
    raw, graders, best, image, confidence,
    rawSales: rawAccepted.slice(0, 8).map(x => publicSale(x.row, x.match, x.condition)),
    bestGradedSales: bestAcceptedRows.slice(0, 8).map(x => publicSale(x.row, x.match)),
    saleCounts: {
      rawReturned: rawRows.length, rawAccepted: rawAccepted.length,
      gradedReturned: Object.fromEntries(GRADERS.map(g => [g, (graderRows[g] || []).length])),
      gradedAccepted: Object.fromEntries(GRADERS.map(g => [g, Object.values(graders[g]).reduce((s, v) => s + v.count, 0)])),
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (url.pathname !== '/api/card') return env.ASSETS.fetch(request);
    if (!env.THE_CARD_API_KEY) return json({ error: 'THE_CARD_API_KEY is not configured.', fatal: true }, 503);
    const name = (url.searchParams.get('name') || '').trim();
    const setName = (url.searchParams.get('set') || '').trim();
    const number = extractCardNumber(name, url.searchParams.get('number') || '');
    if (!name) return json({ error: 'Missing card name.', fatal: false }, 400);
    const rawLimit = clampInt(url.searchParams.get('rawLimit'), 12, 3, 25);
    const graderLimit = clampInt(url.searchParams.get('graderLimit'), 10, 3, 20);
    const identity = { name, set: setName, number };
    const preciseQ = buildQuery(name, setName, number, 'precise');
    const fallbackQ = buildQuery(name, setName, number, 'fallback');
    try {
      const rates = [], attempts = { raw: [], graders: {} };
      const rawFirst = await fetchSales(env, { q: preciseQ, platform: 'ebay', graded: false, sort: 'date_desc', limit: rawLimit });
      rates.push(rawFirst.rate);
      let rawRows = rawFirst.rows;
      attempts.raw.push({ mode: 'precise', query: preciseQ, returned: rawFirst.rows.length });
      if (filterRawRows(rawRows, identity).length < 2 && fallbackQ !== preciseQ) {
        const fallback = await fetchSales(env, { q: fallbackQ, platform: 'ebay', graded: false, sort: 'date_desc', limit: rawLimit });
        rates.push(fallback.rate); attempts.raw.push({ mode: 'fallback', query: fallbackQ, returned: fallback.rows.length });
        rawRows = mergeUniqueRows(rawRows, fallback.rows);
      }
      const graderRows = {};
      for (const grader of GRADERS) {
        attempts.graders[grader] = [];
        const first = await fetchSales(env, { q: preciseQ, platform: 'ebay', graded: true, grader, sort: 'date_desc', limit: graderLimit });
        rates.push(first.rate); let rows = first.rows;
        attempts.graders[grader].push({ mode: 'precise', query: preciseQ, returned: first.rows.length });
        if (filterGradedRows(rows, identity, grader).length < 1 && fallbackQ !== preciseQ) {
          const fallback = await fetchSales(env, { q: fallbackQ, platform: 'ebay', graded: true, grader, sort: 'date_desc', limit: graderLimit });
          rates.push(fallback.rate); attempts.graders[grader].push({ mode: 'fallback', query: fallbackQ, returned: fallback.rows.length });
          rows = mergeUniqueRows(rows, fallback.rows);
        }
        graderRows[grader] = rows;
      }
      return json({
        ok: true, card: identity, query: preciseQ, queries: { precise: preciseQ, fallback: fallbackQ }, attempts,
        updatedAt: new Date().toISOString(), source: 'The Card API', lookback: 'Free tier: maximum 3-day rolling window',
        limits: { rawLimit, graderLimit, estimatedMaximumRows: (rawLimit + graderLimit * GRADERS.length) * 2 },
        rate: mergeRate(rates), ...summarize(identity, rawRows, graderRows),
      });
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      return json({ error: e.message || 'Upstream API error', upstreamStatus: e.status || null, fatal: FATAL_UPSTREAM.has(e.status), rate: e.rate || null, query: preciseQ }, status);
    }
  },
};
