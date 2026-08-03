/**
 * Task 015.1 Phase 2: Tests for the optional Next.js adapter (`src/nextjs.ts`)
 *
 * Verifies auto-capture of endpoint/method/statusCode on the response and on
 * thrown errors, low-cardinality route override, privacy (no body/query/header
 * capture), and that errors/non-2xx responses are never swallowed.
 */

import { jest } from "@jest/globals";
import type { EchoNova } from "../src/index.js";
import { withTinyowl } from "../src/nextjs.js";
import type { TinyowlNextRequestLike } from "../src/nextjs.js";

type LogFn = (
  message: string,
  context?: Record<string, unknown>,
) => Promise<{ success: boolean }>;

function makeMockClient() {
  return {
    info: jest.fn<LogFn>().mockResolvedValue({ success: true }),
    warning: jest.fn<LogFn>().mockResolvedValue({ success: true }),
    error: jest.fn<LogFn>().mockResolvedValue({ success: true }),
  } as unknown as EchoNova & {
    info: jest.Mock<LogFn>;
    warning: jest.Mock<LogFn>;
    error: jest.Mock<LogFn>;
  };
}

function makeMockRequest(
  overrides: Partial<TinyowlNextRequestLike> = {},
): TinyowlNextRequestLike {
  return {
    method: "GET",
    url: "https://example.com/users/123",
    nextUrl: { pathname: "/users/123" },
    ...overrides,
  };
}

describe("withTinyowl", () => {
  it("does not log anything for a successful (< 400) response", async () => {
    const client = makeMockClient();
    const handler = withTinyowl(client, async () =>
      Response.json({ ok: true }),
    );

    const res = await handler(makeMockRequest(), undefined);

    expect(res.status).toBe(200);
    expect(client.error).not.toHaveBeenCalled();
  });

  it("auto-logs method/endpoint/statusCode when the response status is >= 400", async () => {
    const client = makeMockClient();
    const handler = withTinyowl(client, async () =>
      Response.json({ error: "not found" }, { status: 404 }),
    );

    await handler(
      makeMockRequest({ method: "GET", nextUrl: { pathname: "/users/123" } }),
      undefined,
    );

    expect(client.error).toHaveBeenCalledWith("GET /users/123 responded 404", {
      method: "GET",
      endpoint: "/users/123",
      statusCode: 404,
    });
  });

  it("prefers options.route (low cardinality) over the concrete path", async () => {
    const client = makeMockClient();
    const handler = withTinyowl(
      client,
      async () => Response.json({}, { status: 500 }),
      { route: "/users/[id]" },
    );

    await handler(
      makeMockRequest({ nextUrl: { pathname: "/users/123" } }),
      undefined,
    );

    expect(client.error).toHaveBeenCalledWith(
      expect.stringContaining("/users/[id]"),
      expect.objectContaining({ endpoint: "/users/[id]" }),
    );
  });

  it("falls back to the URL pathname when nextUrl is absent", async () => {
    const client = makeMockClient();
    const handler = withTinyowl(client, async () =>
      Response.json({}, { status: 400 }),
    );

    await handler(
      { method: "GET", url: "https://example.com/orders" },
      undefined,
    );

    expect(client.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ endpoint: "/orders" }),
    );
  });

  it("auto-logs a thrown error as statusCode 500 and re-throws it unchanged", async () => {
    const client = makeMockClient();
    const boom = new Error("db unreachable");
    const handler = withTinyowl(client, async () => {
      throw boom;
    });

    await expect(
      handler(makeMockRequest({ method: "POST" }), undefined),
    ).rejects.toBe(boom);

    expect(client.error).toHaveBeenCalledWith("db unreachable", {
      method: "POST",
      endpoint: "/users/123",
      statusCode: 500,
    });
  });

  it("does not capture request body, query string, or headers", async () => {
    const client = makeMockClient();
    const handler = withTinyowl(client, async () =>
      Response.json({}, { status: 500 }),
    );
    const req = makeMockRequest();
    (req as unknown as { headers: unknown }).headers = {
      authorization: "Bearer xyz",
    };

    await handler(req, undefined);

    const loggedContext = client.error.mock.calls[0]![1];
    expect(loggedContext).toEqual({
      method: "GET",
      endpoint: "/users/123",
      statusCode: 500,
    });
  });

  it("never throws even if the underlying log call rejects", async () => {
    const client = makeMockClient();
    client.error.mockRejectedValueOnce(new Error("network down"));
    const handler = withTinyowl(client, async () =>
      Response.json({}, { status: 503 }),
    );

    const res = await handler(makeMockRequest(), undefined);

    expect(res.status).toBe(503);
    // Let the fire-and-forget rejection settle without an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
