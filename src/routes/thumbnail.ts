import type { Context } from "hono";
import { verifyJwt, JwtError } from "../jwt";
import { buildR2Key } from "../r2-key";
import { json, unauthorized, badRequest, forbidden, internalError } from "../response";
import type { UploadTokenPayload, Env } from "../types";

/**
 * POST /thumbnail
 * Receives a direct upload for a file thumbnail.
 * Requires a signed 'thumbnail: true' client token.
 */
export async function handleThumbnailUpload(c: Context<{ Bindings: Env }>): Promise<Response> {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return unauthorized("missing_token", "Authorization: Bearer <token> required");
    }

    const token = authHeader.slice(7);
    let payload: UploadTokenPayload;

    try {
        // Verify using client JWT secret (not admin secret)
        payload = await verifyJwt(token, c.env.UPLOAD_JWT) as UploadTokenPayload;
    } catch (e) {
        if (e instanceof JwtError) return unauthorized(e.code, e.message);
        return unauthorized("token_error", "Token validation failed");
    }

    // Guard rails
    if (payload.purpose !== "upload" || !payload.thumbnail) {
        return forbidden("wrong_purpose", "Token must be a thumbnail upload token");
    }

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
        return badRequest("missing_body", "Thumbnail body is required");
    }

    // Enforce size limit from token
    if (body.byteLength > payload.maxBytes) {
        return badRequest("too_large", `Thumbnail exceeds allowed size of ${payload.maxBytes} bytes`);
    }

    const key = buildR2Key({ ...payload, thumbnail: true });

    try {
        await c.env.R2_BUCKET.put(key, body, {
            httpMetadata: { contentType: payload.mimeType || "image/jpeg" },
            customMetadata: {
                userId: payload.userId,
                fileId: payload.fileId,
                thumbnail: "true",
                uploadedAt: new Date().toISOString(),
                clientIp: payload.clientIp || "",
            },
        });
    } catch (e) {
        console.error("R2 put failed for thumbnail", e);
        return internalError("Failed to store thumbnail");
    }

    return json({
        success: true,
        fileId: payload.fileId,
        size: body.byteLength,
        key,
    });
}
