/**
 * Utility for parsing context data from various formats
 * Shared between frontend and backend for consistency
 */

import { createLogger } from "./logger";

/**
 * Parses context data from various formats into a string array.
 * Handles JSON strings, arrays, objects, and invalid data gracefully.
 *
 * @param context - The context data which can be a JSON string, array, object, or other
 * @returns Array of strings, or empty array if invalid
 */
export function parseContextToArray(context: unknown): string[] {
	if (!context) return [];

	// If already an array, return it (ensuring all elements are strings)
	if (Array.isArray(context)) {
		return context.filter((item) => typeof item === "string" || typeof item === "number").map((item) => String(item));
	}

	// If it's a string, try to parse as JSON
	if (typeof context === "string") {
		try {
			const parsed = JSON.parse(context);
			// Recursively call to handle the parsed result
			return parseContextToArray(parsed);
		} catch (error) {
			// Not JSON -- degrade to treating the string as a single literal element,
			// now with a visible breadcrumb instead of a silent discard.
			createLogger("core.context").debug("context string is not JSON, using literal", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [context];
		}
	}

	// For any other type (object, number, etc.), return empty array
	return [];
}
