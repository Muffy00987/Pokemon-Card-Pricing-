# Pokémon TCG Free Live Graded Bargain Finder

This build keeps the front end and the live-price backend free to run.

## What it uses

- **Cloudflare Workers Free** for hosting + the private backend proxy.
- **The Card API Free** for recent sold-card comps.
- The API key is stored as a **Cloudflare Worker secret**, never in the HTML/browser.
- The page starts with **363 English-focused Pokémon TCG watchlist entries** and lets you add more locally.
- Compares recent raw sold comps against **PSA, BGS/Beckett, CGC, and TAG** sales from grade 7 upward.

## Why this stays inside the free data allowance

The worker requests at most **3 raw rows + 10 graded rows per card = 13 sales rows/card**.
For the seeded 363-card list, a full uncached pass can return at most **4,719 rows**, which is below The Card API's current free allowance of 5,000 sales rows/day. Results are cached for about 20 hours, so repeat visitors do not automatically burn the quota again.

The free The Card API tier has a **3-day lookback**, so cards with low sales volume may show no recent comps. That is a data limitation, not a page error.

## Setup — free

1. Go to **https://www.thecardapi.com/** and create a free API key. Do not paste the key into the HTML.
2. Create a free Cloudflare account at **https://dash.cloudflare.com/**.
3. Install Node.js if you do not already have it, then open a terminal in this folder.
4. Run:

   ```bash
   npm install -g wrangler
   wrangler login
   wrangler secret put THE_CARD_API_KEY
   ```

   Paste your new The Card API key when Wrangler asks for it.

5. Deploy:

   ```bash
   wrangler deploy
   ```

6. Wrangler will print a `*.workers.dev` URL. Open it in Chrome.
7. Click **Test live data**. It should say the backend is working and the secret is configured.

## Important security note

Any API key that was shown in a screenshot or pasted into a public page should be revoked and replaced. This package never exposes the new key to the browser.

## How live updating works

- **↻** updates one card.
- **Update visible** refreshes the current page of 25 cards.
- **Select all** selects every card matching your current search/filter.
- **Update selected** refreshes selected cards.
- Cached values are reused for about 20 hours.
- Grade details show every recent grade 7+ comp found for PSA, BGS, CGC and TAG.

## Files

- `public/index.html` — app interface.
- `public/seed.json` — starting 363-card watchlist.
- `src/worker.js` — secure API proxy + price aggregation + cache.
- `wrangler.jsonc` — Cloudflare Worker configuration.
