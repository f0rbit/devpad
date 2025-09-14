/**
 * Utility functions for handling code context and formatting
 */

/**
 * Builds a formatted context string from various input formats.
 * Handles JSON strings, arrays, and invalid data gracefully.
 *
 * @param context - The context data which can be a JSON string, array of strings, or other
 * @returns Formatted context string with normalized indentation, or null if invalid
 */
export function buildCodeContext(context: any): string | null {
	if (!context) return null;

	// Handle if context is a string (JSON) that needs parsing
	let contextArray: string[];
	if (typeof context === "string") {
		try {
			contextArray = JSON.parse(context);
		} catch {
			// If it's not valid JSON, treat it as a single-line context
			return context;
		}
	} else if (Array.isArray(context)) {
		contextArray = context;
	} else {
		return null;
	}

	// Ensure we have a valid array
	if (!Array.isArray(contextArray) || contextArray.length === 0) {
		return null;
	}

	// Find the minimum whitespace to normalize indentation
	const minWhitespace = contextArray.reduce((acc, line) => {
		// Skip empty lines when calculating minimum whitespace
		if (typeof line !== "string" || line.trim() === "") return acc;

		const whitespace = line.match(/^\s*/);
		if (whitespace) {
			return Math.min(acc, whitespace[0].length);
		}
		return acc;
	}, Infinity);

	// If no non-empty lines found, return null
	if (minWhitespace === Infinity) {
		return contextArray.join("\n");
	}

	// Remove the common indentation from all lines
	return contextArray.map(line => (typeof line === "string" ? line.slice(minWhitespace) : "")).join("\n");
}

/**
 * Formats a file path with optional line number
 *
 * @param file - The file path
 * @param line - Optional line number
 * @returns Formatted path string like "path/to/file.ts:42"
 */
export function formatCodeLocation(file?: string | null, line?: number | null): string {
	if (!file) return "unknown:?";

	let path = file;
	if (line) {
		path += `:${line}`;
	}
	return path;
}
