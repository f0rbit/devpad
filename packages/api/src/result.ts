/**
 * Result type system for clean error handling in API operations
 * Provides type-safe success/failure patterns with context-aware property names
 */

// Success type with dynamic property name
export type Success<TData, TName extends string> = {
	[K in TName]: TData;
} & {
	error: null;
};

// Failure type with null for the named property
export type Failure<TName extends string> = {
	[K in TName]: null;
} & {
	error: {
		message: string;
		code?: string;
		status_code?: number;
	};
};

// Combined Result type
export type Result<TData, TName extends string> = Success<TData, TName> | Failure<TName>;

/**
 * Wraps any async function with Result type for clean error handling
 * Automatically generates context-aware property names
 *
 * @param fn - The async function to wrap
 * @param data_name - The property name for the data in the result
 * @returns Promise that resolves to Result type with success/error pattern
 *
 * @example
 * ```typescript
 * const getProject = (id: string) =>
 *   wrap(() => client.projects.find(id), 'project');
 *
 * const { project, error } = await getProject('123');
 * if (error) {
 *   console.error(error.message);
 *   return;
 * }
 * // project is guaranteed to be non-null here
 * ```
 */
export function wrap<TData, TName extends string>(fn: () => Promise<TData>, data_name: TName): Promise<Result<TData, TName>> {
	return fn()
		.then(data => {
			const result = { error: null } as any;
			result[data_name] = data;
			return result as Success<TData, TName>;
		})
		.catch(error => {
			const result = {
				error: {
					message: error.message || `Failed to fetch ${data_name}`,
					code: error.code,
					status_code: error.statusCode || error.status_code,
				},
			} as any;
			result[data_name] = null;
			return result as Failure<TName>;
		});
}
