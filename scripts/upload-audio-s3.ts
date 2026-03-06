#!/usr/bin/env tsx
/**
 * Uploads audio files to R2 using the S3-compatible API.
 * Alternative to wrangler CLI (avoids process spawn per file).
 *
 * NOTE: For large uploads (thousands of files), rclone is more reliable:
 *   rclone copy scripts/output/audio r2:islamic-content/audio -P --transfers=20
 *
 * Required environment variables (in .env at project root):
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret key
 *   R2_BUCKET           — R2 bucket name (e.g. "islamic-content")
 *
 * Usage:
 *   npx tsx scripts/upload-audio-s3.ts                                    # upload all reciters
 *   npx tsx scripts/upload-audio-s3.ts --reciter abu-bakr-al-shatri       # single reciter
 *   npx tsx scripts/upload-audio-s3.ts --skip-existing                    # skip files already in R2
 *   npx tsx scripts/upload-audio-s3.ts --dry-run                          # preview
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { config } from "dotenv";

config({ path: join(new URL(".", import.meta.url).pathname, "..", ".env") });

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;
const CONCURRENCY = 25;
const OUTPUT_BASE = join(new URL(".", import.meta.url).pathname, "output", "audio", "quran", "per-verse");

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_EXISTING = args.includes("--skip-existing");
const reciterArg = args.includes("--reciter") ? args[args.indexOf("--reciter") + 1] : null;

interface FileEntry {
  localPath: string;
  key: string;
}

function collectFiles(reciterDir: string, reciterSlug: string): FileEntry[] {
  const files: FileEntry[] = [];
  const surahs = readdirSync(reciterDir).filter((d) => {
    const full = join(reciterDir, d);
    return statSync(full).isDirectory();
  });

  for (const surah of surahs) {
    const surahDir = join(reciterDir, surah);
    const entries = readdirSync(surahDir);
    for (const entry of entries) {
      const localPath = join(surahDir, entry);
      if (!statSync(localPath).isFile()) continue;
      const key = `audio/quran/per-verse/${reciterSlug}/${surah}/${entry}`;
      files.push({ localPath, key });
    }
  }
  return files;
}

async function uploadFile(entry: FileEntry): Promise<boolean> {
  try {
    const body = readFileSync(entry.localPath);
    const ct = CONTENT_TYPES[extname(entry.key)] ?? "application/octet-stream";
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: entry.key,
      Body: body,
      ContentType: ct,
    }));
    return true;
  } catch (e) {
    console.error(`  ✗ ${entry.key}: ${(e as Error).message.slice(0, 80)}`);
    return false;
  }
}

async function checkExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadBatch(files: FileEntry[]): Promise<{ uploaded: number; skipped: number; errors: number }> {
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (entry) => {
        if (SKIP_EXISTING && await checkExists(entry.key)) {
          return "skip";
        }
        return (await uploadFile(entry)) ? "ok" : "error";
      }),
    );

    for (const r of results) {
      if (r === "ok") uploaded++;
      else if (r === "skip") skipped++;
      else errors++;
    }

    processed += chunk.length;
    if (processed % 200 < CONCURRENCY || processed === files.length) {
      const pct = ((processed / files.length) * 100).toFixed(1);
      console.log(`  [${pct}%] ${uploaded} uploaded, ${skipped} skipped, ${errors} errors (${processed}/${files.length})`);
    }
  }

  return { uploaded, skipped, errors };
}

// ── Main ────────────────────────────────────────────────────────────────────

const reciters = reciterArg
  ? [reciterArg]
  : readdirSync(OUTPUT_BASE).filter((d) => {
      const full = join(OUTPUT_BASE, d);
      return statSync(full).isDirectory() && !d.startsWith(".");
    });

console.log(`Bucket: ${BUCKET}`);
console.log(`Reciters: ${reciters.join(", ")}`);
if (DRY_RUN) console.log("DRY RUN\n");

for (const slug of reciters) {
  const reciterDir = join(OUTPUT_BASE, slug);
  const files = collectFiles(reciterDir, slug);

  if (DRY_RUN) {
    let totalSize = 0;
    for (const f of files) totalSize += statSync(f.localPath).size;
    console.log(`${slug}: ${files.length} files (${(totalSize / 1024 / 1024).toFixed(0)} MB)`);
    continue;
  }

  console.log(`\n📤 Uploading ${slug} (${files.length} files)...`);
  const { uploaded, skipped, errors } = await uploadBatch(files);
  console.log(`✅ ${slug}: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
}

console.log("\n✅ All done");