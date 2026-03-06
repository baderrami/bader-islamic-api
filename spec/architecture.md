# bader-islamic-api — Architecture

## Overview

A read-only Islamic content API serving Quranic tafsir (exegesis) and audio recitations.
Built on Cloudflare Workers + R2 object storage. Serves the `islam.bader.solutions` web app.

## Architecture Diagram

```
                        +---------------------------------+
                        |   GitHub (baderrami/islam-web)  |
                        +---------------------------------+
                              |                    |
                    push to master           IaC (AWS CDK)
                              |                    |
                              v                    v
                        +----------------------------------+
                        |   AWS Amplify Hosting             |
                        |   (eu-central-1)                  |
                        |                                   |
                        |   - Auto-build on push to master  |
                        |   - Next.js (WEB_COMPUTE)         |
                        |   - Custom domain:                |
                        |     islam.bader.solutions          |
                        |   - Env vars from AWS SSM:        |
                        |     /islam-web/firebase/*          |
                        +----------------------------------+
                              |                    |
                        HTTPS |                    | WebSocket
                              v                    v
          +-----------------------+   +----------------------------+
          | Cloudflare Edge       |   | Firebase Realtime Database |
          | api.islam.bader.      |   | (europe-west1)             |
          | solutions             |   |                            |
          +-----------------------+   | - Online presence tracking |
                    |                 | - User locations (lat/lng) |
                    v                 | - Country codes            |
          +-----------------------+   +----------------------------+
          | Cloudflare Worker     |
          | (islamic-content-api) |
          |                       |
          | - CORS enforcement    |
          | - Route matching      |
          |   (/v1/...)           |
          | - Range request       |
          |   handling            |
          | - Content-Type        |
          |   detection           |
          | - 1-year immutable    |
          |   caching             |
          +-----------------------+
                                       |
                                       | R2 binding
                                       v
                        +---------------------------------+
                        |   Cloudflare R2 Bucket          |
                        |   (islamic-content)             |
                        |                                 |
                        |   tafasir.json                  |
                        |   reciters.json                 |
                        |   tafsir/{slug}/{surah}.json    |
                        |   audio/quran/per-verse/        |
                        |     {reciter}/{surah}/{ayah}.mp3|
                        |     {reciter}/{surah}/meta.json |
                        +---------------------------------+

                                   uploaded by

                        +---------------------------------+
                        |   Local Scripts (scripts/)      |
                        |                                 |
                        |   generate-catalogs.ts          |
                        |     index.json --> tafasir.json  |
                        |     hardcoded  --> reciters.json |
                        |                                 |
                        |   migrate-tafsir.ts             |
                        |     tafsir/ --> output/tafsir/  |
                        |                                 |
                        |   slice-verse-audio.ts          |
                        |     Quran.com API --> per-verse  |
                        |     MP3s + word segment metadata |
                        |                                 |
                        |   upload-to-r2.ts               |
                        |     output/ --> R2 bucket       |
                        +---------------------------------+
                                       |
                                       | fetches audio from
                                       v
                        +---------------------------------+
                        |   Quran.com API (external)      |
                        |   api.quran.com/api/v4/         |
                        +---------------------------------+
```

## API Endpoints

Base URL: `https://api.islam.bader.solutions/v1/`

| Method | Endpoint | Response | Description |
|--------|----------|----------|-------------|
| GET | `/v1/health` | JSON | Health check: `{ status, version }` |
| GET | `/v1/tafasir.json` | JSON | Catalog of all 28 tafseer collections |
| GET | `/v1/reciters.json` | JSON | Catalog of 5 Quran reciters |
| GET | `/v1/tafsir/{slug}/{surah}.json` | JSON | Tafsir text for a specific surah |
| GET | `/v1/audio/quran/per-verse/{reciter}/{surah}/{ayah}.mp3` | MP3 | Per-verse audio (supports range requests) |
| GET | `/v1/audio/quran/per-verse/{reciter}/{surah}/meta.json` | JSON | Audio metadata with word-level timing segments |

## Content Served

### Tafsir (28 collections, 6 languages)

| Language | Count | Examples |
|----------|-------|---------|
| Arabic | 9 | Ibn Kathir, Al-Tabari, Al-Qurtubi, Al-Baghawi, Muyassar |
| English | 9 | Al-Jalalayn, Kashf Al-Asrar, Maarif-ul-Quran |
| Bengali | 4 | Abu Bakr Zakaria, Ahsanul Bayaan |
| Urdu | 3 | Ibn Kathir, Bayan ul Quran |
| Kurdish | 1 | Rebar |
| Russian | 1 | Al-Saddi |

Each collection has 114 JSON files (one per surah), containing verse-by-verse explanations.

### Audio Recitations (5 reciters)

| Reciter | Word Segments |
|---------|---------------|
| Mishari Rashid Al-Afasy | Yes |
| Abu Bakr Al-Shatri | No |
| Nasser Al-Qatami | No |
| Yasser Ad-Dossary | No |
| Hani Ar-Rifai | No |

Per-verse MP3 files (128kbps, 44100Hz mono) with metadata containing word-level timing
for synchronized highlighting during playback.

## Deployment Pipeline

### Web App (islam-web)

```
1. Push to master        git push origin master
2. Amplify auto-builds   (triggered by GitHub webhook)
```

Amplify pulls environment variables from AWS SSM Parameter Store (`/islam-web/firebase/*`)
at deploy time via CDK. To update infrastructure:

```
cd islam-web/IaC
npm run deploy              # cdk deploy --all
```

### Content API (tafsir-api)

```
1. Generate catalogs     npx tsx scripts/generate-catalogs.ts
2. Migrate tafsir data   npx tsx scripts/migrate-tafsir.ts
3. Slice audio (if new)  npx tsx scripts/slice-verse-audio.ts --reciter 7 --surah 1
4. Upload to R2          npx tsx scripts/upload-to-r2.ts
5. Deploy worker         npx wrangler deploy
```

Steps 1-4 populate the `scripts/output/` staging directory and upload to R2.
Step 5 deploys the worker code that serves content from R2.

## Key Design Decisions

- **Static files on R2, not a dynamic API** — All content is pre-generated JSON/MP3 and served
  directly from object storage. The worker is a thin proxy that adds CORS, caching, and range
  request support. No database, no runtime computation.

- **1-year immutable cache** — Content is versioned by structure (slug/surah), not by timestamp.
  Clients cache aggressively; data updates require re-uploading to R2.

- **CORS whitelist** — Only `islam.bader.solutions` and `localhost:3000` are allowed origins.
  Not a public API.

- **Audio slicing from Quran.com** — Full-chapter recitations are downloaded and sliced into
  per-verse MP3s locally using ffmpeg, with word-level segment timing preserved from the
  Quran.com API for synchronized word highlighting.