import ApiClient, { type ApiResultError } from "@devpad/api";
import { log } from "@devpad/core/logger";

// Global API client instance
let _apiClient: ApiClient | null = null;

/**
 * Get or create the global API client instance
 * This function handles both API key and JWT authentication
 */
export function getApiClient(): ApiClient {
	log.api("🔧 [API-CLIENT] Getting API client");

	if (_apiClient) {
		log.api(" Returning existing client");
		return _apiClient;
	}

	// Use current origin for API calls (works for both staging and production)
	const serverUrl = `${window.location.origin}/api/v1`;
	log.api(" Server URL:", serverUrl);

	// Try JWT token first (session-based auth for normal users)
	const jwtToken = getJwtToken();
	const apiKey = getApiKey();

	log.api(" Auth tokens found:", {
		hasJwtToken: !!jwtToken,
		hasApiKey: !!apiKey,
		jwtPreview: jwtToken ? `${jwtToken.substring(0, 20)}...` : null,
		apiKeyPreview: apiKey ? `${apiKey.substring(0, 10)}...` : null,
	});

	// Priority 1: JWT token (session mode for OAuth users)
	if (jwtToken) {
		log.api(" Using JWT token authentication (session mode)");
		_apiClient = new ApiClient({
			base_url: serverUrl,
			api_key: `jwt:${jwtToken}`,
			auth_mode: "session",
		});
		return _apiClient;
	}

	// Priority 2: API key (key mode for API users)
	if (apiKey) {
		log.api(" Using API key authentication (key mode)");
		_apiClient = new ApiClient({
			base_url: serverUrl,
			api_key: apiKey,
			auth_mode: "key",
		});
		return _apiClient;
	}

	log.error(" No authentication found");
	throw new Error("No authentication found. Please log in or provide an API key.");
}

/**
 * Get API key from various sources
 * Priority: localStorage > sessionStorage > meta tag > cookie
 */
function getApiKey(): string | null {
	log.api(" Looking for API key");
	// Try localStorage first (persistent)
	if (typeof window !== "undefined") {
		const stored = localStorage.getItem("devpad_api_key");
		if (stored) {
			log.api(" Found API key in localStorage");
			return stored;
		}

		// Try sessionStorage (session only)
		const session = sessionStorage.getItem("devpad_api_key");
		if (session) {
			log.api(" Found API key in sessionStorage");
			return session;
		}

		// Try meta tag (server-side rendered)
		const meta = document.querySelector('meta[name="devpad-api-key"]');
		if (meta) {
			const key = meta.getAttribute("content");
			if (key) {
				log.api(" Found API key in meta tag");
				// Store it for future use
				localStorage.setItem("devpad_api_key", key);
				return key;
			}
		}

		// Try cookie as fallback
		const cookies = document.cookie.split(";");
		for (const cookie of cookies) {
			const [name, value] = cookie.trim().split("=");
			if (name === "devpad_api_key") {
				log.api(" Found API key in cookie");
				localStorage.setItem("devpad_api_key", value);
				return value;
			}
		}

		log.api(" No API key found in any storage");
	}

	return null;
}

/**
 * Set the API key for the current session
 */
export function setApiKey(apiKey: string, persist: boolean = true) {
	if (typeof window !== "undefined") {
		if (persist) {
			localStorage.setItem("devpad_api_key", apiKey);
		} else {
			sessionStorage.setItem("devpad_api_key", apiKey);
		}

		// Reset the client so it picks up the new key
		_apiClient = null;
	}
}

/**
 * Clear the API key and reset the client
 */
export function clearApiKey() {
	if (typeof window !== "undefined") {
		localStorage.removeItem("devpad_api_key");
		sessionStorage.removeItem("devpad_api_key");
		_apiClient = null;
	}
}

/**
 * Get JWT token from cookie
 */
function getJwtToken(): string | null {
	if (typeof window !== "undefined") {
		const cookies = document.cookie.split(";");
		log.api(" Checking cookies for JWT token:", cookies.length);
		for (const cookie of cookies) {
			const [name, value] = cookie.trim().split("=");
			if (name === "jwt-token") {
				log.api(" Found JWT token in cookie");
				return value;
			}
		}
		log.api(" No JWT token found in cookies");
	}
	return null;
}

/**
 * Check if an API key is available
 */
export function hasApiKey(): boolean {
	return getApiKey() !== null;
}

/**
 * Check if authentication (API key or JWT) is available
 */
export function hasAuth(): boolean {
	return getApiKey() !== null || getJwtToken() !== null;
}

/**
 * Get the current authentication mode
 */
export function getAuthMode(): "session" | "key" | null {
	const jwtToken = getJwtToken();
	const apiKey = getApiKey();

	if (jwtToken) return "session";
	if (apiKey) return "key";
	return null;
}

/**
 * Create an API client for server-side use (Astro SSR)
 * This bypasses browser-specific token discovery and uses provided tokens directly
 */
export function createServerApiClient(options: { jwt?: string; key?: string; server_url: string }): ApiClient {
	log.auth("Creating server API client", {
		hasJwtToken: !!options.jwt,
		hasApiKey: !!options.key,
	});

	// Priority: JWT first, then API key
	if (options.jwt) {
		log.auth("Using JWT token authentication (session mode)");
		return new ApiClient({
			base_url: options.server_url,
			api_key: `jwt:${options.jwt}`,
			auth_mode: "session",
		});
	}

	if (options.key) {
		log.auth("Using API key authentication (key mode)");
		return new ApiClient({
			base_url: options.server_url,
			api_key: options.key,
			auth_mode: "key",
		});
	}

	log.error("[AUTH] No authentication provided");
	throw new Error("No authentication provided for server API client");
}

/**
 * Create an API client from Astro.locals (convenience function)
 */
export function getServerApiClient(locals: any): ApiClient {
	if (!process.env.PUBLIC_API_SERVER_URL) throw new Error("PUBLIC_API_SERVER_URL is not set");

	return createServerApiClient({
		jwt: locals.jwtToken,
		server_url: process.env.PUBLIC_API_SERVER_URL,
	});
}

export function rethrow(error: ApiResultError) {
	return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
