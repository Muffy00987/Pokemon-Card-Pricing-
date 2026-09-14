# Audit notes — 2026-09-14

This rebuild was made after reviewing the deployed project's failure path and the current The Card API documentation/terms.

## Verified before packaging

- Worker JavaScript parses successfully under Node as an ES module.
- Front-end JavaScript parses successfully.
- `seed.json` and `wrangler.jsonc` parse successfully.
- 363 seed cards remain present.
- Static HTML has no duplicate IDs and every static `$('#id')` reference points to an existing element.
- Unit tests verify variant-preserving query construction, card-number matching, raw-condition classification, bargain summarization, 401 propagation, and quota-header aggregation.
- Mocked Worker integration verifies a 401 stops after the first upstream request rather than firing all grader requests.
- Mocked successful deep scan verifies the expected five upstream requests (raw + PSA + BGS + CGC + TAG) and a returned bargain result.
- Live API responses are not persisted to `localStorage` or Cloudflare Cache API in this Free build.

## Current external limitations

- The Card API Free plan: 5,000 returned sales rows/day and 3-day lookback.
- A query can legitimately return no comps for older/low-volume cards.
- Raw condition is not populated on every marketplace record, so the app lowers confidence when NM/Mint cannot be explicitly confirmed.
- A 401 from The Card API still means the supplied API key is invalid or missing according to the current API documentation. The rebuilt health test now exposes that directly.
