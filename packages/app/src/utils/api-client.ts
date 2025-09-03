import ApiClient from "@devpad/api";

// Global API client instance
let _apiClient: ApiClient | null = null;

/**
 * Get or create the global API client instance
 * This function handles both API key and JWT authentication
 */
export function getApiClient(): ApiClient {
	console.log("🔧 [API-CLIENT] Getting API client");

	if (_apiClient) {
		console.log("✅ [API-CLIENT] Returning existing client");
		return _apiClient;
	}

	// Get API server URL from environment variable or default to current origin + /api/v0
	const serverUrl = import.meta.env.PUBLIC_API_SERVER_URL || `${window.location.origin}/api/v0`;
	console.log("🌐 [API-CLIENT] Server URL:", serverUrl);

	// Try to get API key first (takes priority)
	const apiKey = getApiKey();
	const jwtToken = getJwtToken();

	console.log("🔍 [API-CLIENT] Auth tokens found:", {
		hasApiKey: !!apiKey,
		hasJwtToken: !!jwtToken,
		apiKeyPreview: apiKey ? `${apiKey.substring(0, 10)}...` : null,
		jwtPreview: jwtToken ? `${jwtToken.substring(0, 20)}...` : null,
	});

	if (apiKey) {
		console.log("🗝️  [API-CLIENT] Using API key authentication");
		_apiClient = new ApiClient({
			base_url: serverUrl,
			api_key: apiKey,
		});
		return _apiClient;
	}

	// If no API key, try JWT token
	if (jwtToken) {
		console.log("🎟️  [API-CLIENT] Using JWT token authentication");
		_apiClient = new ApiClient({
			base_url: serverUrl,
			api_key: `jwt:${jwtToken}`, // Use a special prefix to indicate JWT
		});
		return _apiClient;
	}

	console.error("❌ [API-CLIENT] No authentication found");
	throw new Error("No authentication found. Please log in or provide an API key.");
}

/**
 * Get API key from various sources
 * Priority: localStorage > sessionStorage > meta tag > cookie
 */
function getApiKey(): string | null {
	console.log("🔑 [API-CLIENT] Looking for API key");
	// Try localStorage first (persistent)
	if (typeof window !== "undefined") {
		const stored = localStorage.getItem("devpad_api_key");
		if (stored) {
			console.log("✅ [API-CLIENT] Found API key in localStorage");
			return stored;
		}

		// Try sessionStorage (session only)
		const session = sessionStorage.getItem("devpad_api_key");
		if (session) {
			console.log("✅ [API-CLIENT] Found API key in sessionStorage");
			return session;
		}

		// Try meta tag (server-side rendered)
		const meta = document.querySelector('meta[name="devpad-api-key"]');
		if (meta) {
			const key = meta.getAttribute("content");
			if (key) {
				console.log("✅ [API-CLIENT] Found API key in meta tag");
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
				console.log("✅ [API-CLIENT] Found API key in cookie");
				localStorage.setItem("devpad_api_key", value);
				return value;
			}
		}

		console.log("❌ [API-CLIENT] No API key found in any storage");
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
		console.log("🍪 [API-CLIENT] Checking cookies for JWT token:", cookies.length);
		for (const cookie of cookies) {
			const [name, value] = cookie.trim().split("=");
			if (name === "jwt-token") {
				console.log("🎟️  [API-CLIENT] Found JWT token in cookie");
				return value;
			}
		}
		console.log("❌ [API-CLIENT] No JWT token found in cookies");
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
