/**
 * Task 5.7: Tests for TinyITLogger
 * Tests logging methods and integration with client
 */

import { jest } from "@jest/globals";
import type { TinyITClient } from "../src/client.js";

const MockedTinyITClient = jest.fn();
jest.unstable_mockModule("../src/client.js", () => ({
  TinyITClient: MockedTinyITClient,
}));

const { TinyITLogger, createLogger } = await import("../src/logger.js");

describe("TinyITLogger", () => {
  let mockClient: jest.Mocked<TinyITClient>;
  let logger: InstanceType<typeof TinyITLogger>;

  const mockConfig = {
    apiUrl: "https://api.test.com",
    apiKey: "test-api-key",
    projectSecret: "test-secret",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock client instance
    mockClient = {
      sendCanonical: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ success: true })),
      getStatus: jest.fn().mockReturnValue({
        isOnline: true,
        isSending: false,
        queueLength: 0,
        config: {
          hasApiKey: true,
          hasProjectSecret: true,
          securityEnabled: true,
        },
      }),
      forceProcessQueue: jest
        .fn()
        .mockImplementation(() => Promise.resolve(undefined)),
      clearQueue: jest.fn(),
    } as any;

    MockedTinyITClient.mockImplementation(() => mockClient);

    logger = new TinyITLogger(mockConfig);
  });

  describe("Construction", () => {
    it("should create logger with valid configuration", () => {
      expect(MockedTinyITClient).toHaveBeenCalledWith({
        apiUrl: "https://api.test.com",
        apiKey: "test-api-key",
        projectSecret: "test-secret",
      });
    });

    it("should create logger without project secret", () => {
      const configWithoutSecret = {
        apiUrl: "https://api.test.com",
        apiKey: "test-api-key",
      };

      new TinyITLogger(configWithoutSecret);

      expect(MockedTinyITClient).toHaveBeenCalledWith({
        apiUrl: "https://api.test.com",
        apiKey: "test-api-key",
      });
    });

    it("should warn when project secret is missing or empty", () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      new TinyITLogger({ apiUrl: "https://api.test.com", apiKey: "k" });
      new TinyITLogger({
        apiUrl: "https://api.test.com",
        apiKey: "k",
        projectSecret: "",
      });
      new TinyITLogger({
        apiUrl: "https://api.test.com",
        apiKey: "k",
        projectSecret: "s",
      });

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No project secret"),
      );
      warnSpy.mockRestore();
    });

    it("should merge client configuration options", () => {
      const configWithOptions = {
        ...mockConfig,
        clientConfig: {
          maxRetries: 5,
          timeout: 10000,
        },
      };

      new TinyITLogger(configWithOptions);

      expect(MockedTinyITClient).toHaveBeenCalledWith({
        apiUrl: "https://api.test.com",
        apiKey: "test-api-key",
        projectSecret: "test-secret",
        maxRetries: 5,
        timeout: 10000,
      });
    });
  });

  describe("Logging Methods", () => {
    it("should log info messages correctly", async () => {
      const message = "Test info message";
      const meta = { userId: "123", action: "login" };

      await logger.info(message, meta);

      expect(mockClient.sendCanonical).toHaveBeenCalledWith("/ingest", {
        message,
        severity: "info",
        context: meta,
      });
    });

    it("should log error messages correctly", async () => {
      const message = "Test error message";
      const meta = { errorCode: 500, stack: "Error stack trace" };

      await logger.error(message, meta);

      expect(mockClient.sendCanonical).toHaveBeenCalledWith("/ingest", {
        message,
        severity: "error",
        context: meta,
      });
    });

    it("should log warning messages correctly", async () => {
      const message = "Test warning message";
      const meta = { threshold: 90, current: 95 };

      await logger.warn(message, meta);

      expect(mockClient.sendCanonical).toHaveBeenCalledWith("/ingest", {
        message,
        severity: "warning",
        context: meta,
      });
    });

    it("should handle empty metadata", async () => {
      await logger.info("Test message");

      expect(mockClient.sendCanonical).toHaveBeenCalledWith("/ingest", {
        message: "Test message",
        severity: "info",
        context: {},
      });
    });
  });

  describe("Input Validation", () => {
    it("should reject empty message", async () => {
      await expect(logger.info("")).rejects.toThrow(
        "Log message is required and must be a string",
      );
      await expect(logger.error("")).rejects.toThrow(
        "Log message is required and must be a string",
      );
      await expect(logger.warn("")).rejects.toThrow(
        "Log message is required and must be a string",
      );
    });

    it("should reject non-string message", async () => {
      await expect(logger.info(null as any)).rejects.toThrow(
        "Log message is required and must be a string",
      );
      await expect(logger.info(123 as any)).rejects.toThrow(
        "Log message is required and must be a string",
      );
      await expect(logger.info({} as any)).rejects.toThrow(
        "Log message is required and must be a string",
      );
    });

    it("should reject invalid metadata", async () => {
      await expect(logger.info("Test", null as any)).rejects.toThrow(
        "Log metadata must be an object",
      );
      await expect(logger.info("Test", "string" as any)).rejects.toThrow(
        "Log metadata must be an object",
      );
    });

    it("should accept valid metadata types", async () => {
      await expect(
        logger.info("Test", { key: "value" }),
      ).resolves.not.toThrow();
      await expect(logger.info("Test", { number: 123 })).resolves.not.toThrow();
      await expect(
        logger.info("Test", { nested: { object: true } }),
      ).resolves.not.toThrow();
      await expect(
        logger.info("Test", { array: [1, 2, 3] }),
      ).resolves.not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle client send errors with context", async () => {
      const clientError = new Error("Network error");
      mockClient.sendCanonical.mockRejectedValueOnce(clientError);

      try {
        await logger.error("Test error message", { code: 500 });
      } catch (error: any) {
        expect(error.message).toContain(
          "Failed to send error log: Network error",
        );
        expect(error.context).toMatchObject({
          level: "error",
          message: "Test error message",
          metaKeys: ["code"],
          originalError: clientError,
        });
      }
    });

    it("should truncate long messages in error context", async () => {
      const longMessage = "A".repeat(200);
      const clientError = new Error("Network error");
      mockClient.sendCanonical.mockRejectedValueOnce(clientError);

      try {
        await logger.info(longMessage);
      } catch (error: any) {
        expect(error.context.message).toHaveLength(100);
        expect(error.context.message).toBe("A".repeat(100));
      }
    });

    it("should handle non-Error objects", async () => {
      mockClient.sendCanonical.mockRejectedValueOnce("String error");

      try {
        await logger.info("Test message");
      } catch (error: any) {
        expect(error.message).toContain(
          "Failed to send info log: Unknown error",
        );
      }
    });
  });

  describe("Utility Methods", () => {
    it("should return client instance", () => {
      const client = logger.getClient();
      expect(client).toBe(mockClient);
    });

    it("should provide status information", () => {
      const status = logger.getStatus();

      expect(status).toMatchObject({
        logger: {
          ready: true,
        },
        client: {
          isOnline: true,
          isSending: false,
          queueLength: 0,
          config: {
            hasApiKey: true,
            hasProjectSecret: true,
            securityEnabled: true,
          },
        },
      });
    });

    it("should flush pending logs", async () => {
      await logger.flush();
      expect(mockClient.forceProcessQueue).toHaveBeenCalled();
    });

    it("should clear pending logs", () => {
      logger.clearPendingLogs();
      expect(mockClient.clearQueue).toHaveBeenCalled();
    });
  });

  describe("Concurrent Logging", () => {
    it("should handle multiple concurrent log calls", async () => {
      const promises = [
        logger.info("Message 1", { id: 1 }),
        logger.error("Message 2", { id: 2 }),
        logger.warn("Message 3", { id: 3 }),
        logger.info("Message 4", { id: 4 }),
      ];

      await Promise.all(promises);

      expect(mockClient.sendCanonical).toHaveBeenCalledTimes(4);
      expect(mockClient.sendCanonical).toHaveBeenNthCalledWith(
        1,
        "/ingest",
        expect.objectContaining({ severity: "info", message: "Message 1" }),
      );
      expect(mockClient.sendCanonical).toHaveBeenNthCalledWith(
        2,
        "/ingest",
        expect.objectContaining({ severity: "error", message: "Message 2" }),
      );
      expect(mockClient.sendCanonical).toHaveBeenNthCalledWith(
        3,
        "/ingest",
        expect.objectContaining({ severity: "warning", message: "Message 3" }),
      );
      expect(mockClient.sendCanonical).toHaveBeenNthCalledWith(
        4,
        "/ingest",
        expect.objectContaining({ severity: "info", message: "Message 4" }),
      );
    });
  });
});

describe("createLogger helper function", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create logger with required parameters", () => {
    const logger = createLogger("https://api.test.com", "test-key");

    expect(MockedTinyITClient).toHaveBeenCalledWith({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });
  });

  it("should create logger with project secret", () => {
    const logger = createLogger(
      "https://api.test.com",
      "test-key",
      "test-secret",
    );

    expect(MockedTinyITClient).toHaveBeenCalledWith({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
      projectSecret: "test-secret",
    });
  });

  it("should create logger without project secret when undefined", () => {
    const logger = createLogger("https://api.test.com", "test-key", undefined);

    expect(MockedTinyITClient).toHaveBeenCalledWith({
      apiUrl: "https://api.test.com",
      apiKey: "test-key",
    });
  });
});
