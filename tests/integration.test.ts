/**
 * Task 5.7: Integration Tests and initTinyIT Function Tests
 * Tests the main entry point and integration between components
 */

import { jest } from "@jest/globals";
import { initTinyIT, TinyITLogger } from "../src/index.js";

const mockFetch = globalThis.fetch as jest.MockedFunction<
  (...args: any[]) => Promise<any>
>;

describe("initTinyIT Integration", () => {
  const validConfig = {
    apiUrl: "https://api.test.com",
    apiKey: "test-api-key",
  };

  describe("Configuration Validation", () => {
    it("should create TinyIT instance with valid configuration", () => {
      const tinyit = initTinyIT(validConfig);
      expect(tinyit).toBeInstanceOf(TinyITLogger);
    });

    it("should throw error when apiUrl is missing", () => {
      expect(() => initTinyIT({ apiKey: "test-key" } as any)).toThrow(
        "TinyIT: Missing apiUrl or apiKey",
      );
    });

    it("should throw error when apiKey is missing", () => {
      expect(() =>
        initTinyIT({ apiUrl: "https://api.test.com" } as any),
      ).toThrow("TinyIT: Missing apiUrl or apiKey");
    });

    it("should throw error when both apiUrl and apiKey are missing", () => {
      expect(() => initTinyIT({} as any)).toThrow(
        "TinyIT: Missing apiUrl or apiKey",
      );
    });

    it("should throw error when apiUrl is not a string", () => {
      expect(() =>
        initTinyIT({ apiUrl: 123, apiKey: "test-key" } as any),
      ).toThrow("TinyIT: apiUrl and apiKey must be strings");
    });

    it("should throw error when apiKey is not a string", () => {
      expect(() =>
        initTinyIT({ apiUrl: "https://api.test.com", apiKey: 123 } as any),
      ).toThrow("TinyIT: apiUrl and apiKey must be strings");
    });

    it("should throw error when apiUrl is invalid URL format", () => {
      expect(() =>
        initTinyIT({ apiUrl: "not-a-url", apiKey: "test-key" }),
      ).toThrow("TinyIT: Invalid apiUrl format");
    });

    it("should accept valid URL formats", () => {
      const validUrls = [
        "https://api.test.com",
        "http://localhost:3000",
        "https://subdomain.example.com/api/v1",
        "http://127.0.0.1:8080",
      ];

      validUrls.forEach((apiUrl) => {
        expect(() => initTinyIT({ apiUrl, apiKey: "test-key" })).not.toThrow();
      });
    });
  });

  describe("Configuration Options", () => {
    it("should pass through project secret", () => {
      const config = {
        ...validConfig,
        projectSecret: "test-secret",
      };

      const tinyit = initTinyIT(config);
      const status = tinyit.getStatus();

      expect(status.client.config.hasProjectSecret).toBe(true);
    });

    it("should pass through additional options", () => {
      const config = {
        ...validConfig,
        options: {
          maxRetries: 5,
          timeout: 10000,
          enableSecurity: false,
        },
      };

      const tinyit = initTinyIT(config);
      const status = tinyit.getStatus();

      expect(status.client.config.maxRetries).toBe(5);
      expect(status.client.config.timeout).toBe(10000);
      expect(status.client.config.securityEnabled).toBe(false);
    });

    it("should handle empty options object", () => {
      const config = {
        ...validConfig,
        options: {},
      };

      expect(() => initTinyIT(config)).not.toThrow();
    });
  });

  describe("Return Value", () => {
    it("should return working logger instance", async () => {
      const tinyit = initTinyIT(validConfig);

      // Should have logging methods
      expect(typeof tinyit.info).toBe("function");
      expect(typeof tinyit.error).toBe("function");
      expect(typeof tinyit.warn).toBe("function");

      // Should have utility methods
      expect(typeof tinyit.getStatus).toBe("function");
      expect(typeof tinyit.flush).toBe("function");
      expect(typeof tinyit.clearPendingLogs).toBe("function");
    });

    it("should return logger with correct configuration", () => {
      const config = {
        apiUrl: "https://custom-api.com",
        apiKey: "custom-key",
        projectSecret: "custom-secret",
      };

      const tinyit = initTinyIT(config);
      const status = tinyit.getStatus();

      expect(status.client.config.apiUrl).toBe("https://custom-api.com");
      expect(status.client.config.hasApiKey).toBe(true);
      expect(status.client.config.hasProjectSecret).toBe(true);
    });
  });
});

describe("End-to-End Integration", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should handle complete logging flow", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, eventId: "evt_123" }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
      projectSecret: "test-secret",
    });

    await tinyit.info("Integration test message", { testId: "123" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.com/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-tinyit-sdk-version": "0.1.0",
          "x-signature": expect.any(String),
          "x-timestamp": expect.any(String),
          "x-nonce": expect.any(String),
        }),
        body: expect.stringContaining('"apiKey":"test-key"'),
      }),
    );
    const sentBody = JSON.parse(
      (mockFetch.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(sentBody.message).toBe("Integration test message");
    expect(sentBody.severity).toBe("info");
  });

  it("should handle network errors with retry", async () => {
    const networkError = new TypeError("Network error");
    mockFetch.mockRejectedValueOnce(networkError).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
      options: {
        maxRetries: 1,
        retryDelay: 10,
      },
    });

    await tinyit.error("Network error test", { retry: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should work without project secret (legacy mode)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });

    await tinyit.warn("Legacy mode test");

    const callArgs = mockFetch.mock.calls[0];
    const init = callArgs?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string> | undefined;

    expect(headers?.["x-signature"]).toBeUndefined();
    expect(headers?.["x-timestamp"]).toBeUndefined();
    expect(headers?.["x-nonce"]).toBeUndefined();
    expect(headers?.["x-api-key"]).toBeUndefined();
    expect(headers?.["x-tinyit-sdk-version"]).toBe("0.1.0");
    expect(JSON.parse(init.body as string).apiKey).toBe("test-key");
  });

  it("should handle server errors appropriately", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
      options: {
        maxRetries: 0,
      },
    });

    await expect(tinyit.info("Server error test")).rejects.toThrow("HTTP 500");
  });
});

describe("Real-World Usage Scenarios", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should handle high-frequency logging", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(tinyit.info(`High frequency log ${i}`, { index: i }));
    }

    await Promise.all(promises);

    expect(mockFetch).toHaveBeenCalledTimes(20);
  });

  it("should handle mixed log levels appropriately", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });

    await tinyit.info("Application started", { version: "1.0.0" });
    await tinyit.warn("Memory usage high", { usage: 85 });
    await tinyit.error("Database connection failed", { error: "ECONNREFUSED" });
    await tinyit.info("Retrying database connection");

    expect(mockFetch).toHaveBeenCalledTimes(4);

    const calls = mockFetch.mock.calls;
    const bodies = calls.map((call: any[]) =>
      JSON.parse((call[1] as RequestInit).body as string),
    );

    expect(bodies[0]?.severity).toBe("info");
    expect(bodies[1]?.severity).toBe("warning");
    expect(bodies[2]?.severity).toBe("error");
    expect(bodies[3]?.severity).toBe("info");
  });

  it("should handle complex metadata structures", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const tinyit = initTinyIT({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });

    const complexMeta = {
      user: {
        id: "12345",
        email: "test@example.com",
        roles: ["admin", "user"],
      },
      request: {
        method: "POST",
        url: "/api/users",
        headers: {
          "content-type": "application/json",
          "user-agent": "Test Client 1.0",
        },
        body: { name: "Test User" },
      },
      performance: {
        startTime: Date.now(),
        duration: 150,
        memoryUsage: {
          heapUsed: 45000000,
          heapTotal: 67000000,
        },
      },
    };

    await tinyit.info("Complex metadata test", complexMeta);

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs?.[1] as RequestInit).body as string);

    expect(body.context).toEqual(complexMeta);
  });
});
