import type { Context } from "hono";
import { notFound, error } from "../response";
import type { Env } from "../types";

const CACHE_MAX_AGE = 31_536_000; // 1 year for immutable content

/** 
 * GET /usercontent/<userId>/<fileId>
 * GET /usercontent/<userId>/<fileId>/thumbnail
 * Serves objects directly from R2 with proper caching headers.
 * No auth required — access control is via URL obscurity (UUIDs).
 */
export async function handleServe(c: Context<{ Bindings: Env }>, key: string): Promise<Response> {
    const request = c.req.raw;
    const env = c.env;

    // Support conditional requests
    const ifNoneMatch = request.headers.get("If-None-Match");
    const ifModifiedSince = request.headers.get("If-Modified-Since");
    const rangeHeader = request.headers.get("Range");

    let object: R2Object | R2ObjectBody | null;

    try {
        object = await env.R2_BUCKET.get(key, {
            onlyIf: {
                etagDoesNotMatch: ifNoneMatch ?? undefined,
                uploadedAfter: ifModifiedSince ? new Date(ifModifiedSince) : undefined,
            },
            range: rangeHeader ? parseRange(rangeHeader) : undefined,
        });
    } catch (e) {
        console.error("R2 get failed", e);
        return error("r2_error", "Failed to retrieve object", 500);
    }

    if (!object) {
        // If we requested a thumbnail and it's not there, try leading base key
        if (key.endsWith("/thumbnail")) {
            const baseKey = key.slice(0, -10);
            try {
                object = await env.R2_BUCKET.get(baseKey, {
                    onlyIf: {
                        etagDoesNotMatch: ifNoneMatch ?? undefined,
                        uploadedAfter: ifModifiedSince ? new Date(ifModifiedSince) : undefined,
                    }
                });
            } catch (e) {
                console.error("R2 fallback get failed", e);
            }
        }
    }

    if (!object) return notFound();

    // Check if it's a 304 (object returned but no body)
    const hasBody = "body" in object && object.body !== null;

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("ETag", `"${object.etag}"`);
    headers.set("Last-Modified", object.uploaded.toUTCString());
    headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE}, immutable`);
    headers.set("Accept-Ranges", "bytes");

    if (object.size) headers.set("Content-Length", String(object.size));

    if (!hasBody) {
        return new Response(null, { status: 304, headers });
    }

    // Partial content
    const status = rangeHeader ? 206 : 200;
    if (rangeHeader && "range" in object && object.range) {
        const r = object.range as { offset: number; length: number };
        headers.set(
            "Content-Range",
            `bytes ${r.offset}-${r.offset + r.length - 1}/${object.size}`
        );
    }

    return new Response((object as R2ObjectBody).body, { status, headers });

}

function parseRange(rangeHeader: string): R2Range | undefined {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) return undefined;

    const offset = parseInt(match[1]!, 10);
    const end = match[2] ? parseInt(match[2], 10) : undefined;

    return end !== undefined
        ? { offset, length: end - offset + 1 }
        : { offset };
}