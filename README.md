# Pokémon TCG Graded Bargain Finder — audited rebuild

A Cloudflare Worker + static web app that compares recent raw Pokémon TCG sold listings with recent PSA, BGS/Beckett, CGC and TAG grade 7+ sold listings using The Card API.

## What changed in this rebuild

- **Real authentication diagnostic.** `Test API + backend` makes a tiny authenticated request to The Card API. It does not merely check that a secret variable exists.
- **Actionable errors.** Upstream HTTP status/message is preserved. Batch scans stop immediately on fatal auth/plan/quota errors (401/403/429).
- **Variant-preserving queries.** Alternate Art, Gold, Holo, Special Illustration Rare, Staff, Full Art, etc. are no longer stripped from card identity.
- **Card-number support.** Seed entries that already include `#123`, `#TG20`, etc. are automatically recognized; any card can be corrected through the Identity button.
- **Targeted deep scans.** One raw query plus one query each for PSA/BGS/CGC/TAG. Default maximum requested rows per card: 52 (12 raw + 10 × 4 graders).
- **Evidence filtering.** Listing titles receive an identity-match score. Obvious lots/bundles/proxies and explicitly lower-condition raw listings are excluded from the comparison.
- **Raw-condition transparency.** The UI distinguishes explicitly Near Mint/Mint evidence from unknown raw condition instead of claiming every raw sale is NM.
- **Confidence score.** Bargains are marked High / Medium / Low-thin based on comp counts, title-match quality, card number, and raw-condition evidence.
- **Underlying sold listings.** Evidence panels include the sold listings used for the raw median and best slab grade.
- **Daily quota awareness.** Rate-limit headers are surfaced in the UI, plus a user-controlled reserve that can stop a batch before its worst-case size would cross the reserve.
- **No persistent storage of API responses.** Live API results use `sessionStorage`, and the Worker sends `Cache-Control: no-store`. This is intentional because The Card API's current Free terms allow query results to be held in memory for the duration of a user session but do not permit persistent local storage of Free-tier API responses.

## Deploy / update

Repository layout must remain:

```
README.md
wrangler.jsonc
public/
  index.html
  seed.json
src/
  worker.js
```

Cloudflare runtime secret (not build secret):

```
THE_CARD_API_KEY
```

The Worker reads that secret server-side and sends it to The Card API using the documented REST header `x-market-api-key`.

## First verification after deployment

1. Open the live site.
2. Click **Test API + backend**.
3. Do not scan cards until the message says the Worker is reachable, the runtime secret is present, and The Card API accepted the key.
4. Deep scan **one card** first.
5. Open **Evidence** and verify the sold listing titles match the intended card/variant before scaling up.

## Free-tier constraints that affect accuracy

At the time this rebuild was made, The Card API Free plan publishes a **5,000 sales-row/day** limit and a **3-day rolling lookback**. Low-volume cards and uncommon grader/grade combinations may therefore have no recent evidence. The site treats that as “no recent comps,” not as an application error.

Raw eBay condition is not present on every record. The app excludes titles that explicitly look LP/MP/HP/damaged, but unknown condition remains possible and lowers confidence.

TAG is queried through the REST `grader` filter. Sparse TAG Pokémon sales in a 3-day window are expected.

## Data-storage note

Live responses are deliberately not stored in `localStorage`, a Cloudflare cache, KV, D1, or other persistent storage in this Free configuration. Only user-created card metadata, identity corrections, selections, and budget preferences are persisted locally.
