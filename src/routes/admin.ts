import type { Context } from "hono";
import { verifyJwt, JwtError } from "../jwt";
import { buildR2Key, publicPath } from "../r2-key";
import { json, unauthorized, badRequest, forbidden, notFound, internalError } from "../response";
import type { AdminTokenPayload, Env } from "../types";

/** POST /admin/initiate
 * Called by the backend to securely initiate a multipart upload.
 */
export async function handleInitiate(c: Context<{ Bindings: Env }>): Promise<Response> {
    const payload = await extractAdminToken(c, "initiate");
    if (payload instanceof Response) return payload;

    const env = c.env;
    const key = buildR2Key(payload);

    // Check for existing object (idempotency guard)
    const existing = await env.R2_BUCKET.head(key);
    if (existing) {
        return badRequest("file_exists", "An object with this ID already exists");
    }

    let multipart: R2MultipartUpload;
    try {
        multipart = await env.R2_BUCKET.createMultipartUpload(key, {
            httpMetadata: { contentType: payload.mimeType || "application/octet-stream" },
            customMetadata: {
                userId: payload.userId,
                fileId: payload.fileId,
                thumbnail: payload.thumbnail ? "true" : "false",
                initiatedAt: new Date().toISOString(),
                clientIp: payload.clientIp || "",
            },
        });
    } catch (e) {
        console.error("R2 createMultipartUpload failed", e);
        return internalError("Failed to initiate multipart upload");
    }

    return json({
        uploadId: multipart.uploadId,
        key,
        fileId: payload.fileId,
    });
}

/** POST /admin/complete
 * Called by the backend after the client signals upload completion.
 * Finalizes the multipart upload in R2.
 */
export async function handleComplete(c: Context<{ Bindings: Env }>): Promise<Response> {
    const payload = await extractAdminToken(c, "complete");
    if (payload instanceof Response) return payload;

    const env = c.env;

    if (!payload.uploadId) {
        return badRequest("missing_upload_id", "uploadId is required in token for complete");
    }
    if (!payload.parts?.length) {
        return badRequest("missing_parts", "parts array is required in token for complete");
    }

    const key = buildR2Key(payload);

    let multipart: R2MultipartUpload;
    try {
        multipart = env.R2_BUCKET.resumeMultipartUpload(key, payload.uploadId);
    } catch {
        return badRequest("invalid_upload", "Could not resume multipart upload");
    }

    let object: R2Object;
    try {
        object = await multipart.complete(
            payload.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
        );
    } catch (e) {
        console.error("R2 complete failed", e);
        return internalError("Failed to complete multipart upload");
    }

    return json({
        fileId: payload.fileId,
        key,
        path: publicPath(key),
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
    });
}

/** POST /admin/abort
 * Called by the backend to cancel an in-progress multipart upload.
 * Cleans up all uploaded parts in R2.
 */
export async function handleAbort(c: Context<{ Bindings: Env }>): Promise<Response> {
    const payload = await extractAdminToken(c, "abort");
    if (payload instanceof Response) return payload;

    const env = c.env;

    if (!payload.uploadId) {
        return badRequest("missing_upload_id", "uploadId is required in token for abort");
    }

    const key = buildR2Key(payload);

    let multipart: R2MultipartUpload;
    try {
        multipart = env.R2_BUCKET.resumeMultipartUpload(key, payload.uploadId);
    } catch {
        return badRequest("invalid_upload", "Could not resume multipart upload");
    }

    try {
        await multipart.abort();
    } catch (e) {
        console.error("R2 abort failed", e);
        return internalError("Failed to abort multipart upload");
    }

    return json({ fileId: payload.fileId, aborted: true });
}

/** DELETE /admin/delete
 * Called by the backend to permanently remove an object from R2.
 * Also removes the thumbnail variant if it exists.
 */
export async function handleDelete(c: Context<{ Bindings: Env }>): Promise<Response> {
    const payload = await extractAdminToken(c, "delete");
    if (payload instanceof Response) return payload;

    const env = c.env;
    const key = buildR2Key(payload);
    const thumbnailKey = buildR2Key({ ...payload, thumbnail: true });

    // Check object exists before attempting deletion
    const head = await env.R2_BUCKET.head(key);
    if (!head) {
        return notFound();
    }

    try {
        await env.R2_BUCKET.delete(key);

        // Best-effort thumbnail deletion (may not exist)
        const thumbHead = await env.R2_BUCKET.head(thumbnailKey);
        if (thumbHead) {
            await env.R2_BUCKET.delete(thumbnailKey);
        }
    } catch (e) {
        console.error("R2 delete failed", e);
        return internalError("Failed to delete object");
    }

    return json({ fileId: payload.fileId, deleted: true });
}

// Internal helpers

async function extractAdminToken(
    c: Context<{ Bindings: Env }>,
    expectedPurpose: AdminTokenPayload["purpose"]
): Promise<AdminTokenPayload | Response> {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        console.error("No bearer")
        return unauthorized("missing_token", "Authorization: Bearer <token> required");
    }

    const token = authHeader.slice(7);

    try {
        const raw = await verifyJwt(token, c.env.UPLOAD_SECRET);
        if (raw.purpose !== expectedPurpose) {
            return forbidden("wrong_purpose", `Token purpose must be '${expectedPurpose}'`);
        }
        return raw as AdminTokenPayload;
    } catch (e) {
        if (e instanceof JwtError) {
            return unauthorized(e.code, e.message);
        }
        return unauthorized("token_error", "Token validation failed");
    }
}