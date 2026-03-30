/** Payload for user upload initiation token (issued by backend, used by client) */
export interface UploadTokenPayload {
    /** Token purpose discriminator */
    purpose: "upload";
    /** Unique file ID (UUID) — also becomes the R2 key suffix */
    fileId: string;
    /** Max allowed file size in bytes */
    maxBytes: number;
    /** Allowed MIME type (e.g. "image/jpeg") */
    mimeType: string;
    /** IP address of the uploading client (validated at upload time) */
    clientIp: string;
    /** Owner type — currently only "user" is supported */
    ownerType: "user";
    /** Owner's user ID */
    userId: string;
    /** Whether this upload is for a thumbnail variant */
    thumbnail?: boolean;
    /** R2 multipart upload ID — set after initiation, before part uploads */
    uploadId?: string;
    /** Standard JWT issued-at */
    iat: number;
    /** Standard JWT expiry (max 1 hour from iat) */
    exp: number;
}

/** Payload for backend-signed admin action tokens */
export interface AdminTokenPayload {
    /** Token purpose discriminator */
    purpose: "initiate" | "complete" | "abort" | "delete";
    /** Target file ID */
    fileId: string;
    /** Owner type */
    ownerType: "user";
    /** Owner's user ID */
    userId: string;
    /** For "initiate" */
    mimeType?: string;
    clientIp?: string;
    /** For "complete": the multipart upload ID to finalize */
    uploadId?: string;
    /** For "complete": ETags per part, in order */
    parts?: Array<{ partNumber: number; etag: string }>;
    /** Whether the action targets the thumbnail variant */
    thumbnail?: boolean;
    /** Standard JWT fields */
    iat: number;
    exp: number;
}

export interface Env {
    R2_BUCKET: R2Bucket;
    /** Shared secret for signing/verifying JWTs between worker and backend */
    UPLOAD_JWT: string;
    /** Optional separate secret for backend-only admin operations */
    UPLOAD_SECRET: string;
    ENVIRONMENT: string;
}

export type TokenPayload = UploadTokenPayload | AdminTokenPayload;