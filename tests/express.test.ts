/**
 * Task 015.1: Tests for the optional Express adapter (`src/express.ts`)
 *
 * Verifies auto-capture of endpoint/method/statusCode, low-cardinality route
 * templating, concurrency-safety (no context leaking across requests), and
 * that the error handler never swallows or blocks the app's own error flow.
 */

import { jest } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";
import type { EchoNova } from "../src/index.js";
import { tinyowlExpress, TinyowlRequestLogger } from "../src/express.js";

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

function makeMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/users/123",
    originalUrl: "/users/123",
    baseUrl: "",
    route: undefined,
    ...overrides,
  } as unknown as Request;
}

describe("tinyowlExpress middleware", () => {
  it("attaches req.tinyowl as a TinyowlRequestLogger instance", () => {
    const client = makeMockClient();
    const middleware = tinyowlExpress(client);
    const req = makeMockRequest();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, {} as Response, next);

    expect(req.tinyowl).toBeInstanceOf(TinyowlRequestLogger);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not capture request body, query string, headers, or cookies", () => {
    const client = makeMockClient();
    const middleware = tinyowlExpress(client);
    const req = makeMockRequest({
      body: { password: "secret" },
      query: { token: "abc" },
      headers: { authorization: "Bearer xyz" },
      cookies: { session: "abc123" },
    } as Partial<Request>);
    middleware(req, {} as Response, jest.fn() as unknown as NextFunction);

    req.tinyowl!.info("test message");

    const loggedContext = client.info.mock.calls[0]![1];
    expect(loggedContext).toEqual({ method: "GET", endpoint: "/users/123" });
  });
});

describe("TinyowlRequestLogger", () => {
  it("auto-fills method and endpoint (raw path fallback) on info/warning/error", async () => {
    const client = makeMockClient();
    const req = makeMockRequest({ method: "POST", path: "/orders" });
    const logger = new TinyowlRequestLogger(client, req);

    await logger.info("order created", { orderId: "o1" });
    await logger.warning("slow query");
    await logger.error("failed to charge card");

    expect(client.info).toHaveBeenCalledWith("order created", {
      method: "POST",
      endpoint: "/orders",
      orderId: "o1",
    });
    expect(client.warning).toHaveBeenCalledWith("slow query", {
      method: "POST",
      endpoint: "/orders",
    });
    expect(client.error).toHaveBeenCalledWith("failed to charge card", {
      method: "POST",
      endpoint: "/orders",
    });
  });

  it("prefers the matched route template over the raw path (low cardinality)", () => {
    const client = makeMockClient();
    const req = makeMockRequest({
      method: "GET",
      path: "/users/123",
      baseUrl: "/api",
      route: { path: "/users/:id" } as unknown as Request["route"],
    });
    const logger = new TinyowlRequestLogger(client, req);

    logger.info("fetched user");

    expect(client.info).toHaveBeenCalledWith("fetched user", {
      method: "GET",
      endpoint: "/api/users/:id",
    });
  });

  it("call-site context overrides only add keys, base method/endpoint always present", () => {
    const client = makeMockClient();
    const req = makeMockRequest();
    const logger = new TinyowlRequestLogger(client, req);

    logger.info("custom", { endpoint: "/custom-override" });

    // Call-site context wins on key conflicts (documented merge order).
    expect(client.info).toHaveBeenCalledWith("custom", {
      method: "GET",
      endpoint: "/custom-override",
    });
  });

  it("does not leak context across concurrent requests (no shared mutable state)", () => {
    const client = makeMockClient();
    const reqA = makeMockRequest({ method: "GET", path: "/a" });
    const reqB = makeMockRequest({ method: "POST", path: "/b" });

    const loggerA = new TinyowlRequestLogger(client, reqA);
    const loggerB = new TinyowlRequestLogger(client, reqB);

    // Interleave calls as if two requests were being handled concurrently.
    loggerA.info("first from A");
    loggerB.info("first from B");
    loggerA.info("second from A");

    expect(client.info).toHaveBeenNthCalledWith(1, "first from A", {
      method: "GET",
      endpoint: "/a",
    });
    expect(client.info).toHaveBeenNthCalledWith(2, "first from B", {
      method: "POST",
      endpoint: "/b",
    });
    expect(client.info).toHaveBeenNthCalledWith(3, "second from A", {
      method: "GET",
      endpoint: "/a",
    });
  });
});

describe("tinyowlExpress.errorHandler", () => {
  function makeMockResponse(statusCode = 200): Response {
    return { statusCode } as unknown as Response;
  }

  it("auto-logs the error with method/endpoint/statusCode and forwards to next(err)", () => {
    const client = makeMockClient();
    const handler = tinyowlExpress.errorHandler(client);
    const req = makeMockRequest({ method: "GET", path: "/boom" });
    const res = makeMockResponse(200);
    const err = new Error("Something broke");
    const next = jest.fn() as unknown as NextFunction;

    handler(err, req, res, next);

    expect(client.error).toHaveBeenCalledWith("Something broke", {
      method: "GET",
      endpoint: "/boom",
      statusCode: 500,
    });
    expect(next).toHaveBeenCalledWith(err);
  });

  it("prefers an already-set 4xx/5xx response status over the error's own status", () => {
    const client = makeMockClient();
    const handler = tinyowlExpress.errorHandler(client);
    const req = makeMockRequest();
    const res = makeMockResponse(404);
    const err = Object.assign(new Error("Not found"), { statusCode: 500 });

    handler(err, req, res, jest.fn() as unknown as NextFunction);

    expect(client.error).toHaveBeenCalledWith(
      "Not found",
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("falls back to the error's statusCode/status property when response has no status yet", () => {
    const client = makeMockClient();
    const handler = tinyowlExpress.errorHandler(client);
    const req = makeMockRequest();
    const res = makeMockResponse(200);
    const err = Object.assign(new Error("Bad input"), { status: 400 });

    handler(err, req, res, jest.fn() as unknown as NextFunction);

    expect(client.error).toHaveBeenCalledWith(
      "Bad input",
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("reuses req.tinyowl when the middleware already ran", () => {
    const client = makeMockClient();
    const req = makeMockRequest({ method: "GET", path: "/reused" });
    tinyowlExpress(client)(
      req,
      {} as Response,
      jest.fn() as unknown as NextFunction,
    );
    const existingLogger = req.tinyowl;

    tinyowlExpress.errorHandler(client)(
      new Error("oops"),
      req,
      makeMockResponse(),
      jest.fn() as unknown as NextFunction,
    );

    expect(req.tinyowl).toBe(existingLogger);
  });

  it("never throws even if the underlying log call rejects", async () => {
    const client = makeMockClient();
    client.error.mockRejectedValueOnce(new Error("network down"));
    const handler = tinyowlExpress.errorHandler(client);
    const req = makeMockRequest();
    const res = makeMockResponse();
    const next = jest.fn() as unknown as NextFunction;

    expect(() => handler(new Error("boom"), req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalled();

    // Let the fire-and-forget rejection settle without an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
