import DevpadApiClient from "@devpad/api";

// Global API client instance
let _apiClient: DevpadApiClient | null = null;

/**
 * Get or create the global API client instance
 * This function handles API key authentication and server URL configuration
 */
export function getApiClient(): DevpadApiClient {
	if (_apiClient) {
		return _apiClient;
	}

	// Get API server URL from environment variable or default to current origin + /api/v0
	const serverUrl = import.meta.env.PUBLIC_API_SERVER_URL || `${window.location.origin}/api/v0`;

	// Try to get API key from various sources
	let apiKey = getApiKey();

	if (!apiKey) {
		throw new Error("No API key found. Please ensure you are logged in and have an API key.");
	}

	_apiClient = new DevpadApiClient({
		base_url: serverUrl,
		api_key: apiKey,
	});

	return _apiClient;
}

/**
 * Get API key from various sources
 * Priority: localStorage > sessionStorage > meta tag > cookie
 */
function getApiKey(): string | null {
	// Try localStorage first (persistent)
	if (typeof window !== "undefined") {
		const stored = localStorage.getItem("devpad_api_key");
		if (stored) return stored;

		// Try sessionStorage (session only)
		const session = sessionStorage.getItem("devpad_api_key");
		if (session) return session;

		// Try meta tag (server-side rendered)
		const meta = document.querySelector('meta[name="devpad-api-key"]');
		if (meta) {
			const key = meta.getAttribute("content");
			if (key) {
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
				localStorage.setItem("devpad_api_key", value);
				return value;
			}
		}
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
 * Check if an API key is available
 */
export function hasApiKey(): boolean {
	return getApiKey() !== null;
}
