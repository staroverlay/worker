import type { Context } from "hono";
import { json, error, badRequest, internalError } from "../response";
import type { Env } from "../types";

/** PUT /upload/part
 * Uploads a single part. Query params: uploadId, partNumber, key.
 * Body is raw bytes for the part (min 5 MiB except last part).
 */
export async function handleUploadPart(c: Context<{ Bindings: Env }>): Promise<Response> {
    const { uploadId, partNumber: partNumberStr, key } = c.req.query();
    const env = c.env;

    if (!uploadId || !partNumberStr || !key) {
        return badRequest("missing_params", "uploadId, partNumber, and key are required");
    }

    const partNumber = parseInt(partNumberStr, 10);
    if (isNaN(partNumber) || partNumber < 1 || partNumber > 10000) {
        return badRequest("invalid_part_number", "partNumber must be between 1 and 10000");
    }

    const body = c.req.raw.body;
    if (!body) {
        return badRequest("missing_body", "Request body is required");
    }

    let multipart: R2MultipartUpload;
    try {
        multipart = env.R2_BUCKET.resumeMultipartUpload(key, uploadId);
    } catch (e) {
        return badRequest("invalid_upload", "Could not resume upload — invalid uploadId or key");
    }

    let uploadedPart: R2UploadedPart;
    try {
        uploadedPart = await multipart.uploadPart(partNumber, body);
    } catch (e) {
        console.error("R2 uploadPart failed", e);
        return internalError("Part upload failed");
    }

    return json({
        partNumber,
        etag: uploadedPart.etag,
    });
}