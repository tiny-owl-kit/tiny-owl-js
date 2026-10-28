/**
 * Task 5.5: Entry Point - TinyOwl SDK
 *
 * This module provides the TinyOwl SDK (formerly EchoNova) with TinyIT integration
 * with enhanced features including queue system, retry mechanism, and security.
 */

// TinyOwl SDK imports (preserving existing functionality)
import { createSecureHeaders, type SecurityHeaders } from "./security.js";

// New TinyIT SDK imports
import {
  TinyITLogger,
  type TinyITLoggerConfig,
  type LogMetadata,
  type LogLevel,
} from "./logger.js";
import { TinyITClient, type TinyITClientConfig } from "./client.js";

/**
 * Event severity levels (TinyOwl compatibility)
 */
export type Severity = "info" | "warning" | "error";

/** Allowed characters for traceId values (mirrored on the backend). */
const TRACE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Generate a UUID v4 using the Web Crypto API (Node 18+, modern browsers). */
function newUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Minimal fallback for environments without Web Crypto
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Configuration options for TinyOwl client
 */
export interface EchoNovaConfig {
  /** Your project's API key from TinyOwl dashboard */
  apiKey: string;
  /** Your project's secret for HMAC signing (recommended for security) */
  projectSecret?: string;
  /** Base URL of the TinyOwl API (default: "http://localhost:5001/api") */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Enable HMAC signature verification (default: true when projectSecret is provided) */
  enableHMAC?: boolean;
  /**
   * Default context fields merged into every log call made on this instance.
   * Call-site context wins over defaults on key conflicts.
   */
  defaultContext?: Record<string, unknown>;
  /**
   * Automatically attach a stable traceId to every event logged by this instance.
   * A fresh UUID is generated at construction time and reused for the instance lifetime.
   * Child instances created via `withContext()` receive their own unique traceId.
   * Set to `false` to opt out of automatic traceId generation.
   * @default true
   */
  autoTraceId?: boolean;
  /** Name of the service emitting events (sent top-level and included in the HMAC signature when set). */
  service?: string;
  /** Deployment environment, e.g. "production" (sent top-level and included in the HMAC signature when set). */
  environment?: string;
}

/**
 * Options for logging events (TinyOwl compatibility)
 */
export interface LogOptions {
  /** Event severity level (default: "info") */
  severity?: Severity;
  /** Additional context data for the event */
  context?: Record<string, any>;
}

/**
 * API response structure (TinyOwl compatibility)
 */
export interface LogResponse {
  success: boolean;
  message: string;
  data?: {
    eventId: string;
    timestamp: string;
    hmacVerified?: boolean;
    traceId?: string;
  };
}

/**
 * TinyOwl SDK class for event logging with security features
 * (Maintains backward compatibility with legacy EchoNova interface)
 */
export class EchoNova {
  private readonly apiKey: string;
  private readonly projectSecret: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly enableHMAC: boolean;
  private readonly defaultContext: Record<string, unknown>;
  private readonly autoTraceId: boolean;
  private readonly service: string | undefined;
  private readonly environment: string | undefined;
  /** Stable correlation ID for all events logged by this instance. */
  private readonly instanceTraceId: string | undefined;

  /**
   * Create a new TinyOwl client instance.
   * @param config - SDK configuration
   * @param _instanceTraceId - Internal use only: override the generated traceId (used by withContext)
   */
  constructor(config: EchoNovaConfig, _instanceTraceId?: string) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }

    this.apiKey = config.apiKey;
    this.projectSecret = config.projectSecret;
    this.baseUrl = config.baseUrl || "http://localhost:5001/api";
    this.timeout = config.timeout || 5000;
    this.defaultContext = config.defaultContext ?? {};
    this.autoTraceId = config.autoTraceId !== false;
    this.service = config.service;
    this.environment = config.environment;

    // Enable HMAC by default when projectSecret is provided
    this.enableHMAC =
      config.enableHMAC !== false && Boolean(this.projectSecret);

    // Warn if HMAC is disabled but projectSecret is provided
    if (this.projectSecret && !this.enableHMAC) {
      console.warn(
        "TinyOwl SDK: Project secret provided but HMAC verification is disabled. Consider enabling HMAC for better security.",
      );
    }

    // Warn if HMAC is requested but no projectSecret is provided
    if (config.enableHMAC && !this.projectSecret) {
      console.warn(
        "TinyOwl SDK: HMAC verification requested but no project secret provided. Falling back to legacy authentication.",
      );
      this.enableHMAC = false;
    }

    // instanceTraceId: explicit override > auto-generate > undefined
    if (_instanceTraceId !== undefined) {
      this.instanceTraceId = _instanceTraceId;
    } else {
      this.instanceTraceId = this.autoTraceId ? newUUID() : undefined;
    }
  }

  /**
   * Create a child logger scope with merged default context.
   *
   * Each child receives its own fresh traceId (unless you supply one via `partial.traceId`).
   * This is useful for scoping logs to a specific request, job, or user session:
   *
   * @example
   * ```ts
   * const reqLogger = logger.withContext({ requestId: req.id, userId: user.id });
   * reqLogger.info("Request started");   // traceId auto-assigned to this scope
   * reqLogger.error("Unhandled error");  // same traceId — events are correlated
   * ```
   */
  withContext(partial: Record<string, unknown>): EchoNova {
    // Validate or generate child traceId
    const rawTraceId = partial.traceId;
    let childTraceId: string | undefined;

    if (typeof rawTraceId === "string") {
      if (TRACE_ID_RE.test(rawTraceId)) {
        childTraceId = rawTraceId;
      } else {
        console.warn(
          `TinyOwl SDK: Invalid traceId in withContext "${rawTraceId.substring(0, 40)}" — a fresh traceId will be generated.`,
        );
        childTraceId = this.autoTraceId ? newUUID() : undefined;
      }
    } else if (this.autoTraceId) {
      childTraceId = newUUID();
    }

    // Merge parent defaultContext + partial (sans traceId — it lives on the instance)
    const { traceId: _unused, ...partialWithoutTraceId } = partial;
    const mergedDefaultContext: Record<string, unknown> = {
      ...this.defaultContext,
      ...partialWithoutTraceId,
    };

    return new EchoNova(
      {
        apiKey: this.apiKey,
        ...(this.projectSecret !== undefined
          ? { projectSecret: this.projectSecret }
          : {}),
        baseUrl: this.baseUrl,
        timeout: this.timeout,
        enableHMAC: this.enableHMAC,
        defaultContext: mergedDefaultContext,
        autoTraceId: this.autoTraceId,
        ...(this.service !== undefined ? { service: this.service } : {}),
        ...(this.environment !== undefined
          ? { environment: this.environment }
          : {}),
      },
      childTraceId,
    );
  }

  /**
   * Log an event to TinyOwl.
   *
   * The final context sent to the backend is composed as:
   * `defaultContext` (instance) → `options.context` (call-site overrides). `traceId` is sent
   * as a top-level wire field only — it is never injected into the `context` object.
   */
  async log(message: string, options: LogOptions = {}): Promise<LogResponse> {
    if (!message || typeof message !== "string") {
      throw new Error("Message is required and must be a string");
    }

    const { severity = "info", context: callContext = {} } = options;
    const validSeverities: Severity[] = ["info", "warning", "error"];

    if (!validSeverities.includes(severity)) {
      throw new Error(
        `Invalid severity. Must be one of: ${validSeverities.join(", ")}`,
      );
    }

    // Merge defaultContext + callContext (callContext wins on key conflicts)
    const mergedContext: Record<string, unknown> = {
      ...this.defaultContext,
      ...callContext,
    };

    // Resolve traceId: explicit in merged context > instanceTraceId
    const rawTraceId = mergedContext.traceId;
    let resolvedTraceId: string | undefined;

    if (typeof rawTraceId === "string") {
      if (TRACE_ID_RE.test(rawTraceId)) {
        resolvedTraceId = rawTraceId;
      } else {
        console.warn(
          `TinyOwl SDK: Invalid traceId format "${rawTraceId.substring(0, 40)}" — ignored. Must match [A-Za-z0-9._:-]{1,128}.`,
        );
      }
    } else if (this.instanceTraceId !== undefined) {
      resolvedTraceId = this.instanceTraceId;
    }

    // Build final context: strip any explicit traceId key — it lives as a top-level field only
    const { traceId: _unused, ...finalContext } = mergedContext;

    // Wire payload — traceId is a top-level sibling of context
    const payload: Record<string, unknown> = {
      apiKey: this.apiKey,
      message,
      severity,
      context: finalContext,
      ...(resolvedTraceId !== undefined ? { traceId: resolvedTraceId } : {}),
      ...(this.service !== undefined ? { service: this.service } : {}),
      ...(this.environment !== undefined
        ? { environment: this.environment }
        : {}),
    };

    // Create request headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add HMAC security headers if enabled
    if (this.enableHMAC && this.projectSecret) {
      try {
        const payloadForSignature = {
          message,
          severity,
          context: finalContext,
          ...(resolvedTraceId !== undefined
            ? { traceId: resolvedTraceId }
            : {}),
          ...(this.service !== undefined ? { service: this.service } : {}),
          ...(this.environment !== undefined
            ? { environment: this.environment }
            : {}),
        };
        const securityHeaders = createSecureHeaders(
          payloadForSignature,
          this.projectSecret,
        );
        Object.assign(headers, securityHeaders);
      } catch (error) {
        throw new Error(
          `Failed to create security headers: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as LogResponse;

      if (!response.ok) {
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Log an info level event
   */
  async info(
    message: string,
    context: Record<string, any> = {},
  ): Promise<LogResponse> {
    return this.log(message, { severity: "info", context });
  }

  /**
   * Log a warning level event
   */
  async warning(
    message: string,
    context: Record<string, any> = {},
  ): Promise<LogResponse> {
    return this.log(message, { severity: "warning", context });
  }

  /**
   * Log an error level event
   */
  async error(
    message: string,
    context: Record<string, any> = {},
  ): Promise<LogResponse> {
    return this.log(message, { severity: "error", context });
  }

  /**
   * Get SDK configuration information (useful for debugging).
   * Never exposes sensitive information like API keys or secrets.
   */
  getConfig(): Omit<EchoNovaConfig, "apiKey" | "projectSecret"> & {
    hasApiKey: boolean;
    hasProjectSecret: boolean;
    hmacEnabled: boolean;
    instanceTraceId?: string;
  } {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      enableHMAC: this.enableHMAC,
      hasApiKey: Boolean(this.apiKey),
      hasProjectSecret: Boolean(this.projectSecret),
      hmacEnabled: this.enableHMAC,
      ...(this.instanceTraceId !== undefined
        ? { instanceTraceId: this.instanceTraceId }
        : {}),
    };
  }
}

/**
 * TinyIT SDK Configuration Interface
 */
export interface TinyITConfig {
  /** API base URL */
  apiUrl: string;
  /** Project API key */
  apiKey: string;
  /** Project secret for HMAC signing (optional, enables security) */
  projectSecret?: string;
  /** Additional configuration options */
  options?: Partial<
    Omit<TinyITClientConfig, "apiUrl" | "apiKey" | "projectSecret">
  >;
}

/**
 * Task 5.5: Initialize TinyIT SDK
 *
 * Creates a new TinyIT logger instance with the provided configuration.
 * Includes validation and enhanced error handling.
 *
 * @param config - Configuration object with apiUrl, apiKey, and optional projectSecret
 * @returns TinyITLogger instance
 *
 * @example
 * ```typescript
 * import { initTinyIT } from "@tiny-owl-kit/observability";
 *
 * const tinyit = initTinyIT({
 *   apiUrl: "https://api.tinyit.io",
 *   apiKey: "PUBLIC_PROJECT_KEY"
 * });
 *
 * tinyit.info("App started");
 * tinyit.error("Something went wrong", { code: 500 });
 * ```
 */
export function initTinyIT(config: TinyITConfig): TinyITLogger {
  // Enhanced validation
  if (!config.apiUrl || !config.apiKey) {
    throw new Error("TinyIT: Missing apiUrl or apiKey");
  }

  if (typeof config.apiUrl !== "string" || typeof config.apiKey !== "string") {
    throw new Error("TinyIT: apiUrl and apiKey must be strings");
  }

  // Validate URL format
  try {
    new URL(config.apiUrl);
  } catch {
    throw new Error("TinyIT: Invalid apiUrl format");
  }

  // Create logger configuration
  const loggerConfig: TinyITLoggerConfig = {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    ...(config.projectSecret && { projectSecret: config.projectSecret }),
    ...(config.options && { clientConfig: config.options }),
  };

  return new TinyITLogger(loggerConfig);
}

// Export all types and classes for advanced usage
export {
  // Security utilities (from TinyOwl SDK)
  createSecureHeaders,
  generateNonce,
  signPayload,
  type SecurityHeaders,
} from "./security.js";

export {
  // TinyIT Logger exports
  TinyITLogger,
  type TinyITLoggerConfig,
  type LogMetadata,
  type LogLevel,
  createLogger,
} from "./logger.js";

export {
  // TinyIT Client exports
  TinyITClient,
  type TinyITClientConfig,
} from "./client.js";

// TinyOwl is the canonical public alias for EchoNova
export { EchoNova as TinyOwl };

// Support both named and default exports for backward compatibility
export default EchoNova;
