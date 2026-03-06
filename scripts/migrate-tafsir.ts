#!/usr/bin/env tsx
/**
 * Copies the existing tafsir/ directory into scripts/output/tafsir/
 * so the upload script can push everything from a single output/ directory.
 *
 * The tafsir/ source directory contains per-verse JSON files structured as:
 *   tafsir/{slug}/{surah}/{ayah}.json
 *
 * This script doesn't transform the data — it just copies it into output/
 * alongside the other generated content (catalogs, quran text, audio).
 *
 * Usage: npx tsx scripts/migrate-tafsir.ts
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const TAFSIR_SRC = join(ROOT, "tafsir");
const OUTPUT_DIR = join(ROOT, "scripts", "output", "tafsir");

if (!existsSync(TAFSIR_SRC)) {
  console.error("tafsir/ directory not found at", TAFSIR_SRC);
  process.exit(1);
}

console.log(`Copying tafsir/ → scripts/output/tafsir/`);
mkdirSync(OUTPUT_DIR, { recursive: true });
cpSync(TAFSIR_SRC, OUTPUT_DIR, { recursive: true });
console.log("✅ Done");