import type { UploadTokenPayload, AdminTokenPayload } from "./types";

/**
 * Builds the R2 object key for a given token payload.
 *
 * Layout:
 *   usercontent/<userId>/<fileId>            — user file
 *   usercontent/<userId>/<fileId>/thumbnail  — user file thumbnail
 */
export function buildR2Key(
    payload: Pick<UploadTokenPayload | AdminTokenPayload, "ownerType" | "userId" | "fileId"> & { thumbnail?: boolean }
): string {
    const base = `usercontent/${payload.userId}/${payload.fileId}`;
    return payload.thumbnail ? `${base}/thumbnail` : base;
}

/**
 * Returns the public-facing URL path for a key.
 * e.g. /usercontent/<userId>/<fileId>
 */
export function publicPath(key: string): string {
    return `/${key}`;
}