/**
 * System-wide configurable debug logging
 * Centralized logging configuration for all DevPad packages
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
	startup: boolean;
}

// 🎯 CENTRAL DEBUG CONFIGURATION - Control all logging from here
const DEBUG_LOGS: DebugConfig = {
	auth: false, // Authentication flows (login, logout, sessions)
	tasks: false, // Task operations (create, update, delete)
	projects: false, // Project operations (create, update, scan)
	repos: false, // GitHub repository operations
	middleware: false, // Request middleware processing
	api: false, // General API operations
	server: false, // Server startup & configuration
	scanning: false, // Codebase scanning operations
	github: false, // GitHub API interactions
	jwt: false, // JWT token operations
	database: false, // Database operations
	startup: false, // Application startup messages
};

/**
 * Environment-based debug control
 * Set DEBUG_CATEGORIES="auth,projects,scanning" to enable specific categories
 * Set DEBUG_ALL=true to enable all logging
 */
function getDebugConfig(): DebugConfig {
	// Enable all logging if DEBUG_ALL is set
	if (process.env.DEBUG_ALL === "true") {
		const allEnabled = {} as DebugConfig;
		Object.keys(DEBUG_LOGS).forEach(key => {
			allEnabled[key as keyof DebugConfig] = true;
		});
		return allEnabled;
	}

	const envDebug = process.env.DEBUG_CATEGORIES;
	if (!envDebug) return DEBUG_LOGS;

	// Parse comma-separated categories from environment
	const enabledCategories = envDebug.split(",").map(s => s.trim());
	const config = { ...DEBUG_LOGS };

	// Reset all to false, then enable only specified categories
	Object.keys(config).forEach(key => {
		config[key as keyof DebugConfig] = enabledCategories.includes(key);
	});

	return config;
}

const debugConfig = getDebugConfig();

/**
 * System-wide configurable logger with category-based filtering
 * Import this in any package to get consistent logging behavior
 */
export const log = {

	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
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
	auth: (message: string, data?: any) => {
		if (debugConfig.auth) {
			if (data) {
				console.log(`🔐 [AUTH] ${message}`, data);
			} else {
				console.log(`🔐 [AUTH] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Task operations (create, update, delete, history)
	 */
	tasks: (message: string, data?: any) => {
		if (debugConfig.tasks) {
			if (data) {
				console.log(`📋 [TASKS] ${message}`, data);
			} else {
				console.log(`📋 [TASKS] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Project operations (create, update, config, scan)
	 */
	projects: (message: string, data?: any) => {
		if (debugConfig.projects) {
			if (data) {
				console.log(`📁 [PROJECTS] ${message}`, data);
			} else {
				console.log(`📁 [PROJECTS] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * GitHub repository operations
	 */
	repos: (message: string, data?: any) => {
		if (debugConfig.repos) {
			if (data) {
				console.log(`🐙 [REPOS] ${message}`, data);
			} else {
				console.log(`🐙 [REPOS] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Request middleware processing
	 */
	middleware: (message: string, data?: any) => {
		if (debugConfig.middleware) {
			if (data) {
				console.log(`🔍 [MIDDLEWARE] ${message}`, data);
			} else {
				console.log(`🔍 [MIDDLEWARE] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * General API operations
	 */
	api: (message: string, data?: any) => {
		if (debugConfig.api) {
			if (data) {
				console.log(`📡 [API] ${message}`, data);
			} else {
				console.log(`📡 [API] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Server startup & configuration
	 */
	server: (message: string, data?: any) => {
		if (debugConfig.server) {
			if (data) {
				console.log(`🌐 [SERVER] ${message}`, data);
			} else {
				console.log(`🌐 [SERVER] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Codebase scanning operations
	 */
	scanning: (message: string, data?: any) => {
		if (debugConfig.scanning) {
			if (data) {
				console.log(`🔍 [SCANNING] ${message}`, data);
			} else {
				console.log(`🔍 [SCANNING] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * GitHub API interactions
	 */
	github: (message: string, data?: any) => {
		if (debugConfig.github) {
			if (data) {
				console.log(`🐙 [GITHUB] ${message}`, data);
			} else {
				console.log(`🐙 [GITHUB] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * JWT token operations
	 */
	jwt: (message: string, data?: any) => {
		if (debugConfig.jwt) {
			if (data) {
				console.log(`🎟️  [JWT] ${message}`, data);
			} else {
				console.log(`🎟️  [JWT] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Database operations
	 */
	database: (message: string, data?: any) => {
		if (debugConfig.database) {
			if (data) {
				console.log(`💾 [DATABASE] ${message}`, data);
			} else {
				console.log(`💾 [DATABASE] ${message}`);
			}
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},

	/**
	 * Always log errors (can't be disabled)
	 */
	error: (message: string, error?: any) => {
		if (error) {
			console.error(`❌ [ERROR] ${message}`, error);
		} else {
			console.error(`❌ [ERROR] ${message}`);
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Always log important info (can't be disabled)
	 */
	info: (message: string, data?: any) => {
		if (data) {
			console.log(`ℹ️  [INFO] ${message}`, data);
		} else {
			console.log(`ℹ️  [INFO] ${message}`);
		}
	},


	/**
	 * Application startup messages (migrations, server start, config)
	 */
	startup: (message: string, data?: any) => {
		if (debugConfig.startup) {
			if (data) {
				console.log(`🚀 [STARTUP] ${message}`, data);
			} else {
				console.log(`🚀 [STARTUP] ${message}`);
			}
		}
	},
	/**
	 * Always log warnings (can't be disabled)
	 */
	warn: (message: string, data?: any) => {
		if (data) {
			console.warn(`⚠️  [WARN] ${message}`, data);
		} else {
			console.warn(`⚠️  [WARN] ${message}`);
		}
	},
};
