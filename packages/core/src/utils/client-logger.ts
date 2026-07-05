/**
 * Browser-safe logger for client-side code
 * This version doesn't use process.env and is safe to import in client-side bundles
 */

interface DebugConfig {
	auth: boolean;
	tasks: boolean;
	projects: boolean;
	repos: boolean;
	middleware: boolean;
	api: boolean;
	server: boolean;
	scanning: boolean;
	github: boolean;
	jwt: boolean;
	database: boolean;
	startup: boolean;
}

// Simple client-side debug configuration (no process.env access)
const CLIENT_DEBUG_LOGS: DebugConfig = {
	auth: false,
	tasks: false,
	projects: false,
	repos: false,
	middleware: false,
	api: false,
	server: false,
	scanning: false,
	github: false,
	jwt: false,
	database: false,
	startup: false,
};

/**
 * Browser-safe logger with category-based filtering
 * Safe to import in client-side code (no server dependencies)
 */
export const log = {
	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.startup && typeof console !== "undefined") {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Authentication & JWT flows (login, logout, sessions, tokens)
	 */
	auth: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.auth && typeof console !== "undefined") {
			if (data) {
				console.log(`🔐 [AUTH] ${message}`, data);
			} else {
				console.log(`🔐 [AUTH] ${message}`);
			}
		}
	},

	/**
	 * Task operations (create, update, delete, history)
	 */
	tasks: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.tasks && typeof console !== "undefined") {
			if (data) {
				console.log(`📋 [TASKS] ${message}`, data);
			} else {
				console.log(`📋 [TASKS] ${message}`);
			}
		}
	},
	/**
	 * Project operations (create, update, config, scan)
	 */
	projects: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.projects && typeof console !== "undefined") {
			if (data) {
				console.log(`📁 [PROJECTS] ${message}`, data);
			} else {
				console.log(`📁 [PROJECTS] ${message}`);
			}
		}
	},
	/**
	 * GitHub repository operations
	 */
	repos: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.repos && typeof console !== "undefined") {
			if (data) {
				console.log(`🐙 [REPOS] ${message}`, data);
			} else {
				console.log(`🐙 [REPOS] ${message}`);
			}
		}
	},
	/**
	 * Request middleware processing
	 */
	middleware: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.middleware && typeof console !== "undefined") {
			if (data) {
				console.log(`🔍 [MIDDLEWARE] ${message}`, data);
			} else {
				console.log(`🔍 [MIDDLEWARE] ${message}`);
			}
		}
	},

	/**
	 * General API operations
	 */
	api: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.api && typeof console !== "undefined") {
			if (data) {
				console.log(`📡 [API] ${message}`, data);
			} else {
				console.log(`📡 [API] ${message}`);
			}
		}
	},

	/**
	 * Server startup & configuration
	 */
	server: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.server && typeof console !== "undefined") {
			if (data) {
				console.log(`🌐 [SERVER] ${message}`, data);
			} else {
				console.log(`🌐 [SERVER] ${message}`);
			}
		}
	},

	/**
	 * Codebase scanning operations
	 */
	scanning: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.scanning && typeof console !== "undefined") {
			if (data) {
				console.log(`🔍 [SCANNING] ${message}`, data);
			} else {
				console.log(`🔍 [SCANNING] ${message}`);
			}
		}
	},

	/**
	 * GitHub API interactions
	 */
	github: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.github && typeof console !== "undefined") {
			if (data) {
				console.log(`🐙 [GITHUB] ${message}`, data);
			} else {
				console.log(`🐙 [GITHUB] ${message}`);
			}
		}
	},

	/**
	 * JWT token operations
	 */
	jwt: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.jwt && typeof console !== "undefined") {
			if (data) {
				console.log(`🎟  [JWT] ${message}`, data);
			} else {
				console.log(`🎟  [JWT] ${message}`);
			}
		}
	},

	/**
	 * Database operations
	 */
	database: (message: string, data?: unknown) => {
		if (CLIENT_DEBUG_LOGS.database && typeof console !== "undefined") {
			if (data) {
				console.log(`💾 [DATABASE] ${message}`, data);
			} else {
				console.log(`💾 [DATABASE] ${message}`);
			}
		}
	},

	/**
	 * Always log errors (can't be disabled)
	 */
	error: (message: string, error?: unknown) => {
		if (typeof console !== "undefined") {
			if (error) {
				console.error(`❌ [ERROR] ${message}`, error);
			} else {
				console.error(`❌ [ERROR] ${message}`);
			}
		}
	},

	/**
	 * Always log important info (can't be disabled)
	 */
	info: (message: string, data?: unknown) => {
		if (typeof console !== "undefined") {
			if (data) {
				console.log(`i  [INFO] ${message}`, data);
			} else {
				console.log(`i  [INFO] ${message}`);
			}
		}
	},

	/**
	 * Always log warnings (can't be disabled)
	 */
	warn: (message: string, data?: unknown) => {
		if (typeof console !== "undefined") {
			if (data) {
				console.warn(`!  [WARN] ${message}`, data);
			} else {
				console.warn(`!  [WARN] ${message}`);
			}
		}
	},
};
