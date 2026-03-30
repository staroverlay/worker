export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

export function error(code: string, message: string, status: number): Response {
    return json({ error: { code, message } }, status);
}

export function notFound(): Response {
    return error("not_found", "Resource not found", 404);
}

export function methodNotAllowed(): Response {
    return error("method_not_allowed", "Method not allowed", 405);
}

export function unauthorized(code = "unauthorized", msg = "Unauthorized"): Response {
    return error(code, msg, 401);
}

export function forbidden(code = "forbidden", msg = "Forbidden"): Response {
    return error(code, msg, 403);
}

export function badRequest(code: string, msg: string): Response {
    return error(code, msg, 400);
}

export function internalError(msg = "Internal server error"): Response {
    return error("internal_error", msg, 500);
}