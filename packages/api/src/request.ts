import { ArrayBufferedQueue, type BufferedQueue } from "@devpad/schema/types";
import {
  HTTP_STATUS,
  handleHttpResponse,
  handleNetworkError,
  handleResponseError,
} from "./error-handlers";
import { ApiError, AuthenticationError } from "./errors";

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
};

export type RequestHistoryEntry = {
  timestamp: string;
  method: string;
  path: string;
  options: RequestOptions;
  url: string;
  status?: number;
  duration?: number;
  error?: string;
};

export class ApiClient {
  private base_url: string;
  private api_key: string;
  private request_history: BufferedQueue<RequestHistoryEntry>;
  private category: string = "api";
  private default_headers: Record<string, string>;
  private custom_fetch?: typeof fetch;

  private credentials?: "include" | "omit" | "same-origin";
  private auth_mode: "session" | "key" | "cookie";
  private debug: boolean;

  constructor(options: {
    base_url: string;
    api_key?: string;
    max_history_size?: number;
    category?: string;
    credentials?: "include" | "omit" | "same-origin";
    auth_mode?: "session" | "key" | "cookie";
    default_headers?: Record<string, string>;
    custom_fetch?: typeof fetch;
    debug?: boolean;
  }) {
    this.auth_mode =
      options.auth_mode ??
      (options.api_key?.startsWith("jwt:") ? "session" : "key");

    if (this.auth_mode !== "cookie") {
      if (!options.api_key) throw new Error("API key is required");
      if (options.api_key.length < 10) throw new Error("API key is too short");
    }

    this.base_url = options.base_url;
    this.api_key = options.api_key ?? "";
    this.category = options.category || "api";
    this.credentials = options.credentials;
    this.default_headers = options.default_headers ?? {};
    this.custom_fetch = options.custom_fetch;
    this.request_history = new ArrayBufferedQueue<RequestHistoryEntry>(
      options.max_history_size ?? 5,
    );
    this.debug = options.debug ?? false;
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.base_url}${path}`);

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });
    }

    return url.toString();
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { method = "GET", headers = {}, body, query } = options;
    const url = this.buildUrl(path, query);
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    if (this.debug) {
      console.log(
        `[DEBUG][${this.category}] ${method} ${path} [${requestId}]`,
        { body, query },
      );
    }

    const request_headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      ...this.default_headers,
      ...headers,
    };

    if (this.auth_mode === "session") {
      request_headers.Authorization = `Bearer jwt:${this.api_key.replace(/^jwt:/, "")}`;
    } else if (this.auth_mode === "key") {
      request_headers.Authorization = `Bearer ${this.api_key}`;
    }

    // Initialize history entry
    const historyEntry: RequestHistoryEntry = {
      timestamp,
      method,
      path,
      options: { ...options, method },
      url,
    };

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: request_headers,
      };

      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }

      if (this.credentials) {
        fetchOptions.credentials = this.credentials;
      } else if (this.auth_mode === "cookie") {
        fetchOptions.credentials = "include";
      }

      const fetcher = this.custom_fetch ?? fetch;
      const response = await fetcher(url, fetchOptions);
      const duration = Date.now() - startTime;

      // Update history entry with response info
      historyEntry.status = response.status;
      historyEntry.duration = duration;

      if (!response.ok) {
        if (this.debug) {
          console.log(
            `[ERROR][${this.category}] ${method} ${path} [${requestId}] failed`,
            {
              status: response.status,
              duration: `${duration}ms`,
              body,
              query,
            },
          );
        }

        try {
          // Use centralized error handling
          handleHttpResponse(response);
          await handleResponseError(response);
        } catch (error) {
          // Log error in history and re-throw
          const errorMessage =
            error instanceof Error ? error.message : "Request failed";
          historyEntry.error = errorMessage;
          this.request_history.add(historyEntry);
          throw error;
        }
      }

      // Success - add to history
      this.request_history.add(historyEntry);

      // Handle response parsing
      let result: T;
      if (response.status === HTTP_STATUS.NO_CONTENT) {
        result = undefined as T;
      } else {
        const text = await response.text();
        if (!text || text.trim() === "" || text.trim() === "null") {
          result = undefined as T;
        } else {
          try {
            result = JSON.parse(text) as T;
          } catch (parseError) {
            result = text as T;
          }
        }
      }

      if (this.debug) {
        console.log(
          `[INFO][${this.category}] ${method} ${path} [${requestId}] completed`,
          {
            status: response.status,
            duration: `${duration}ms`,
          },
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (this.debug) {
        console.log(
          `[ERROR][${this.category}] ${method} ${path} [${requestId}] failed`,
          {
            url,
            duration: `${duration}ms`,
            error: error instanceof Error ? error.message : String(error),
            body,
            query,
          },
        );
      }

      // If this is already an API error, just re-throw it (already added to history above)
      if (error instanceof ApiError || error instanceof AuthenticationError) {
        throw error;
      }

      // Handle network error
      historyEntry.duration = duration;

      try {
        handleNetworkError(error);
      } catch (networkError) {
        const errorMessage =
          networkError instanceof Error
            ? networkError.message
            : "Unknown network error";
        historyEntry.error = errorMessage;
        this.request_history.add(historyEntry);
        throw networkError;
      }
    }
  }

  public get<T>(
    path: string,
    options: Omit<RequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request(path, { ...options, method: "GET" });
  }

  public post<T>(
    path: string,
    options: Omit<RequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request(path, { ...options, method: "POST" });
  }

  public patch<T>(
    path: string,
    options: Omit<RequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request(path, { ...options, method: "PATCH" });
  }

  public put<T>(
    path: string,
    options: Omit<RequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request(path, { ...options, method: "PUT" });
  }

  public delete<T>(
    path: string,
    options: Omit<RequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request(path, { ...options, method: "DELETE" });
  }

  public history() {
    return this.request_history;
  }

  public url(): string {
    return this.base_url;
  }

  public headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.auth_mode === "session") {
      headers.Authorization = `Bearer jwt:${this.api_key.replace(/^jwt:/, "")}`;
    } else if (this.auth_mode === "key") {
      headers["X-API-KEY"] = this.api_key;
    }

    return headers;
  }
}
