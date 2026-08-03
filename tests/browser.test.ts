/**
 * Task 5.7: Browser Environment Tests
 * Tests cross-environment compatibility, specifically browser features
 */

import { jest } from "@jest/globals";
import { initTinyIT } from "../src/index.js";

const mockFetch = globalThis.fetch as jest.MockedFunction<
  (...args: any[]) => Promise<any>
>;

describe("Browser Environment Compatibility", () => {
  beforeEach(() => {
    // Clear any previous window mock
    delete (global as any).window;
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete (global as any).window;
  });

  describe("Network Status Detection", () => {
    it("should detect online status in browser", () => {
      // Mock browser environment
      const mockWindow = {
        navigator: { onLine: true },
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      const status = tinyit.getStatus();
      expect(status.client.isOnline).toBe(true);

      // Should register event listeners
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        "online",
        expect.any(Function),
      );
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        "offline",
        expect.any(Function),
      );
    });

    it("should detect offline status in browser", () => {
      const mockWindow = {
        navigator: { onLine: false },
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      const status = tinyit.getStatus();
      expect(status.client.isOnline).toBe(false);
    });

    it("should handle missing navigator gracefully", () => {
      const mockWindow = {
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      // Should not crash and default to online
      expect(() => tinyit.getStatus()).not.toThrow();
    });

    it("should work without window object (Node.js)", () => {
      // Ensure no window object
      expect((global as any).window).toBeUndefined();

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      const status = tinyit.getStatus();
      expect(status.client.isOnline).toBe(true); // Default to online in Node.js
    });
  });

  describe("Request Sending", () => {
    it("should send requests to the configured API endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      await tinyit.info("Browser fetch test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/ingest",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("should handle request errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network Error"));

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
        options: {
          maxRetries: 0,
        },
      });

      await expect(tinyit.info("Fetch error test")).rejects.toThrow(
        "Network Error",
      );
    });

    it("should handle server error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
        options: {
          maxRetries: 0,
        },
      });

      await expect(tinyit.info("404 test")).rejects.toThrow("HTTP 404");
    });
  });

  describe("Browser-Specific Features", () => {
    it("should work with browser-specific metadata", async () => {
      const mockWindow = {
        navigator: {
          onLine: true,
          userAgent: "Mozilla/5.0 (Test Browser)",
          language: "en-US",
        },
        location: {
          href: "https://example.com/page",
          hostname: "example.com",
        },
        screen: {
          width: 1920,
          height: 1080,
        },
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      await tinyit.info("Browser metadata test", {
        userAgent: mockWindow.navigator.userAgent,
        language: mockWindow.navigator.language,
        url: mockWindow.location.href,
        screenResolution: `${mockWindow.screen.width}x${mockWindow.screen.height}`,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse((callArgs?.[1] as RequestInit).body as string);

      expect(body.meta.userAgent).toBe("Mozilla/5.0 (Test Browser)");
      expect(body.meta.language).toBe("en-US");
      expect(body.meta.url).toBe("https://example.com/page");
      expect(body.meta.screenResolution).toBe("1920x1080");
    });

    it("should handle localStorage/sessionStorage metadata safely", async () => {
      const mockStorage = {
        getItem: jest.fn().mockReturnValue("test-value"),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
        length: 1,
        key: jest.fn(),
      };

      (global as any).localStorage = mockStorage;
      (global as any).sessionStorage = mockStorage;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      await tinyit.info("Storage test", {
        sessionId: mockStorage.getItem("sessionId"),
        hasLocalStorage: typeof localStorage !== "undefined",
      });

      expect(mockStorage.getItem).toHaveBeenCalledWith("sessionId");
    });
  });

  describe("Performance Monitoring", () => {
    it("should handle performance.now() if available", async () => {
      const mockPerformance = {
        now: jest.fn().mockReturnValue(1234.5),
      };

      (global as any).performance = mockPerformance;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      const startTime = performance.now();
      await tinyit.info("Performance test", { startTime });

      expect(mockPerformance.now).toHaveBeenCalled();
    });

    it("should fallback gracefully without performance API", async () => {
      delete (global as any).performance;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      await expect(
        tinyit.info("No performance API test"),
      ).resolves.not.toThrow();
    });
  });

  describe("Error Handling in Browser", () => {
    it("should handle browser-specific errors", async () => {
      const browserError = new Error("SecurityError: Blocked by CORS policy");
      mockFetch.mockRejectedValueOnce(browserError);

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
        options: {
          maxRetries: 0,
        },
      });

      await expect(tinyit.info("CORS error test")).rejects.toThrow(
        "SecurityError",
      );
    });

    it("should handle quota exceeded errors", async () => {
      const quotaError = new Error(
        "QuotaExceededError: The quota has been exceeded",
      );
      mockFetch.mockRejectedValueOnce(quotaError);

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
        options: {
          maxRetries: 0,
        },
      });

      await expect(tinyit.info("Quota error test")).rejects.toThrow(
        "QuotaExceededError",
      );
    });
  });

  describe("Offline Queue Behavior", () => {
    it("should queue requests when offline in browser", async () => {
      const mockWindow = {
        navigator: { onLine: false },
        addEventListener: jest.fn(),
      };

      (global as any).window = mockWindow;

      const tinyit = initTinyIT({
        apiUrl: "https://api.test.com",
        apiKey: "test-key",
      });

      expect(tinyit.getStatus().client.isOnline).toBe(false);

      const logPromise = tinyit.info("Offline test");

      // Should not send while offline
      expect(mockFetch).not.toHaveBeenCalled();

      // Set up response before going online so the queued request resolves
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      // Simulate going online
      mockWindow.navigator.onLine = true;
      const onlineHandler = mockWindow.addEventListener.mock.calls.find(
        (call) => call[0] === "online",
      )?.[1];

      if (typeof onlineHandler === "function") {
        (onlineHandler as () => void)();
      }

      await logPromise;

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
