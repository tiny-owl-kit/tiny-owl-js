/**
 * Task 5.3: HTTP Client with Retry and Queue System
 *
 * TinyITClient provides a robust HTTP client with:
 * - Request queuing for offline scenarios
 * - Automatic retry mechanism with exponential backoff
 * - Network connectivity handling
 * - Security header integration
 */

import { createSecureHeaders } from "./security.js";

/**
 * Internal error class for non-OK HTTP responses.
 * Carries the HTTP status code so the retry logic can decide whether to retry.
 */
class FetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}

/**
 * Configuration options for TinyITClient
 */
export interface TinyITClientConfig {
  /** API base URL */
  apiUrl: string;
  /** Project API key */
  apiKey: string;
  /** Project secret for HMAC signing (optional, enables security) */
  projectSecret?: string;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Maximum retry delay in milliseconds (default: 10000) */
  maxRetryDelay?: number;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Enable HMAC security (default: true when projectSecret provided) */
  enableSecurity?: boolean;
  /** SDK version for tracking (default: auto-detected) */
  sdkVersion?: string;
}

/**
 * Queued request interface
 */
interface QueuedRequest {
  endpoint: string;
  data: any;
  canonical?: boolean;
  timestamp: number;
  retryCount: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

/**
 * TinyITClient - HTTP client with retry and queue system
 */
export class TinyITClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly projectSecret: string | undefined;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly maxRetryDelay: number;
  private readonly timeout: number;
  private readonly enableSecurity: boolean;
  private readonly sdkVersion: string;

  private queue: QueuedRequest[] = [];
  private isSending = false;
  private isOnline = true;

  constructor(config: TinyITClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.projectSecret = config.projectSecret;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.maxRetryDelay = config.maxRetryDelay ?? 10000;
    this.timeout = config.timeout ?? 5000;
    this.enableSecurity =
      config.enableSecurity !== false && Boolean(this.projectSecret);
    this.sdkVersion = config.sdkVersion ?? "0.1.0";

    // Set up network connectivity monitoring
    this.setupConnectivityMonitoring();

    // Warn if security is disabled but projectSecret is provided
    if (this.projectSecret && !this.enableSecurity) {
      console.warn(
        "TinyIT SDK: Project secret provided but security is disabled. Consider enabling security for better protection.",
      );
    }
  }

  /**
   * Send a request to the API endpoint
   * @param endpoint - API endpoint (e.g., "/logs")
   * @param data - Request payload
   * @returns Promise that resolves when the request is successfully sent
   * @deprecated Use {@link TinyITClient.sendCanonical} for payloads that must match the canonical HMAC body (API key in body, no x-api-key header).
   */
  async send(endpoint: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
        data,
        timestamp: Date.now(),
        retryCount: 0,
        resolve,
        reject,
      };

      this.queue.push(queuedRequest);

      if (!this.isSending) {
        this.processQueue();
      }
    });
  }

  /**
   * Send a request using the canonical TinyOwl wire format.
   * The API key travels in the body (not a header) and the HMAC signature covers the body without it.
   * @param endpoint - API endpoint (e.g., "/ingest")
   * @param data - Canonical body without apiKey (message, severity, context, traceId?)
   */
  async sendCanonical(endpoint: string, data: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
        data,
        canonical: true,
        timestamp: Date.now(),
        retryCount: 0,
        resolve,
        reject,
      };

      this.queue.push(queuedRequest);

      if (!this.isSending) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    if (this.isSending) return;
    if (!this.isOnline) return;

    this.isSending = true;

    while (this.queue.length > 0) {
      const request = this.queue[0];

      if (!request) {
        this.queue.shift();
        continue;
      }

      try {
        const data = await this.executeRequest(request);
        request.resolve(data);
        this.queue.shift(); // Remove successful request from queue
      } catch (error) {
        const shouldRetry = await this.handleRequestError(request, error);

        if (!shouldRetry) {
          request.reject(error);
          this.queue.shift(); // Remove failed request from queue
        }
        // If should retry, request stays in queue for next attempt
      }
    }

    this.isSending = false;
  }

  /**
   * Execute a single HTTP request using the native fetch API
   */
  private async executeRequest(request: QueuedRequest): Promise<any> {
    const url = `${this.apiUrl}${request.endpoint}`;

    // Prepare headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-tinyit-sdk-version": this.sdkVersion,
    };

    if (!request.canonical) {
      headers["x-api-key"] = this.apiKey;
    }

    // Add security headers if enabled
    if (this.enableSecurity && this.projectSecret) {
      try {
        const securityHeaders = createSecureHeaders(
          request.data,
          this.projectSecret,
        );
        Object.assign(headers, securityHeaders);
      } catch (error) {
        throw new Error(
          `Failed to create security headers: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(
        request.canonical
          ? { apiKey: this.apiKey, ...request.data }
          : request.data,
      ),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new FetchError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Handle request errors and determine retry strategy
   */
  private async handleRequestError(
    request: QueuedRequest,
    error: any,
  ): Promise<boolean> {
    const isNetworkError = this.isNetworkError(error);
    const isRetryableError = this.isRetryableError(error);

    // Update online status based on error type
    if (isNetworkError) {
      this.isOnline = false;
    }

    // Check if we should retry
    const shouldRetry =
      (isNetworkError || isRetryableError) &&
      request.retryCount < this.maxRetries;

    if (shouldRetry) {
      request.retryCount++;
      const delay = this.calculateRetryDelay(request.retryCount);

      console.warn(
        `TinyIT SDK: Request failed, retrying in ${delay}ms (attempt ${request.retryCount}/${this.maxRetries})`,
        {
          endpoint: request.endpoint,
          error: error.message || error,
          retryCount: request.retryCount,
        },
      );

      await this.sleep(delay);
      return true; // Retry
    } else {
      console.error("TinyIT SDK: Request failed after all retry attempts", {
        endpoint: request.endpoint,
        error: error.message || error,
        retryCount: request.retryCount,
        maxRetries: this.maxRetries,
      });
      return false; // Don't retry
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const delay = this.retryDelay * Math.pow(2, retryCount - 1);
    return Math.min(delay, this.maxRetryDelay);
  }

  /**
   * Check if error is a network connectivity issue.
   * fetch() throws TypeError for network failures and DOMException (name="TimeoutError")
   * when an AbortSignal.timeout() fires.
   */
  private isNetworkError(error: any): boolean {
    if (!error) return false;
    // TypeError is thrown by fetch on network failures (DNS, refused connections, etc.)
    if (error instanceof TypeError) return true;
    // DOMException with TimeoutError name is thrown by AbortSignal.timeout()
    if (error instanceof DOMException && error.name === "TimeoutError")
      return true;
    return false;
  }

  /**
   * Check if error is retryable (5xx server errors, rate limits)
   */
  private isRetryableError(error: any): boolean {
    if (!(error instanceof FetchError)) return false;
    const { status } = error;
    // Server errors (5xx)
    if (status >= 500 && status < 600) return true;
    // Rate limiting (429)
    if (status === 429) return true;
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Set up network connectivity monitoring
   */
  private setupConnectivityMonitoring(): void {
    // Browser environment detection
    const isBrowser =
      typeof globalThis !== "undefined" &&
      "window" in globalThis &&
      "navigator" in (globalThis as any).window;

    if (isBrowser) {
      const window = (globalThis as any).window;

      window.addEventListener("online", () => {
        console.log("TinyIT SDK: Network connection restored");
        this.isOnline = true;
        if (this.queue.length > 0 && !this.isSending) {
          this.processQueue();
        }
      });

      window.addEventListener("offline", () => {
        console.log(
          "TinyIT SDK: Network connection lost, requests will be queued",
        );
        this.isOnline = false;
      });

      // Initial online status
      this.isOnline = window.navigator.onLine ?? true;
    }
    // Node.js environment - assume online by default
    // Network detection in Node.js would require additional dependencies
  }

  /**
   * Get current client status and queue information
   */
  getStatus(): {
    isOnline: boolean;
    isSending: boolean;
    queueLength: number;
    config: Omit<TinyITClientConfig, "apiKey" | "projectSecret"> & {
      hasApiKey: boolean;
      hasProjectSecret: boolean;
      securityEnabled: boolean;
    };
  } {
    return {
      isOnline: this.isOnline,
      isSending: this.isSending,
      queueLength: this.queue.length,
      config: {
        apiUrl: this.apiUrl,
        maxRetries: this.maxRetries,
        retryDelay: this.retryDelay,
        maxRetryDelay: this.maxRetryDelay,
        timeout: this.timeout,
        sdkVersion: this.sdkVersion,
        enableSecurity: this.enableSecurity,
        hasApiKey: Boolean(this.apiKey),
        hasProjectSecret: Boolean(this.projectSecret),
        securityEnabled: this.enableSecurity,
      },
    };
  }

  /**
   * Clear the request queue (useful for testing or reset scenarios)
   */
  clearQueue(): void {
    const queueLength = this.queue.length;
    this.queue.forEach((request) => {
      request.reject(new Error("Queue cleared"));
    });
    this.queue = [];
    console.log(`TinyIT SDK: Cleared ${queueLength} requests from queue`);
  }

  /**
   * Force process the queue (useful for testing)
   */
  async forceProcessQueue(): Promise<void> {
    if (!this.isSending && this.queue.length > 0) {
      await this.processQueue();
    }
  }
}
