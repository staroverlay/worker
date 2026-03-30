import type { TokenPayload } from "./types";

const ALG = { name: "HMAC", hash: "SHA-256" } as const;
const MAX_TOKEN_TTL_SECONDS = 3600; // 1 hour hard cap

function base64url(data: Uint8Array | ArrayBuffer): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlDecode(str: string): ArrayBuffer {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function importKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        ALG,
        false,
        ["sign", "verify"]
    );
}

export async function signJwt(payload: Omit<TokenPayload, "iat" | "exp"> & { iat?: number; exp?: number }, secret: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const iat = payload.iat ?? now;
    const exp = payload.exp ?? now + MAX_TOKEN_TTL_SECONDS;

    if (exp - iat > MAX_TOKEN_TTL_SECONDS) {
        throw new Error(`Token TTL exceeds maximum of ${MAX_TOKEN_TTL_SECONDS}s`);
    }

    const header = { alg: "HS256", typ: "JWT" };
    const fullPayload = { ...payload, iat, exp };

    const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(fullPayload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await importKey(secret);
    const sig = await crypto.subtle.sign(ALG.name, key, new TextEncoder().encode(signingInput));

    return `${signingInput}.${base64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<TokenPayload> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new JwtError("malformed_token", "Token must have 3 parts");

    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
        ALG.name,
        key,
        base64urlDecode(sigB64),
        new TextEncoder().encode(signingInput)
    );

    if (!valid) throw new JwtError("invalid_signature", "Signature verification failed");

    let payload: TokenPayload;
    try {
        payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    } catch {
        throw new JwtError("malformed_token", "Payload is not valid JSON");
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new JwtError("token_expired", `Token expired at ${payload.exp}`);
    if (payload.iat > now + 60) throw new JwtError("token_not_yet_valid", "Token iat is in the future");

    return payload;
}

export class JwtError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = "JwtError";
    }
}