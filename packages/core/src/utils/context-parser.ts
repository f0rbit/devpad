/**
 * Utility for parsing context data from various formats
 * Shared between frontend and backend for consistency
 */

/**
 * Parses context data from various formats into a string array.
 * Handles JSON strings, arrays, objects, and invalid data gracefully.
 *
 * @param context - The context data which can be a JSON string, array, object, or other
 * @returns Array of strings, or empty array if invalid
 */
export function parseContextToArray(context: any): string[] {
	if (!context) return [];

	// If already an array, return it (ensuring all elements are strings)
	if (Array.isArray(context)) {
		return context.filter(item => typeof item === "string" || typeof item === "number").map(item => String(item));
	}

	// If it's a string, try to parse as JSON
	if (typeof context === "string") {
		try {
			const parsed = JSON.parse(context);
			// Recursively call to handle the parsed result
			return parseContextToArray(parsed);
		} catch {
			// If parsing fails, return the string as a single-element array
			return [context];
		}
	}

	// For any other type (object, number, etc.), return empty array
	return [];
}
