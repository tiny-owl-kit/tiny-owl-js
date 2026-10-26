/**
 * Task 5.4: Log Method Implementation
 *
 * TinyITLogger provides simple logging methods with automatic client handling.
 * Supports info, error, and warn severity levels with optional metadata.
 */

import { TinyITClient, type TinyITClientConfig } from "./client.js";

/**
 * Log entry metadata interface
 */
export interface LogMetadata {
  [key: string]: any;
}

/**
 * Log levels supported by TinyIT
 */
export type LogLevel = "info" | "error" | "warn";

/**
 * Maps SDK log levels to the canonical TinyOwl severities accepted by the backend.
 */
const SEVERITY_BY_LEVEL: Record<LogLevel, "info" | "warning" | "error"> = {
  info: "info",
  warn: "warning",
  error: "error",
};

/**
 * Configuration for TinyITLogger
 */
export interface TinyITLoggerConfig {
  /** API base URL */
  apiUrl: string;
  /** Project API key */
  apiKey: string;
  /** Project secret for HMAC signing (optional, enables security) */
  projectSecret?: string | undefined;
  /** Additional client configuration options */
  clientConfig?: Partial<
    Omit<TinyITClientConfig, "apiUrl" | "apiKey" | "projectSecret">
  >;
}

/**
 * TinyITLogger - Simple logging interface for the TinyIT SDK
 */
export class TinyITLogger {
  private readonly client: TinyITClient;

  constructor(config: TinyITLoggerConfig) {
    // Create client with merged configuration
    const clientConfig: TinyITClientConfig = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      ...(config.projectSecret !== undefined && {
        projectSecret: config.projectSecret,
      }),
      ...config.clientConfig,
    };

    this.client = new TinyITClient(clientConfig);

    if (!config.projectSecret) {
      console.warn(
        "TinyIT SDK: No project secret provided. The backend requires HMAC signing and will reject unsigned requests with 401.",
      );
    }
  }

  /**
   * Log an info level message
   * @param message - Log message
   * @param meta - Optional metadata object
   * @returns Promise that resolves when the log is sent
   */
  async info(message: string, meta: LogMetadata = {}): Promise<any> {
    return this.log("info", message, meta);
  }

  /**
   * Log an error level message
   * @param message - Error message
   * @param meta - Optional metadata object (renamed from 'target' in original spec)
   * @returns Promise that resolves when the log is sent
   */
  async error(message: string, meta: LogMetadata = {}): Promise<any> {
    return this.log("error", message, meta);
  }

  /**
   * Log a warning level message
   * @param message - Warning message
   * @param meta - Optional metadata object (renamed from 'target' in original spec)
   * @returns Promise that resolves when the log is sent
   */
  async warn(message: string, meta: LogMetadata = {}): Promise<any> {
    return this.log("warn", message, meta);
  }

  /**
   * Generic log method that handles all log levels
   * @param level - Log level
   * @param message - Log message
   * @param meta - Optional metadata
   * @returns Promise that resolves when the log is sent
   */
  private async log(
    level: LogLevel,
    message: string,
    meta: LogMetadata,
  ): Promise<any> {
    // Validate inputs
    if (!message || typeof message !== "string") {
      throw new Error("Log message is required and must be a string");
    }

    if (typeof meta !== "object" || meta === null) {
      throw new Error("Log metadata must be an object");
    }

    // Canonical body: key order matches the HMAC-signed payload in src/index.ts
    const logPayload = {
      message,
      severity: SEVERITY_BY_LEVEL[level],
      context: meta,
    };

    try {
      // Send via client (which handles queuing, retries, etc.)
      return await this.client.sendCanonical("/ingest", logPayload);
    } catch (error) {
      // Enhanced error handling with context
      const logError = new Error(
        `Failed to send ${level} log: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      // Add context to error for debugging
      (logError as any).context = {
        level,
        message: message.substring(0, 100), // Truncate for privacy
        metaKeys: Object.keys(meta),
        originalError: error,
      };

      throw logError;
    }
  }

  /**
   * Get the underlying client for advanced operations
   * @returns TinyITClient instance
   */
  getClient(): TinyITClient {
    return this.client;
  }

  /**
   * Get current logger and client status
   * @returns Status information
   */
  getStatus(): {
    logger: {
      ready: boolean;
    };
    client: ReturnType<TinyITClient["getStatus"]>;
  } {
    const clientStatus = this.client.getStatus();

    return {
      logger: {
        ready: Boolean(clientStatus.config.hasApiKey),
      },
      client: clientStatus,
    };
  }

  /**
   * Convenience method to flush any pending logs
   * Forces the client to process its queue immediately
   * @returns Promise that resolves when queue processing is complete
   */
  async flush(): Promise<void> {
    return this.client.forceProcessQueue();
  }

  /**
   * Clear any pending logs in the queue
   * Useful for cleanup or reset scenarios
   */
  clearPendingLogs(): void {
    this.client.clearQueue();
  }
}

/**
 * Legacy compatibility - Remove the duplicate export
 */

/**
 * Create a logger instance with simplified configuration
 * @param apiUrl - API base URL
 * @param apiKey - Project API key
 * @param projectSecret - Optional project secret for security
 * @returns TinyITLogger instance
 */
export function createLogger(
  apiUrl: string,
  apiKey: string,
  projectSecret?: string | undefined,
): TinyITLogger {
  return new TinyITLogger({
    apiUrl,
    apiKey,
    ...(projectSecret !== undefined && { projectSecret }),
  });
}
