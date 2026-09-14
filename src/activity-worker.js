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

// Activity discovery should be broad enough to find a recent listing.
// Exact identity is checked after the API responds. These descriptors are
// frequently abbreviated or omitted in eBay titles, so requiring them in q
// causes false zero-result searches.
function broadActivityName(card) {
  return nameWithoutNumber(card)
    .replace(/\b(special illustration rare|illustration rare|alternate art|alt art|full art|secret rare|rainbow rare|rainbow|gold rare|gold|holographic|holo|staff)\b/gi, ' ')
    .replace(/\b(SIR|IR)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function activityQuery(card) {
  const name = broadActivityName(card);
  const number = cardNumber(card);
  // Do not add NOT-language terms here: activity discovery is intentionally
  // broad. Language/identity mismatches are rejected locally below.
  return [name, number].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function titleHasForeignLanguage(title) {
  return /\b(japanese|korean|chinese|simplified chinese|traditional chinese)\b/i.test(String(title || ''));
}

const GENERIC = new Set([
  'pokemon','card','cards','tcg','rare','promo','set','the','and','with','edition',
  'special','illustration','alternate','alt','art','full','secret','rainbow','gold',
  'holographic','holo','staff','sir','ir'
]);

function importantNameTokens(card) {
  return normalize(nameWithoutNumber(card))
    .split(' ')
    .filter(t => t.length >= 2 && !GENERIC.has(t));
}

function variantBonus(title, card) {
  const wanted = normalize(nameWithoutNumber(card));
  const got = normalize(title);
  const groups = [
    [['alternate','art'], ['alternate art','alt art']],
    [['special','illustration','rare'], ['special illustration rare','sir']],
    [['illustration','rare'], ['illustration rare','ir']],
    [['full','art'], ['full art']],
    [['rainbow'], ['rainbow']],
    [['gold'], ['gold']],
    [['holo'], ['holo','holographic']],
    [['staff'], ['staff']],
  ];
  let bonus = 0;
  for (const [needTokens, aliases] of groups) {
    const requested = needTokens.every(t => wanted.includes(t));
    if (requested) bonus += aliases.some(a => got.includes(a)) ? 10 : -4;
  }
  return bonus;
}

function matchScore(row, card) {
  const title = String(row?.title || '');
  if (!title || titleHasForeignLanguage(title)) return 0;
  if (/\b(lot|bundle|collection|repack|proxy|custom)\b/i.test(title)) return 0;

  const normTitle = normalize(title);
  const flatTitle = normTitle.replace(/\s+/g, '');
  const number = normalize(cardNumber(card)).replace(/\s+/g, '');
  let score = 0;

  if (number) {
    if (flatTitle.includes(number)) score += 55;
    else score -= 35;
  }

  const tokens = importantNameTokens(card);
  if (tokens.length) {
    const matched = tokens.filter(t => normTitle.includes(t)).length;
    score += Math.round(40 * (matched / tokens.length));
  }

  score += variantBonus(title, card);
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

async function fetchSales(env, q) {
  const url = new URL(CARD_API);
  url.searchParams.set('q', q);
  url.searchParams.set('platform', 'ebay');
  url.searchParams.set('category', 'tcg');
  url.searchParams.set('sort', 'date_desc');
  url.searchParams.set('limit', '5');

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
  return { ok: true, status: response.status, rows: Array.isArray(body?.data) ? body.data : [], rate };
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
    const q = activityQuery(card);
    if (q.length < 4) {
      results.push({ key: String(card?.key || ''), active: false, query: q, returned: 0, match: 0, latest: null });
      continue;
    }

    const response = await fetchSales(env, q);
    upstreamRequests += 1;
    rates.push(response.rate);

    if (!response.ok) {
      if (FATAL_UPSTREAM.has(response.status)) {
        return json({
          error: response.message,
          upstreamStatus: response.status,
          fatal: true,
          checked: results.length,
          upstreamRequests,
          returnedRows,
          rate: mergeRate(rates),
        }, response.status);
      }
      results.push({ key: String(card?.key || ''), active: false, query: q, returned: 0, match: 0, latest: null, error: response.message });
      continue;
    }

    returnedRows += response.rows.length;
    let bestRow = null;
    let bestMatch = 0;
    for (const row of response.rows) {
      const score = matchScore(row, card);
      if (score > bestMatch) {
        bestMatch = score;
        bestRow = row;
      }
    }

    // With an exact card number, 50+ generally means the number and name match.
    // Without a number, require a stronger title match to avoid false positives.
    const threshold = cardNumber(card) ? 50 : 65;
    const active = !!bestRow && bestMatch >= threshold;
    results.push({
      key: String(card?.key || ''),
      active,
      query: q,
      returned: response.rows.length,
      match: bestMatch,
      latest: active ? publicSale(bestRow, bestMatch) : null,
    });
  }

  return json({
    ok: true,
    checked: results.length,
    upstreamRequests,
    returnedRows,
    maxRows: cards.length * 5,
    rate: mergeRate(rates),
    results,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/activity' && request.method === 'POST') {
      return activity(request, env);
    }
    return stableWorker.fetch(request, env, ctx);
  },
};
