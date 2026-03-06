# Islamic Content API

Public REST API serving Quran text, tafsir commentaries, and recitation audio.

**Base URL:** `https://api.islam.bader.solutions/v1/`

## Endpoints

### Health Check

```
GET /v1/health
```

Returns `{ "status": "ok", "version": "1.0.0" }`.

### Reciters

```
GET /v1/reciters.json
```

Returns a catalog of 5 Quran reciters with Arabic/English names and word-segment availability.

### Tafasir (Commentaries)

```
GET /v1/tafasir.json
```

Returns a catalog of 27 tafsir collections across 6 languages (Arabic, English, Bengali, Urdu, Russian, Kurdish).

### Quran Text

```
GET /v1/quran/surahs.json
GET /v1/quran/surahs/{surah}.json
```

- `surahs.json` — Index of all 114 surahs (id, name, transliteration, type, totalVerses)
- `surahs/{surah}.json` — Full surah with verse text and transliteration

### Per-Verse Tafsir

```
GET /v1/tafsir/{slug}/{surah}/{ayah}.json
```

Returns the tafsir commentary for a specific verse. Use slugs from `/v1/tafasir.json`.

**Example:** `/v1/tafsir/ar-tafsir-muyassar/1/1.json`

### Per-Verse Audio

```
GET /v1/audio/quran/per-verse/{reciter}/{surah}/{ayah}.mp3
```

Returns the MP3 audio for a specific verse. Supports `Range` requests for streaming.

**Reciters:** `mishari-al-afasy`, `abu-bakr-al-shatri`, `nasser-al-qatami`, `yasser-al-dossary`, `hani-ar-rifai`

**Example:** `/v1/audio/quran/per-verse/mishari-al-afasy/55/13.mp3`

### Word Segments (Metadata)

```
GET /v1/audio/quran/per-verse/{reciter}/{surah}/meta.json
```

Returns word-level timing data for per-verse audio. Currently only available for `mishari-al-afasy`.

## Caching

All content responses include `Cache-Control: public, max-age=31536000, immutable` (1 year). Content is versioned by path, not by timestamp.

## CORS

All origins are allowed (`Access-Control-Allow-Origin: *`).

## Project Structure

```
tafsir-api/
├── index.json              # Master tafsir catalog (27 entries with metadata)
├── tafsir/                 # Tafsir source data (per-verse JSON files)
│   └── {slug}/{surah}/{ayah}.json
├── scripts/
│   ├── generate-catalogs.ts        # Generates reciters.json + tafasir.json
│   ├── generate-quran-text.ts      # Generates quran/surahs.json + per-surah files
│   ├── migrate-tafsir.ts           # Restructures tafsir/ into R2 key layout
│   ├── download-reciter-audio.ts   # Downloads per-verse MP3s from everyayah.com
│   ├── upload-to-r2.ts             # Uploads output/ to R2 via wrangler
│   ├── upload-audio-s3.ts          # Uploads audio to R2 via S3 API
│   └── output/                     # Generated files (git-ignored)
│       ├── reciters.json
│       ├── tafasir.json
│       ├── quran/surahs.json
│       ├── quran/surahs/{1..114}.json
│       ├── tafsir/{slug}/{surah}/{ayah}.json
│       └── audio/quran/per-verse/{reciter}/{surah}/{ayah}.mp3
└── worker/
    └── src/worker.ts       # Cloudflare Worker — proxies R2 with CORS + caching
```

## R2 Content

All content is stored in the `islamic-content` R2 bucket. The R2 key layout mirrors the API paths:

| R2 Key Pattern | Source | Script |
|---|---|---|
| `reciters.json` | Hardcoded in script | `generate-catalogs.ts` |
| `tafasir.json` | `index.json` | `generate-catalogs.ts` |
| `quran/surahs.json` | `quran-json` npm package | `generate-quran-text.ts` |
| `quran/surahs/{surah}.json` | `quran-json` npm package | `generate-quran-text.ts` |
| `tafsir/{slug}/{surah}/{ayah}.json` | `tafsir/` directory | `migrate-tafsir.ts` |
| `audio/quran/per-verse/{reciter}/{surah}/{ayah}.mp3` | everyayah.com | `download-reciter-audio.ts` |
| `audio/quran/per-verse/{reciter}/{surah}/meta.json` | Pre-existing (mishari-al-afasy only) | — |

### Reproducing from scratch

```bash
cd scripts && npm install

# Generate catalogs and quran text
npx tsx generate-catalogs.ts
npx tsx generate-quran-text.ts
npx tsx migrate-tafsir.ts

# Download audio (~5.8 GB total, ~24k files)
npx tsx download-reciter-audio.ts --reciter all

# Upload everything to R2 (rclone recommended for audio)
npx tsx upload-to-r2.ts
rclone copy output/audio r2:islamic-content/audio -P --transfers=20
```

## Infrastructure

- **Cloudflare Worker** proxying to R2 storage
- **R2 Bucket:** `islamic-content`
- **Custom Domain:** `api.islam.bader.solutions`
