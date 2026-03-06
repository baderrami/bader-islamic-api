#!/usr/bin/env tsx
/**
 * Generates catalog JSON files for the API:
 *   - output/tafasir.json  — from index.json (master tafsir catalog)
 *   - output/reciters.json — hardcoded list of reciters with audio on R2
 *
 * Usage: npx tsx scripts/generate-catalogs.ts
 *
 * Adding a new reciter:
 *   1. Add an entry to the `reciters` array below (kebab-case id, Arabic/English names)
 *   2. Download audio with: npx tsx download-reciter-audio.ts --reciter <slug>
 *   3. Upload to R2 with rclone
 *   4. Re-run this script and upload the updated reciters.json
 *
 * Adding a new tafsir:
 *   1. Add an entry to index.json (slug, name, nameEn, author, language)
 *   2. Place per-verse files in tafsir/{slug}/{surah}/{ayah}.json
 *   3. Re-run this script + migrate-tafsir.ts and upload
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const OUTPUT_DIR = join(ROOT, "scripts", "output");

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Tafasir catalog ──────────────────────────────────────────────────────────

const indexPath = join(ROOT, "index.json");
const indexData = JSON.parse(readFileSync(indexPath, "utf-8"));

// Normalize: wrap in { tafasir: [...] } with the canonical key name
const tafasirOutput = { tafasir: indexData.tafseers };

writeFileSync(
  join(OUTPUT_DIR, "tafasir.json"),
  JSON.stringify(tafasirOutput, null, 2),
);
console.log(`✓ tafasir.json (${tafasirOutput.tafasir.length} entries)`);

// ── Reciters catalog ─────────────────────────────────────────────────────────

const reciters = [
  {
    id: "mishari-al-afasy",
    nameAr: "مشاري راشد العفاسي",
    nameEn: "Mishari Rashid Al-Afasy",
    hasWordSegments: true,
    legacyId: "1",
  },
  {
    id: "abu-bakr-al-shatri",
    nameAr: "أبو بكر الشاطري",
    nameEn: "Abu Bakr Al-Shatri",
    hasWordSegments: false,
    legacyId: "2",
  },
  {
    id: "nasser-al-qatami",
    nameAr: "ناصر القطامي",
    nameEn: "Nasser Al-Qatami",
    hasWordSegments: false,
    legacyId: "3",
  },
  {
    id: "yasser-al-dossary",
    nameAr: "ياسر الدوسري",
    nameEn: "Yasser Ad-Dossary",
    hasWordSegments: false,
    legacyId: "4",
  },
  {
    id: "hani-ar-rifai",
    nameAr: "هاني الرفاعي",
    nameEn: "Hani Ar-Rifai",
    hasWordSegments: false,
    legacyId: "5",
  },
];

writeFileSync(
  join(OUTPUT_DIR, "reciters.json"),
  JSON.stringify({ reciters }, null, 2),
);
console.log(`✓ reciters.json (${reciters.length} entries)`);

console.log("\n✅ Catalogs generated");