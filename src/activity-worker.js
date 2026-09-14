import stableWorker from './stable-worker.js';

const CARD_API = 'https://thecardapi.com/api/v1/market/sales';
const FATAL_UPSTREAM = new Set([401, 403, 429]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

function apiKey(env) {
  return String(env?.THE_CARD_API_KEY || '').trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cardNumber(card) {
  const explicit = String(card?.number || '').trim().replace(/^#/, '');
  if (explicit) return explicit;
  return String(card?.name || '').match(/#\s*([A-Za-z0-9-]+)/)?.[1] || '';
}

function nameWithoutNumber(card) {
  return String(card?.name || '')
    .replace(/#\s*[A-Za-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function broadName(card) {
  return nameWithoutNumber(card)
    .replace(/\b(special illustration rare|illustration rare|alternate art|alt art|full art|secret rare|rainbow rare|rainbow|gold rare|gold|holographic|holo|staff|trainer gallery|gallery)\b/gi, ' ')
    .replace(/\b(SIR|IR|TG)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coreName(card) {
  return broadName(card)
    .replace(/\b(vmax|vstar|v-union|vunion|v|ex|gx)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryPlan(card) {
  const number = cardNumber(card);
  const broad = broadName(card);
  const core = coreName(card);
  const candidates = [
    number ? `${broad} ${number}` : '',
    broad,
    core,
  ].map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length >= 4);
  return [...new Set(candidates)];
}

function titleHasForeignLanguage(title) {
  return /\b(japanese|korean|chinese|simplified chinese|traditional chinese)\b/i.test(String(title || ''));
}

function titleRejected(title) {
  return titleHasForeignLanguage(title) || /\b(lot|bundle|collection|repack|proxy|custom)\b/i.test(String(title || ''));
}

function identityScore(row, card) {
  const title = String(row?.title || '');
  if (!title || titleRejected(title)) return 0;
  const normTitle = normalize(title);
  const flatTitle = normTitle.replace(/\s+/g, '');
  const number = normalize(cardNumber(card)).replace(/\s+/g, '');
  const coreTokens = normalize(coreName(card)).split(' ').filter(t => t.length >= 2);
  const broadTokens = normalize(broadName(card)).split(' ').filter(t => t.length >= 2);

  let score = 0;
  if (number) score += flatTitle.includes(number) ? 60 : -35;

  if (coreTokens.length) {
    const matched = coreTokens.filter(t => normTitle.includes(t)).length;
    score += Math.round(35 * (matched / coreTokens.length));
  }
  if (broadTokens.length) {
    const matched = broadTokens.filter(t => normTitle.includes(t)).length;
    score += Math.round(15 * (matched / broadTokens.length));
  }
  return Math.max(0, Math.min(100, score));
}

function safeListingUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

function publicSale(row, match) {
  const price = Number(row?.price ?? row?.sale_price);
  return {
    title: String(row?.title || '').slice(0, 220),
    price: Number.isFinite(price) && price > 0 ? price : null,
    date: row?.sale_date || row?.sold_at || null,
    url: safeListingUrl(row?.listing_url),
    match,
  };
}

function readRateHeaders(response) {
  const num = name => {
    const value = Number(response.headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: num('X-RateLimit-Limit'),
    remaining: num('X-RateLimit-Remaining'),
    reset: num('X-RateLimit-Reset'),
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

async function fetchSales(env, q, { limit = 5, category = true } = {}) {
  const url = new URL(CARD_API);
  url.searchParams.set('q', q);
  url.searchParams.set('platform', 'ebay');
  if (category) url.searchParams.set('category', 'tcg');
  url.searchParams.set('sort', 'date_desc');
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url, {
    headers: { 'x-market-api-key': apiKey(env) },
  });
  const rate = readRateHeaders(response);
  let body = null;
  try { body = await response.json(); } catch { body = null; }

  if (!response.ok) {
    const raw = body?.message ?? body?.error ?? body?.detail ?? `The Card API returned HTTP ${response.status}`;
    const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return { ok: false, status: response.status, message, rate, rows: [] };
  }
  return {
    ok: true,
    status: response.status,
    rows: Array.isArray(body?.data) ? body.data : [],
    total: Number.isFinite(Number(body?.pagination?.total)) ? Number(body.pagination.total) : null,
    rate,
  };
}

async function probe(env) {
  if (!apiKey(env)) return json({ error: 'Runtime secret missing.' }, 503);
  const checks = [];
  for (const spec of [
    { q: 'Charizard', category: true },
    { q: 'Pikachu', category: true },
    { q: 'Umbreon', category: true },
    { q: 'Charizard', category: false },
  ]) {
    const r = await fetchSales(env, spec.q, { limit: 3, category: spec.category });
    checks.push({
      q: spec.q,
      category: spec.category ? 'tcg' : 'none',
      ok: r.ok,
      status: r.status,
      returned: r.rows.length,
      total: r.total,
      titles: r.rows.slice(0, 3).map(x => String(x?.title || '').slice(0, 140)),
      error: r.ok ? null : r.message,
    });
    if (!r.ok && FATAL_UPSTREAM.has(r.status)) break;
  }
  return json({ ok: checks.every(x => x.ok), checks });
}

async function activity(request, env) {
  if (!apiKey(env)) return json({ error: 'THE_CARD_API_KEY is not configured in Cloudflare Runtime variables and secrets.', fatal: true }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const cards = Array.isArray(body?.cards) ? body.cards.slice(0, 20) : [];
  if (!cards.length) return json({ error: 'No cards supplied.' }, 400);

  const results = [];
  const rates = [];
  let upstreamRequests = 0;
  let returnedRows = 0;

  for (const card of cards) {
    const attempts = [];
    let bestRow = null;
    let bestMatch = 0;

    for (const q of queryPlan(card)) {
      const response = await fetchSales(env, q, { limit: 5, category: true });
      upstreamRequests += 1;
      rates.push(response.rate);
      attempts.push({ q, returned: response.rows.length, total: response.total, status: response.status });

      if (!response.ok) {
        if (FATAL_UPSTREAM.has(response.status)) {
          return json({ error: response.message, upstreamStatus: response.status, fatal: true, checked: results.length, upstreamRequests, returnedRows, rate: mergeRate(rates), results }, response.status);
        }
        continue;
      }

      returnedRows += response.rows.length;
      for (const row of response.rows) {
        const score = identityScore(row, card);
        if (score > bestMatch) {
          bestMatch = score;
          bestRow = row;
        }
      }

      const threshold = cardNumber(card) ? 55 : 30;
      if (bestRow && bestMatch >= threshold) break;
    }

    const threshold = cardNumber(card) ? 55 : 30;
    const active = !!bestRow && bestMatch >= threshold;
    results.push({
      key: String(card?.key || ''),
      active,
      returned: attempts.reduce((sum, a) => sum + a.returned, 0),
      match: bestMatch,
      attempts,
      bestTitle: bestRow ? String(bestRow.title || '').slice(0, 180) : null,
      latest: active ? publicSale(bestRow, bestMatch) : null,
    });
  }

  return json({
    ok: true,
    checked: results.length,
    upstreamRequests,
    returnedRows,
    maxRows: cards.length * 15,
    rate: mergeRate(rates),
    results,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/probe' && request.method === 'GET') return probe(env);
    if (url.pathname === '/api/activity' && request.method === 'POST') return activity(request, env);
    return stableWorker.fetch(request, env, ctx);
  },
};
