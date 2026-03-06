#!/usr/bin/env tsx
/**
 * Slice chapter MP3 into per-verse MP3 files with word-segment metadata.
 *
 * Usage:
 *   npx tsx scripts/slice-verse-audio.ts --reciter 7 --surah 112
 *   npx tsx scripts/slice-verse-audio.ts --reciter 7                 # all 114 surahs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const RECITER_ID = Number(getArg("reciter") ?? 7);
const SURAH_ARG = getArg("surah"); // undefined = all
const SURAH_LIST: number[] = SURAH_ARG
  ? SURAH_ARG.split(",").map(Number)
  : Array.from({ length: 114 }, (_, i) => i + 1);

const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const TMP_DIR = join(SCRIPT_DIR, "tmp", String(RECITER_ID));
const OUTPUT_DIR = join(SCRIPT_DIR, "output", "audio", String(RECITER_ID));

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiTimestamp {
  verse_key: string;
  timestamp_from: number;
  timestamp_to: number;
  segments: [number, number, number][];
}

interface ApiAudioFile {
  audio_url: string;
  file_size: number;
  timestamps: ApiTimestamp[];
}

interface MetaSegment {
  w: number;
  s: number;
  e: number;
}

interface MetaVerse {
  durationMs: number;
  wordCount: number;
  segments: MetaSegment[];
}

interface MetaJson {
  reciterId: number;
  surah: number;
  verses: Record<string, MetaVerse>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

async function downloadFile(url: string, dest: string, expectedSize?: number): Promise<void> {
  // Skip if already downloaded and size matches
  if (existsSync(dest) && expectedSize) {
    const stat = statSync(dest);
    if (stat.size === expectedSize) {
      console.log(`  ✓ cached: ${dest}`);
      return;
    }
  }

  console.log(`  ↓ downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
}

function run(cmd: string) {
  execSync(cmd, { stdio: "pipe" });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function processSurah(surah: number): Promise<void> {
  console.log(`\n═══ Surah ${surah} ═══`);

  // 1. Fetch chapter recitation metadata with segments
  const apiUrl = `https://api.quran.com/api/v4/chapter_recitations/${RECITER_ID}/${surah}?segments=true`;
  const data = await fetchJson<{ audio_file: ApiAudioFile }>(apiUrl);
  const audioFile = data.audio_file;

  if (!audioFile?.audio_url || !audioFile.timestamps?.length) {
    console.log(`  ⚠ No audio/timestamps for surah ${surah}, skipping`);
    return;
  }

  // 2. Download chapter MP3
  ensureDir(TMP_DIR);
  const mp3Path = join(TMP_DIR, `${surah}.mp3`);
  await downloadFile(audioFile.audio_url, mp3Path, audioFile.file_size);

  // 3. Decode to WAV (sample-accurate)
  const wavPath = join(TMP_DIR, `${surah}.wav`);
  if (!existsSync(wavPath)) {
    console.log(`  ⊞ decoding to WAV...`);
    run(`${FFMPEG} -y -i "${mp3Path}" -acodec pcm_s16le -ar 44100 -ac 1 "${wavPath}"`);
  } else {
    console.log(`  ✓ WAV cached`);
  }

  // 4. Slice per-verse + build meta
  const surahOutDir = join(OUTPUT_DIR, String(surah));
  ensureDir(surahOutDir);

  const meta: MetaJson = {
    reciterId: RECITER_ID,
    surah,
    verses: {},
  };

  for (const ts of audioFile.timestamps) {
    const [, ayahStr] = ts.verse_key.split(":");
    const ayah = Number(ayahStr);

    const startSec = ts.timestamp_from / 1000;
    const endSec = ts.timestamp_to / 1000;
    const durationMs = ts.timestamp_to - ts.timestamp_from;

    const outMp3 = join(surahOutDir, `${ayah}.mp3`);

    // Slice from WAV → per-verse MP3
    if (!existsSync(outMp3)) {
      run(
        `${FFMPEG} -y -i "${wavPath}" -ss ${startSec} -to ${endSec}` +
          ` -codec:a libmp3lame -b:a 128k -ar 44100 -ac 1 "${outMp3}"`,
      );
    }

    // Build verse-relative segments
    const segments: MetaSegment[] = [];
    if (ts.segments) {
      const validSegs = ts.segments.filter(
        (seg) => seg.length >= 3 && typeof seg[1] === "number" && typeof seg[2] === "number",
      );
      for (let i = 0; i < validSegs.length; i++) {
        segments.push({
          w: i,
          s: Math.max(0, validSegs[i][1] - ts.timestamp_from),
          e: Math.max(0, validSegs[i][2] - ts.timestamp_from),
        });
      }
    }

    meta.verses[String(ayah)] = {
      durationMs,
      wordCount: segments.length,
      segments,
    };
  }

  // 5. Write meta.json
  const metaPath = join(surahOutDir, "meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`  ✓ ${Object.keys(meta.verses).length} verses → ${surahOutDir}`);

  // 6. Clean up WAV (save disk)
  if (existsSync(wavPath)) {
    unlinkSync(wavPath);
    console.log(`  ✓ cleaned WAV`);
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reciter: ${RECITER_ID}`);
  console.log(`Surahs: ${SURAH_LIST.length === 114 ? "all 114" : SURAH_LIST.join(", ")}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  for (const surah of SURAH_LIST) {
    await processSurah(surah);
  }

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
