/**
 * Cloudflare Worker — serves Islamic content from R2 bucket.
 *
 * Routes:
 *   GET /v1/health                                              Health check
 *   GET /v1/reciters.json                                       Reciter catalog (5 reciters)
 *   GET /v1/tafasir.json                                        Tafsir catalog (27 collections)
 *   GET /v1/quran/surahs.json                                   Surah index (114 entries)
 *   GET /v1/quran/surahs/{surah}.json                           Full surah text + verses
 *   GET /v1/tafsir/{slug}/{surah}/{ayah}.json                   Per-verse tafsir
 *   GET /v1/audio/quran/per-verse/{reciter}/{surah}/{ayah}.mp3  Per-verse audio
 *   GET /v1/audio/quran/per-verse/{reciter}/{surah}/meta.json   Word segments (Al-Afasy only)
 */

interface Env {
  BUCKET: R2Bucket;
  ALLOWED_ORIGINS: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function getContentType(key: string): string {
  const ext = key.substring(key.lastIndexOf("."));
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function jsonError(status: number, error: string, path: string, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error, path }), {
    status,
    headers: { ...JSON_HEADERS, ...cors },
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());

  if (allowed.includes(origin) || allowed.includes("*")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      "Access-Control-Max-Age": "86400",
    };
  }

  return {};
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, "Method not allowed", path, cors);
    }

    // Health check
    if (path === "/v1/health") {
      return new Response(JSON.stringify({ status: "ok", version: "1.0.0" }), {
        status: 200,
        headers: { ...JSON_HEADERS, ...cors },
      });
    }

    // Strip /v1/ prefix to get the R2 key
    const match = path.match(/^\/v1\/(.+)$/);
    if (!match) {
      return jsonError(404, "Not found", path, cors);
    }

    const key = match[1];

    // Handle range requests for audio streaming
    const rangeHeader = request.headers.get("Range");
    let object: R2ObjectBody | R2Object | null;

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : undefined;
        object = await env.BUCKET.get(key, {
          range: { offset: start, length: end ? end - start + 1 : undefined },
        });
      } else {
        object = await env.BUCKET.get(key);
      }
    } else {
      object = await env.BUCKET.get(key);
    }

    if (!object) {
      return jsonError(404, "Not found", path, cors);
    }

    const headers: Record<string, string> = {
      "Content-Type": getContentType(key),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      ...cors,
    };

    // If it's a body response (has .body), stream it
    if ("body" in object && object.body) {
      if (rangeHeader && object.range) {
        const range = object.range as { offset: number; length: number };
        headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`;
        headers["Content-Length"] = String(range.length);
        return new Response(object.body, { status: 206, headers });
      }

      headers["Content-Length"] = String(object.size);
      return new Response(object.body, { status: 200, headers });
    }

    // HEAD request or object without body
    headers["Content-Length"] = String(object.size);
    return new Response(null, { status: 200, headers });
  },
};