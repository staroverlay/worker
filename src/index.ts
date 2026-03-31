import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { handleUploadPart } from "./routes/upload";
import { handleThumbnailUpload } from "./routes/thumbnail";
import { handleInitiate, handleComplete, handleAbort, handleDelete } from "./routes/admin";
import { handleServe } from "./routes/serve";
import { error, notFound } from "./response";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use("*", cors({
    origin: "*", // Adjust as needed for production security
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowHeaders: ["Authorization", "Content-Type", "Content-Length", "If-None-Match", "If-Modified-Since", "Range"],
    exposeHeaders: ["Content-Length", "Content-Range", "ETag", "Accept-Ranges"],
    maxAge: 86400,
}));

// ── Env Check ──────────────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
    if (!c.env.UPLOAD_SECRET) {
        return error("internal_error", "UPLOAD_SECRET is not set", 500);
    }

    if (!c.env.UPLOAD_JWT) {
        return error("internal_error", "UPLOAD_JWT is not set", 500);
    }

    return next();
});

// ── Health check ──────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

// ── Public file serving ───────────────────────────────────────────────────
// GET /usercontent/<userId>/<fileId>[/thumbnail]
app.get("/usercontent/:userId/:fileId/:thumbnail?", async (c) => {
    // Reconstruct key to be compatible with existing logic: usercontent/userId/fileId[/thumbnail]
    const { userId, fileId, thumbnail } = c.req.param();
    let key = `usercontent/${userId}/${fileId}`;
    if (thumbnail === "thumbnail") key += "/thumbnail";
    else if (thumbnail) return c.notFound(); // Only allow /thumbnail or nothing

    return handleServe(c, key);
});

// ── Client upload endpoints ────────────────────────────────────────────────
// Unauthenticated
app.put("/upload/part", (c) => handleUploadPart(c));
app.post("/thumbnail", (c) => handleThumbnailUpload(c));

app.post("/admin/initiate", (c) => handleInitiate(c));
app.post("/admin/complete", (c) => handleComplete(c));
app.post("/admin/abort", (c) => handleAbort(c));
app.delete("/admin/delete", (c) => handleDelete(c));

// Error handling
app.onError((err, c) => {
    console.error("Unhandled worker error", err);
    return error("internal_error", "An unexpected error occurred", 500);
});

app.notFound(() => notFound());

export default app;