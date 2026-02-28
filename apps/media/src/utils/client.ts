import { getBrowserClient } from "@devpad/core/ui/client";

const API_HOST = import.meta.env.PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");

export function getClient() {
	return getBrowserClient(API_HOST);
}

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const apiUrls = {
	host: API_HOST,
	media: (path: string) => `${API_HOST}/api${normalizePath(path)}`,
	auth: (path: string) => `${API_HOST}/api/auth${normalizePath(path)}`,
	timeline: (path = "") => `${API_HOST}/api/v1/timeline${path ? normalizePath(path) : ""}`,
	connections: (path = "") => `${API_HOST}/api/v1/connections${path ? normalizePath(path) : ""}`,
	profiles: (path = "") => `${API_HOST}/api/v1/profiles${path ? normalizePath(path) : ""}`,
	me: () => `${API_HOST}/api/v1/me`,
};

export { apiUrls };
