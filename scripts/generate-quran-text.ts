#!/usr/bin/env tsx
/**
 * Generates Quran text JSON files for the API:
 *   - output/quran/surahs.json          — 114-entry surah index
 *   - output/quran/surahs/{1..114}.json — full surah with verse text + transliteration
 *
 * Source: `quran-json` npm package (install with `npm install` in scripts/).
 *   - quran.json      — all 114 surahs with Arabic text
 *   - chapters/*.json — per-surah files with transliteration
 *
 * Output schema (surahs.json):
 *   { surahs: [{ id, name, transliteration, type, totalVerses }] }
 *
 * Output schema (surahs/{n}.json):
 *   { id, name, transliteration, type, totalVerses,
 *     verses: [{ id, text, transliteration? }] }
 *
 * Usage: npx tsx scripts/generate-quran-text.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const OUTPUT_DIR = join(ROOT, "scripts", "output", "quran", "surahs");
const QURAN_JSON_DIR = join(ROOT, "scripts", "node_modules", "quran-json", "dist");

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// Load full quran.json for the index (has all surahs with verses)
const quranData: Array<{
  id: number;
  name: string;
  transliteration: string;
  type: string;
  total_verses: number;
  verses: Array<{ id: number; text: string }>;
}> = JSON.parse(readFileSync(join(QURAN_JSON_DIR, "quran.json"), "utf-8"));

// ── Surah index ──────────────────────────────────────────────────────────────

const surahIndex = {
  surahs: quranData.map((s) => ({
    id: s.id,
    name: s.name,
    transliteration: s.transliteration,
    type: s.type,
    totalVerses: s.total_verses,
  })),
};

writeFileSync(
  join(ROOT, "scripts", "output", "quran", "surahs.json"),
  JSON.stringify(surahIndex, null, 2),
);
console.log(`✓ quran/surahs.json (${surahIndex.surahs.length} surahs)`);

// ── Per-surah files ──────────────────────────────────────────────────────────

for (const surah of quranData) {
  // Try to load from chapters/ for transliteration data
  const chapterPath = join(QURAN_JSON_DIR, "chapters", `${surah.id}.json`);
  let verses: Array<{ id: number; text: string; transliteration?: string }>;

  if (existsSync(chapterPath)) {
    const chapter = JSON.parse(readFileSync(chapterPath, "utf-8"));
    verses = chapter.verses;
  } else {
    verses = surah.verses;
  }

  const surahFile = {
    id: surah.id,
    name: surah.name,
    transliteration: surah.transliteration,
    type: surah.type,
    totalVerses: surah.total_verses,
    verses: verses.map((v) => ({
      id: v.id,
      text: v.text,
      ...(v.transliteration ? { transliteration: v.transliteration } : {}),
    })),
  };

  writeFileSync(
    join(OUTPUT_DIR, `${surah.id}.json`),
    JSON.stringify(surahFile),
  );
}

console.log(`✓ quran/surahs/{1..114}.json (per-surah files)`);

// ── Export verse counts (useful for other scripts) ───────────────────────────

export const VERSE_COUNTS: Record<number, number> = {};
for (const s of quranData) {
  VERSE_COUNTS[s.id] = s.total_verses;
}

console.log("\n✅ Quran text generated");
