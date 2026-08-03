/**
 * Task 015.1: Express adapter — auto-capture request context (endpoint/method/statusCode)
 *
 * Optional, opt-in subpath export (`@tiny-owl-kit/observability/express`).
 * Does NOT change the core `EchoNova` log API — this only wraps it.
 *
 * Privacy (non-negotiable): only `method`, `endpoint` (route template) and
 * `statusCode` are captured automatically. Request bodies, query strings,
 * headers, and cookies are never auto-captured — callers can still pass
 * additional context explicitly per log call.
 */

import type { Request, RequestHandler, ErrorRequestHandler } from "express";
import type { EchoNova } from "./index.js";

/** Request/route context automatically attached to every event logged via `req.tinyowl`. */
export interface TinyowlRequestContext extends Record<string, unknown> {
  method: string;
  endpoint: string;
}

/**
 * Prefer the matched route template (e.g. `/users/:id`) over the raw URL to
 * keep event cardinality low. Falls back to the raw path when Express hasn't
 * matched a route yet (e.g. a 404 with no matching route).
 */
function resolveRequestContext(req: Request): TinyowlRequestContext {
  const routePath = (req.route as { path?: string } | undefined)?.path;
  const endpoint = routePath
    ? `${req.baseUrl ?? ""}${routePath}` || "/"
    : req.path || req.originalUrl?.split("?")[0] || "/";

  return { method: req.method, endpoint };
}

/**
 * Per-request scoped logger attached to `req.tinyowl`. Wraps an `EchoNova`
 * instance and resolves the request context lazily at call time (not at
 * middleware-entry time), so events logged from inside a route handler pick
 * up the final matched route template rather than the raw incoming path.
 *
 * One instance per request — no shared mutable state, so concurrent requests
 * never leak context into each other.
 */
export class TinyowlRequestLogger {
  constructor(
    private readonly client: EchoNova,
    private readonly req: Request,
  ) {}

  private context(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...resolveRequestContext(this.req), ...extra };
  }

  info(message: string, context: Record<string, unknown> = {}) {
    return this.client.info(message, this.context(context));
  }

  warning(message: string, context: Record<string, unknown> = {}) {
    return this.client.warning(message, this.context(context));
  }

  error(message: string, context: Record<string, unknown> = {}) {
    return this.client.error(message, this.context(context));
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Per-request scoped logger auto-populated by `tinyowlExpress()`. */
      tinyowl?: TinyowlRequestLogger;
    }
  }
}

function tinyowlExpressMiddlewareFactory(client: EchoNova): RequestHandler {
  return function tinyowlExpressMiddleware(req, _res, next) {
    req.tinyowl = new TinyowlRequestLogger(client, req);
    next();
  };
}

/** Resolve the HTTP status code to report for an unhandled error. */
function resolveStatusCode(err: unknown, currentStatusCode: number): number {
  if (currentStatusCode >= 400) return currentStatusCode;
  if (err && typeof err === "object") {
    const candidate = err as { statusCode?: unknown; status?: unknown };
    if (typeof candidate.statusCode === "number") return candidate.statusCode;
    if (typeof candidate.status === "number") return candidate.status;
  }
  return 500;
}

function tinyowlExpressErrorHandlerFactory(
  client: EchoNova,
): ErrorRequestHandler {
  return function tinyowlExpressErrorMiddleware(err, req, res, next) {
    const logger = req.tinyowl ?? new TinyowlRequestLogger(client, req);
    const statusCode = resolveStatusCode(err, res.statusCode);
    const message = err instanceof Error ? err.message : String(err);

    // Fire-and-forget — a logging failure must never break the app's error flow.
    logger.error(message, { statusCode }).catch(() => {});

    // Never swallow the error — the application's own error handling still runs.
    next(err);
  };
}

/** Callable middleware factory with an attached `.errorHandler` factory. */
export interface TinyowlExpressAdapter {
  /**
   * Attaches `req.tinyowl`, a per-request scoped logger that auto-fills
   * `context.endpoint` / `context.method` on every log call.
   *
   * Mount before your routes:
   * ```ts
   * app.use(tinyowlExpress(client));
   * ```
   */
  (client: EchoNova): RequestHandler;
  /**
   * Express error-handling middleware: auto-logs uncaught errors with the
   * request's `endpoint` / `method` / `statusCode`, then forwards to
   * `next(err)` so the application's own error response logic still runs.
   *
   * Mount after your routes (Express requires 4-arg error middleware last):
   * ```ts
   * app.use(tinyowlExpress.errorHandler(client));
   * ```
   */
  errorHandler(client: EchoNova): ErrorRequestHandler;
}

export const tinyowlExpress =
  tinyowlExpressMiddlewareFactory as TinyowlExpressAdapter;
tinyowlExpress.errorHandler = tinyowlExpressErrorHandlerFactory;
