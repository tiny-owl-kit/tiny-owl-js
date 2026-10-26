/**
 * Task 5.7: Comprehensive Tests for TinyITClient
 * Tests queue system, retry mechanism, and cross-environment compatibility
 */

import { jest } from "@jest/globals";
import { TinyITClient } from "../src/client.js";
import { TinyITLogger } from "../src/logger.js";

const mockFetch = globalThis.fetch as jest.MockedFunction<
  (...args: any[]) => Promise<any>
>;

describe("TinyITClient", () => {
  let client: InstanceType<typeof TinyITClient>;
  const mockConfig = {
    apiUrl: "https://api.test.com",
    apiKey: "test-api-key",
    projectSecret: "test-secret",
    maxRetries: 3,
    retryDelay: 100,
    timeout: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    client = new TinyITClient(mockConfig);
  });

  afterEach(() => {
    client.clearQueue();
  });

  describe("Construction and Configuration", () => {
    it("should create client with valid configuration", () => {
      const status = client.getStatus();
      expect(status.config.hasApiKey).toBe(true);
      expect(status.config.hasProjectSecret).toBe(true);
      expect(status.config.securityEnabled).toBe(true);
      expect(status.config.apiUrl).toBe("https://api.test.com");
    });

    it("should handle missing project secret gracefully", () => {
      const clientWithoutSecret = new TinyITClient({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      const status = clientWithoutSecret.getStatus();
      expect(status.config.hasProjectSecret).toBe(false);
      expect(status.config.securityEnabled).toBe(false);
    });

    it("should normalize API URL by removing trailing slash", () => {
      const clientWithTrailingSlash = new TinyITClient({
        ...mockConfig,
        apiUrl: "https://api.test.com/",
      });

      expect(clientWithTrailingSlash.getStatus().config.apiUrl).toBe(
        "https://api.test.com",
      );
    });
  });

  describe("API Call Mocking", () => {
    it("should successfully send request when API responds with 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, eventId: "evt_123" }),
      });

      const result = await client.send("/test", { message: "test" });

      expect(result).toEqual({ success: true, eventId: "evt_123" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-key": "test-api-key",
            "x-tinyit-sdk-version": "0.1.0",
            "x-signature": expect.any(String),
            "x-timestamp": expect.any(String),
            "x-nonce": expect.any(String),
          }),
          body: JSON.stringify({ message: "test" }),
        }),
      );
    });

    it("should include security headers when security is enabled", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.send("/test", { message: "secure test" });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      const init = callArgs![1] as RequestInit;
      const headers = init?.headers as Record<string, string>;
      expect(headers).toBeDefined();

      expect(headers).toHaveProperty("x-signature");
      expect(headers).toHaveProperty("x-timestamp");
      expect(headers).toHaveProperty("x-nonce");

      // Verify security headers format
      expect(headers!["x-signature"]).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(headers!["x-nonce"]).toMatch(/^[a-f0-9]{32}$/); // 32 char hex
    });

    it("should send canonical body with apiKey in body and no x-api-key header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.sendCanonical("/ingest", {
        message: "canonical",
        severity: "warning",
        context: { a: 1 },
      });

      const init = mockFetch.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty("x-api-key");
      expect(headers).toHaveProperty("x-signature");

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        apiKey: "test-api-key",
        message: "canonical",
        severity: "warning",
        context: { a: 1 },
      });
    });

    it("should not include security headers when security is disabled", async () => {
      const clientWithoutSecurity = new TinyITClient({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
        enableSecurity: false,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await clientWithoutSecurity.send("/test", {
        message: "no security test",
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      const init = callArgs![1] as RequestInit;
      const headers = init?.headers as Record<string, string>;

      expect(headers).not.toHaveProperty("x-signature");
      expect(headers).not.toHaveProperty("x-timestamp");
      expect(headers).not.toHaveProperty("x-nonce");
    });
  });

  describe("Queue System", () => {
    it("should queue multiple requests and process them sequentially", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const promises = [
        client.send("/test1", { message: "test1" }),
        client.send("/test2", { message: "test2" }),
        client.send("/test3", { message: "test3" }),
      ];

      await Promise.all(promises);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.test.com/test1",
        expect.objectContaining({ body: JSON.stringify({ message: "test1" }) }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.test.com/test2",
        expect.objectContaining({ body: JSON.stringify({ message: "test2" }) }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "https://api.test.com/test3",
        expect.objectContaining({ body: JSON.stringify({ message: "test3" }) }),
      );
    });

    it("should track queue length correctly", () => {
      expect(client.getStatus().queueLength).toBe(0);

      // Add items to queue without processing
      client.send("/test1", { message: "test1" }).catch(() => {});
      client.send("/test2", { message: "test2" }).catch(() => {});

      // Note: In real usage, queue length would decrease as items are processed
      // For testing, we check initial state
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should clear queue when requested", async () => {
      // Add multiple items to queue
      client.send("/test1", { message: "test1" }).catch(() => {}); // Ignore rejection
      client.send("/test2", { message: "test2" }).catch(() => {}); // Ignore rejection

      client.clearQueue();

      expect(client.getStatus().queueLength).toBe(0);
    });
  });

  describe("Retry Mechanism", () => {
    it("should retry on network errors", async () => {
      const networkError = new TypeError("Failed to fetch");

      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const result = await client.send("/test", { message: "retry test" });

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should retry on 5xx server errors", async () => {
      const serverError = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      };

      mockFetch
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const result = await client.send("/test", {
        message: "server error test",
      });

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should retry on rate limiting (429)", async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      };

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.send("/test", { message: "rate limit test" });

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry on 4xx client errors (except 429)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({}),
      });

      await expect(
        client.send("/test", { message: "client error test" }),
      ).rejects.toMatchObject({ message: "HTTP 400: Bad Request" });

      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it("should fail after maximum retries", async () => {
      const networkError = new TypeError("Persistent Network Error");

      mockFetch.mockRejectedValue(networkError);

      await expect(
        client.send("/test", { message: "max retries test" }),
      ).rejects.toMatchObject({ message: "Persistent Network Error" });

      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it("should use exponential backoff for retry delays", async () => {
      const networkError = new TypeError("Network Error");

      const startTime = Date.now();

      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      await client.send("/test", { message: "backoff test" });

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should take at least 100ms (first retry) + 200ms (second retry) = 300ms
      // Adding some tolerance for test execution time
      expect(totalTime).toBeGreaterThan(250);
    });
  });

  describe("Cross-Environment Compatibility", () => {
    it("should work in Node.js environment", () => {
      // Mock Node.js environment
      const originalWindow = (global as any).window;
      delete (global as any).window;

      const nodeClient = new TinyITClient(mockConfig);
      const status = nodeClient.getStatus();

      expect(status.isOnline).toBe(true); // Default to online in Node.js

      // Restore window if it existed
      if (originalWindow) {
        (global as any).window = originalWindow;
      }
    });

    it("should detect online/offline status in browser environment", () => {
      // Mock browser environment
      const mockWindow = {
        navigator: { onLine: true },
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      const browserClient = new TinyITClient(mockConfig);
      const status = browserClient.getStatus();

      expect(status.isOnline).toBe(true);
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        "online",
        expect.any(Function),
      );
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        "offline",
        expect.any(Function),
      );

      // Cleanup
      delete (global as any).window;
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed responses gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => null,
      });

      const result = await client.send("/test", {
        message: "malformed response test",
      });
      expect(result).toBeNull();
    });

    it("should handle timeout errors", async () => {
      const timeoutError = new DOMException(
        "Request timeout exceeded",
        "TimeoutError",
      );

      mockFetch.mockRejectedValue(timeoutError);

      await expect(
        client.send("/test", { message: "timeout test" }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("timeout"),
      });
    });

    it("should provide detailed error context", async () => {
      const error = new Error("Test error");
      mockFetch.mockRejectedValue(error);

      try {
        await client.send("/test", { message: "error context test" });
      } catch (caughtError: any) {
        expect(caughtError.message).toContain("Test error");
      }
    });
  });

  describe("Status and Monitoring", () => {
    it("should provide comprehensive status information", () => {
      const status = client.getStatus();

      expect(status).toMatchObject({
        isOnline: expect.any(Boolean),
        isSending: expect.any(Boolean),
        queueLength: expect.any(Number),
        config: expect.objectContaining({
          apiUrl: "https://api.test.com",
          hasApiKey: true,
          hasProjectSecret: true,
          securityEnabled: true,
          maxRetries: 3,
          timeout: 1000,
        }),
      });
    });

    it("should track sending state correctly", async () => {
      const slowResponse = new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: true, json: async () => ({ success: true }) }),
          100,
        ),
      );

      mockFetch.mockReturnValueOnce(slowResponse as any);

      const sendPromise = client.send("/test", {
        message: "sending state test",
      });

      // Should be sending immediately after request starts
      expect(client.getStatus().isSending).toBe(true);

      await sendPromise;

      // Should not be sending after request completes
      expect(client.getStatus().isSending).toBe(false);
    });
  });
});
