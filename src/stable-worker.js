import worker from './worker.js';

const CARD_API = 'https://thecardapi.com/api/v1/market/sales';

function apiKey(env) {
  return String(env?.THE_CARD_API_KEY || '').trim();
}

function missingKey(env) {
  return !apiKey(env);
}

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

function rateFrom(response) {
  const n = name => {
    const value = Number(response.headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: n('X-RateLimit-Limit'),
    remaining: n('X-RateLimit-Remaining'),
    reset: n('X-RateLimit-Reset'),
  };
}

function mergeRate(rates) {
  const valid = rates.filter(Boolean);
  const limits = valid.map(r => r.limit).filter(Number.isFinite);
  const remaining = valid.map(r => r.remaining).filter(Number.isFinite);
  const resets = valid.map(r => r.reset).filter(Number.isFinite);
  return {
    limit: limits.length ? Math.max(...limits) : null,
    remaining: remaining.length ? Math.min(...remaining) : null,
    reset: resets.length ? Math.max(...resets) : null,
  };
}

async function cardApi(env, params) {
  const url = new URL(CARD_API);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: { 'x-market-api-key': apiKey(env) },
  });
  const rate = rateFrom(response);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const raw = body?.message ?? body?.error ?? body?.detail ?? `The Card API returned HTTP ${response.status}`;
    const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return { ok: false, status: response.status, message, rate };
  }
  return { ok: true, status: response.status, rows: Array.isArray(body?.data) ? body.data : [], rate };
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

function nameOnly(card) {
  return String(card?.name || '').replace(/#\s*[A-Za-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function activityQuery(card) {
  const name = nameOnly(card);
  const number = cardNumber(card);
  return [name, number, '-Japanese', '-Korean', '-Chinese']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC = new Set(['pokemon','card','cards','tcg','rare','promo','set','the','and','with','edition','v','vmax','vstar','ex','gx']);
function activityScore(row, card) {
  const title = normalize(row?.title);
  if (!title) return 0;
  if (/\b(lot|bundle|collection|repack|proxy|custom)\b/i.test(String(row?.title || ''))) return 0;

  let score = 0;
  const number = normalize(cardNumber(card)).replace(/\s+/g, '');
  const flatTitle = title.replace(/\s+/g, '');
  if (number) score += flatTitle.includes(number) ? 55 : -30;

  const tokens = normalize(nameOnly(card)).split(' ').filter(t => t.length >= 2 && !GENERIC.has(t));
  if (tokens.length) {
    const matched = tokens.filter(t => title.includes(t)).length;
    score += Math.round(40 * (matched / tokens.length));
  }

  const setTokens = normalize(card?.set).split(' ').filter(t => t.length >= 3 && !GENERIC.has(t));
  if (setTokens.length) {
    const matched = setTokens.filter(t => title.includes(t)).length;
    score += Math.round(10 * (matched / setTokens.length));
  }
  return Math.max(0, Math.min(100, score));
}

function publicSale(row, match) {
  let url = null;
  try {
    const parsed = new URL(String(row?.listing_url || ''));
    if (parsed.protocol === 'https:') url = parsed.toString();
  } catch { /* ignore invalid listing URLs */ }
  const price = Number(row?.price ?? row?.sale_price);
  return {
    title: String(row?.title || '').slice(0, 220),
    price: Number.isFinite(price) && price > 0 ? price : null,
    date: row?.sale_date || row?.sold_at || null,
    url,
    match,
  };
}

async function health(env) {
  if (missingKey(env)) {
    return json({ source: 'The Card API', freeMode: true, ok: false, keyConfigured: false, auth: 'not_configured', message: 'THE_CARD_API_KEY is not configured in Cloudflare Runtime variables and secrets.' }, 503);
  }

  const result = await cardApi(env, {
    q: 'Pikachu', platform: 'ebay', category: 'tcg', graded: false, sort: 'date_desc', limit: 1,
  });
  if (!result.ok) {
    return json({ source: 'The Card API', freeMode: true, ok: false, keyConfigured: true, auth: 'failed', upstreamStatus: result.status, message: result.message, rate: result.rate }, result.status);
  }
  return json({ source: 'The Card API', freeMode: true, ok: true, keyConfigured: true, auth: 'passed', message: 'The Card API accepted the runtime secret.', rate: result.rate });
}

async function activity(request, env) {
  if (missingKey(env)) return json({ error: 'THE_CARD_API_KEY is not configured in Cloudflare Runtime variables and secrets.', code: 'secret_missing', fatal: true }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const cards = Array.isArray(body?.cards) ? body.cards.slice(0, 20) : [];
  if (!cards.length) return json({ error: 'No cards supplied.' }, 400);

  const results = [];
  const rates = [];
  let upstreamRequests = 0;
  let returnedRows = 0;

  for (const card of cards) {
    const q = activityQuery(card);
    if (!q || q.length < 4) {
      results.push({ key: String(card?.key || ''), active: false, match: 0, returned: 0, latest: null });
      continue;
    }

    const recent = await cardApi(env, {
      q,
      platform: 'ebay',
      category: 'tcg',
      sort: 'date_desc',
      limit: 1,
    });
    upstreamRequests += 1;
    rates.push(recent.rate);

    if (!recent.ok) {
      if ([401,403,429].includes(recent.status)) {
        return json({
          error: recent.message,
          upstreamStatus: recent.status,
          fatal: true,
          rate: mergeRate(rates),
          checked: results.length,
          upstreamRequests,
          returnedRows,
        }, recent.status);
      }
      results.push({ key: String(card?.key || ''), active: false, match: 0, returned: 0, latest: null, error: recent.message });
      continue;
    }

    returnedRows += recent.rows.length;
    let bestRow = null;
    let bestMatch = 0;
    for (const row of recent.rows) {
      const match = activityScore(row, card);
      if (match > bestMatch) { bestMatch = match; bestRow = row; }
    }
    const active = !!bestRow && bestMatch >= 35;
    results.push({
      key: String(card?.key || ''),
      active,
      match: bestMatch,
      returned: recent.rows.length,
      latest: active ? publicSale(bestRow, bestMatch) : null,
    });
  }

  return json({
    ok: true,
    checked: results.length,
    upstreamRequests,
    returnedRows,
    maxRows: cards.length,
    rate: mergeRate(rates),
    results,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({}, 204);
    const url = new URL(request.url);

    if (url.pathname === '/api/health') return health(env);
    if (url.pathname === '/api/activity' && request.method === 'POST') return activity(request, env);

    const normalizedKey = apiKey(env);
    const normalizedEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === 'THE_CARD_API_KEY') return normalizedKey;
        return Reflect.get(target, property, receiver);
      },
    });
    return worker.fetch(request, normalizedEnv, ctx);
  },
};
