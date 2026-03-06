# bader-islamic-api — Improvement Tracker

## Security

### Exposed Credentials in Repository
- `.env` contains R2 access keys and exists in the repo tree
- Rotate keys and ensure `.env` is properly gitignored
- Use `wrangler secret` for worker secrets and environment-specific configs for scripts

## Bugs / Data Issues

### ~~Duplicate Tafsir Entry~~ ✅
- ~~`index.json` lists `kashf-al-asrar` twice (IDs 86 and 93, both "en" language)~~
- Removed duplicate `kashf-al-asrar-tafsir` (incomplete subset); kept `en-kashf-al-asrar-tafsir` (more complete)

### ~~Books Endpoint Incomplete~~ ✅
- ~~`books/safwat-al-tafasir/` data exists locally but no worker route serves it~~
- Removed `books/` directory entirely; will revisit as a clean feature later

## API Improvements

### ~~Missing Error Response Bodies~~ ✅
- ~~Worker returns raw 404/405 with no body~~
- All error responses now return JSON: `{ "error": "...", "path": "..." }`

### ~~Health / Status Endpoint~~ ✅
- ~~Add a `/v1/health` endpoint returning `{ "status": "ok", "version": "..." }`~~
- Added `GET /v1/health` → `{ "status": "ok", "version": "1.0.0" }`

### Verse Reference Lookup
- Currently the client must know the exact surah number
- A verse-reference endpoint (`/v1/tafsir/{slug}/2:255` for Ayat al-Kursi) would be useful

### Search Endpoint
- Add `/v1/tafsir/{slug}/search?q=...` for text search across tafsir content
- Could be a lightweight KV-based index

### ETag / Conditional Requests
- No mechanism to know when data changed
- Add `ETag` or `Last-Modified` headers from R2 object metadata
- Lets the client do conditional requests (`If-None-Match`) and save bandwidth

## Infrastructure

### Data Pipeline Automation
- Processing pipeline (generate-catalogs → migrate-tafsir → upload-to-r2) is manual
- A single `npm run deploy-data` script or GitHub Action on push to `main` would reduce human error

### Compression
- JSON served without explicit `Content-Encoding`
- Cloudflare auto-compresses on the edge, but storing R2 objects gzip'd with proper encoding headers could reduce egress costs

## Data Coverage

### Audio Word Segments
- Only Mishari Al-Afasy has `hasWordSegments: true`
- Document this limitation for the other 4 reciters or fall back to estimated segments

## Future / Nice-to-Have

### Typed Client SDK
- Generate a small TypeScript SDK or shared types from the API's data models
- Prevents drift between API responses and client expectations

### Rate Limiting
- Not needed for a private app, but Cloudflare Workers has built-in rate limiting via bindings
- Worth adding if the API is ever opened to the public
