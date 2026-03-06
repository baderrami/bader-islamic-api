#!/usr/bin/env tsx
/**
 * Downloads per-verse MP3 files from everyayah.com for reciters 2-5.
 * (Reciter 1 — mishari-al-afasy — was uploaded separately and already exists on R2.)
 *
 * URL pattern: https://everyayah.com/data/{path}/{SSS}{AAA}.mp3
 *   SSS = 3-digit zero-padded surah number (001-114)
 *   AAA = 3-digit zero-padded ayah number (001-286)
 *
 * Output: scripts/output/audio/quran/per-verse/{reciter-slug}/{surah}/{ayah}.mp3
 *
 * Usage:
 *   npx tsx scripts/download-reciter-audio.ts --reciter abu-bakr-al-shatri
 *   npx tsx scripts/download-reciter-audio.ts --reciter nasser-al-qatami --surah 1
 *   npx tsx scripts/download-reciter-audio.ts --reciter all
 *
 * Features:
 *   - Resume support: skips files that already exist on disk
 *   - 10 concurrent downloads (be respectful to everyayah.com)
 *   - Progress reporting every 50 files
 *
 * Finding everyayah.com paths for new reciters:
 *   Visit https://everyayah.com/data/status.php to see all available reciters
 *   and their folder names. Test a URL before adding: e.g.
 *   curl -I "https://everyayah.com/data/FolderName/001001.mp3"
 *
 * After downloading, upload to R2:
 *   rclone copy scripts/output/audio r2:islamic-content/audio -P --transfers=20
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const OUTPUT_BASE = join(ROOT, "scripts", "output", "audio", "quran", "per-verse");

// ── Reciter → everyayah.com path mapping ────────────────────────────────────

const RECITER_PATHS: Record<string, string> = {
  "abu-bakr-al-shatri": "Abu_Bakr_Ash-Shaatree_128kbps",
  "nasser-al-qatami": "Nasser_Alqatami_128kbps",
  "yasser-al-dossary": "Yasser_Ad-Dussary_128kbps",
  "hani-ar-rifai": "Hani_Rifai_192kbps",
};

// ── Verse counts per surah ──────────────────────────────────────────────────

const VERSE_COUNTS: Record<number, number> = {
  1:7,2:286,3:200,4:176,5:120,6:165,7:206,8:75,9:129,10:109,
  11:123,12:111,13:43,14:52,15:99,16:128,17:111,18:110,19:98,20:135,
  21:112,22:78,23:118,24:64,25:77,26:227,27:93,28:88,29:69,30:60,
  31:34,32:30,33:73,34:54,35:45,36:83,37:182,38:88,39:75,40:85,
  41:54,42:53,43:89,44:59,45:37,46:35,47:38,48:29,49:18,50:45,
  51:60,52:49,53:62,54:55,55:78,56:96,57:29,58:22,59:24,60:13,
  61:14,62:11,63:11,64:18,65:12,66:12,67:30,68:52,69:52,70:44,
  71:28,72:28,73:20,74:56,75:40,76:31,77:50,78:40,79:46,80:42,
  81:29,82:19,83:36,84:25,85:22,86:17,87:19,88:26,89:30,90:20,
  91:15,92:21,93:11,94:8,95:8,96:19,97:5,98:8,99:8,100:11,
  101:11,102:8,103:3,104:9,105:5,106:4,107:7,108:3,109:6,110:3,
  111:5,112:4,113:5,114:6,
};

// ── Concurrency limiter ─────────────────────────────────────────────────────

async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
      completed++;
      if (onProgress && completed % 50 === 0) {
        onProgress(completed, tasks.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ── Download function ───────────────────────────────────────────────────────

async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ✗ ${url} → ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(destPath, buffer);
    return true;
  } catch (e) {
    console.error(`  ✗ ${url} → ${(e as Error).message}`);
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const reciterArg = args[args.indexOf("--reciter") + 1];
const surahArg = args.includes("--surah") ? args[args.indexOf("--surah") + 1] : null;

if (!reciterArg) {
  console.error("Usage: npx tsx scripts/download-reciter-audio.ts --reciter <slug|all> [--surah <n>]");
  console.error("Available reciters:", Object.keys(RECITER_PATHS).join(", "));
  process.exit(1);
}

const recitersToDownload = reciterArg === "all"
  ? Object.keys(RECITER_PATHS)
  : [reciterArg];

for (const slug of recitersToDownload) {
  const everyayahPath = RECITER_PATHS[slug];
  if (!everyayahPath) {
    console.error(`Unknown reciter: ${slug}`);
    console.error("Available:", Object.keys(RECITER_PATHS).join(", "));
    process.exit(1);
  }

  const surahs = surahArg
    ? surahArg.split(",").map(Number)
    : Array.from({ length: 114 }, (_, i) => i + 1);

  console.log(`\n📥 Downloading ${slug} (${surahs.length} surahs)...`);

  const tasks: (() => Promise<boolean>)[] = [];

  for (const surah of surahs) {
    const verseCount = VERSE_COUNTS[surah];
    if (!verseCount) {
      console.error(`Invalid surah number: ${surah}`);
      continue;
    }

    const surahDir = join(OUTPUT_BASE, slug, String(surah));
    if (!existsSync(surahDir)) mkdirSync(surahDir, { recursive: true });

    for (let ayah = 1; ayah <= verseCount; ayah++) {
      const destPath = join(surahDir, `${ayah}.mp3`);

      // Resume support: skip existing files
      if (existsSync(destPath)) continue;

      const sss = String(surah).padStart(3, "0");
      const aaa = String(ayah).padStart(3, "0");
      const url = `https://everyayah.com/data/${everyayahPath}/${sss}${aaa}.mp3`;

      tasks.push(() => downloadFile(url, destPath));
    }
  }

  if (tasks.length === 0) {
    console.log(`  ✓ All files already exist, nothing to download`);
    continue;
  }

  console.log(`  ${tasks.length} files to download (10 concurrent)...`);

  const results = await pLimit(tasks, 10, (done, total) => {
    console.log(`  Progress: ${done}/${total}`);
  });

  const success = results.filter(Boolean).length;
  const errors = results.length - success;
  console.log(`  ✅ ${slug}: ${success} downloaded, ${errors} errors`);
}

console.log("\n✅ Done");