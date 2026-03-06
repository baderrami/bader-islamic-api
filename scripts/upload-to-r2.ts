#!/usr/bin/env tsx
/**
 * Uploads scripts/output/ to Cloudflare R2 bucket using wrangler CLI.
 * Good for JSON files and small batches. For bulk audio uploads (thousands
 * of MP3 files), use rclone instead — it's much faster:
 *
 *   rclone copy scripts/output/audio r2:islamic-content/audio -P --transfers=20
 *
 * Usage:
 *   npx tsx scripts/upload-to-r2.ts                     # upload everything
 *   npx tsx scripts/upload-to-r2.ts --prefix quran      # upload only quran text
 *   npx tsx scripts/upload-to-r2.ts --prefix tafasir    # upload only tafasir catalog
 *   npx tsx scripts/upload-to-r2.ts --dry-run           # list what would be uploaded
 *
 * Requires: npx wrangler login (already authenticated)
 */

import { execSync, exec } from "node:child_process";
import { statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ── Config ───────────────────────────────────────────────────────────────────

const BUCKET = "islamic-content";
const CONCURRENCY = 10;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PREFIX_IDX = args.indexOf("--prefix");
const PREFIX_FILTER = PREFIX_IDX !== -1 ? args[PREFIX_IDX + 1] : undefined;

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const OUTPUT_DIR = join(SCRIPT_DIR, "output");

// ── Content type map ─────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

function getContentType(key: string): string {
  return CONTENT_TYPES[extname(key)] ?? "application/octet-stream";
}

// ── Collect files ────────────────────────────────────────────────────────────

function collectFiles(dir: string): string[] {
  const output = execSync(`find -L "${dir}" -type f`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return output.trim().split("\n").filter(Boolean);
}

// ── Upload via wrangler ──────────────────────────────────────────────────────

function uploadFile(localPath: string, key: string): Promise<boolean> {
  const ct = getContentType(key);
  return new Promise((resolve) => {
    exec(
      `npx wrangler r2 object put "${BUCKET}/${key}" --file="${localPath}" --content-type="${ct}" --remote`,
      { timeout: 60000 },
      (err) => {
        if (err) {
          console.error(`  ✗ ${key}: ${err.message.slice(0, 100)}`);
          resolve(false);
        } else {
          resolve(true);
        }
      },
    );
  });
}

// ── Parallel upload ──────────────────────────────────────────────────────────

async function uploadAll(
  files: { localPath: string; key: string }[],
): Promise<{ uploaded: number; errors: number }> {
  let uploaded = 0;
  let errors = 0;
  let processed = 0;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(({ localPath, key }) => uploadFile(localPath, key)),
    );

    for (const ok of results) {
      if (ok) uploaded++;
      else errors++;
    }

    processed += chunk.length;
    if (processed % 100 < CONCURRENCY || processed === files.length) {
      const pct = ((processed / files.length) * 100).toFixed(1);
      console.log(
        `  [${pct}%] ${uploaded} uploaded, ${errors} errors (${processed}/${files.length})`,
      );
    }
  }

  return { uploaded, errors };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  if (PREFIX_FILTER) console.log(`Filter prefix: ${PREFIX_FILTER}`);
  if (DRY_RUN) console.log("DRY RUN — no uploads\n");

  const allFiles = collectFiles(OUTPUT_DIR);
  console.log(`Found ${allFiles.length} total files in output/\n`);

  const filesToUpload: { localPath: string; key: string }[] = [];

  for (const filePath of allFiles) {
    const key = relative(OUTPUT_DIR, filePath);
    if (PREFIX_FILTER && !key.startsWith(PREFIX_FILTER)) continue;
    filesToUpload.push({ localPath: filePath, key });
  }

  if (DRY_RUN) {
    let totalSize = 0;
    for (const { localPath, key } of filesToUpload) {
      const size = statSync(localPath).size;
      totalSize += size;
    }
    console.log(
      `Would upload ${filesToUpload.length} files (${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
    );
    return;
  }

  console.log(
    `Uploading ${filesToUpload.length} files (concurrency: ${CONCURRENCY})...\n`,
  );
  const { uploaded, errors } = await uploadAll(filesToUpload);
  console.log(`\n✅ Done: ${uploaded} uploaded, ${errors} errors`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});