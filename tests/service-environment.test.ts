/**
 * Tests for the `service` and `environment` client options.
 *
 * Both fields are sent top-level and signed only when configured, in the same
 * key order the backend uses when it rebuilds the HMAC payload.
 */

import { jest } from "@jest/globals";
import { EchoNova } from "../src/index.js";
import { signPayload } from "../src/security.js";

type FetchInit = { body: string; headers: Record<string, string> };

function mockFetch() {
  const fetchMock = jest.fn(async (_url: string, _init: FetchInit) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ success: true }),
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof mockFetch>): FetchInit {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return call![1];
}

describe("EchoNova service and environment options", () => {
  const projectSecret = "test-project-secret";

  it("sends service and environment top-level and signs them in backend key order", async () => {
    const fetchMock = mockFetch();
    const client = new EchoNova({
      apiKey: "key",
      projectSecret,
      autoTraceId: false,
      service: "checkout",
      environment: "production",
    });

    await client.info("order placed", { orderId: 42 });

    const { body, headers } = lastCall(fetchMock);
    const parsed = JSON.parse(body);
    expect(parsed.service).toBe("checkout");
    expect(parsed.environment).toBe("production");

    const expectedSignature = signPayload(
      {
        message: "order placed",
        severity: "info",
        context: { orderId: 42 },
        service: "checkout",
        environment: "production",
        timestamp: headers["x-timestamp"],
        nonce: headers["x-nonce"],
      },
      projectSecret,
    );
    expect(headers["x-signature"]).toBe(expectedSignature);
  });

  it("omits service and environment from body and signature when not configured", async () => {
    const fetchMock = mockFetch();
    const client = new EchoNova({
      apiKey: "key",
      projectSecret,
      autoTraceId: false,
    });

    await client.info("plain event");

    const { body, headers } = lastCall(fetchMock);
    const parsed = JSON.parse(body);
    expect(parsed).not.toHaveProperty("service");
    expect(parsed).not.toHaveProperty("environment");

    const expectedSignature = signPayload(
      {
        message: "plain event",
        severity: "info",
        context: {},
        timestamp: headers["x-timestamp"],
        nonce: headers["x-nonce"],
      },
      projectSecret,
    );
    expect(headers["x-signature"]).toBe(expectedSignature);
  });

  it("propagates service and environment to child instances from withContext", async () => {
    const fetchMock = mockFetch();
    const parent = new EchoNova({
      apiKey: "key",
      projectSecret,
      autoTraceId: false,
      service: "api",
      environment: "staging",
    });

    await parent.withContext({ requestId: "r1" }).info("child event");

    const parsed = JSON.parse(lastCall(fetchMock).body);
    expect(parsed.service).toBe("api");
    expect(parsed.environment).toBe("staging");
  });
});
