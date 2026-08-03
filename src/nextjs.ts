/**
 * Task 015.1 Phase 2: Next.js adapter — auto-capture request context (endpoint/method/statusCode)
 *
 * Optional, opt-in subpath export (`@tiny-owl-kit/observability/nextjs`) for App Router
 * Route Handlers (`route.ts`). Does NOT change the core `EchoNova` log API — this only wraps it.
 *
 * Deliberately does NOT import `next/server`: Next's `.d.ts` chain transitively pulls in
 * React/webpack-internal types that only resolve inside a full Next.js app's tsconfig, not
 * in this SDK's standalone build. Instead, `withTinyowl` accepts any request object that is
 * structurally compatible with Next's `NextRequest` — real `NextRequest` values already
 * satisfy this shape, so callers can pass one in directly with no extra casting.
 *
 * Privacy (non-negotiable): only `method`, `endpoint` and `statusCode` are captured
 * automatically. Request bodies, query strings, headers, and cookies are never
 * auto-captured — callers can still pass additional context explicitly per log call.
 */

import type { EchoNova } from "./index.js";

/** Structural subset of Next.js's `NextRequest` that this adapter actually reads. */
export interface TinyowlNextRequestLike {
  method: string;
  url: string;
  nextUrl?: { pathname?: string };
}

/** Request context automatically attached to every event logged by `withTinyowl`. */
export interface TinyowlRequestContext extends Record<string, unknown> {
  method: string;
  endpoint: string;
}

/**
 * Next.js Route Handlers don't expose a matched-route template at runtime (unlike
 * Express's `req.route.path`), so this resolves to the concrete request path.
 * Pass `options.route` (e.g. `/users/[id]`) to keep cardinality low on dynamic routes.
 */
function resolveRequestContext(
  req: TinyowlNextRequestLike,
): TinyowlRequestContext {
  const endpoint = req.nextUrl?.pathname || new URL(req.url).pathname || "/";
  return { method: req.method, endpoint };
}

export interface WithTinyowlOptions {
  /** Low-cardinality route template to report instead of the concrete path (e.g. `/users/[id]`). */
  route?: string;
}

type RouteHandler<Req extends TinyowlNextRequestLike, Ctx> = (
  req: Req,
  ctx: Ctx,
) => Promise<Response> | Response;

/**
 * Wrap an App Router Route Handler to auto-log the response status (and any thrown
 * error) with `{ method, endpoint, statusCode }`.
 *
 * ```ts
 * export const GET = withTinyowl(client, async (req) => {
 *   return Response.json({ ok: true });
 * });
 * ```
 *
 * - Responses with `status >= 400` are logged as errors; thrown errors are logged
 *   as `statusCode: 500` and then re-thrown, so Next's own error handling still runs.
 * - Fire-and-forget logging — a logging failure never breaks the route's response.
 */
export function withTinyowl<Req extends TinyowlNextRequestLike, Ctx = unknown>(
  client: EchoNova,
  handler: RouteHandler<Req, Ctx>,
  options: WithTinyowlOptions = {},
): RouteHandler<Req, Ctx> {
  return async function tinyowlRouteHandler(
    req: Req,
    ctx: Ctx,
  ): Promise<Response> {
    const { method, endpoint } = resolveRequestContext(req);
    const finalEndpoint = options.route ?? endpoint;

    try {
      const response = await handler(req, ctx);
      if (response.status >= 400) {
        client
          .error(`${method} ${finalEndpoint} responded ${response.status}`, {
            method,
            endpoint: finalEndpoint,
            statusCode: response.status,
          })
          .catch(() => {});
      }
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      client
        .error(message, {
          method,
          endpoint: finalEndpoint,
          statusCode: 500,
        })
        .catch(() => {});
      // Never swallow the error — Next's own error handling still runs.
      throw err;
    }
  };
}
