import type { Result } from "@f0rbit/corpus";
import { createSignal } from "solid-js";

export type FormState = {
	submitting: () => boolean;
	error: () => string | null;
	setError: (error: string | null) => void;
	handleSubmit: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
	/** Handle a function that returns a Result - extracts error message automatically */
	handleSubmitResult: <T, E>(fn: () => Promise<Result<T, E>>, formatError?: (e: E) => string) => Promise<T | undefined>;
};

export const form = {
	create(): FormState {
		const [submitting, setSubmitting] = createSignal(false);
		const [error, setError] = createSignal<string | null>(null);

		const handleSubmit = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
			setSubmitting(true);
			setError(null);
			try {
				const result = await fn();
				return result;
			} catch (err) {
				setError(err instanceof Error ? err.message : "Operation failed");
				return undefined;
			} finally {
				setSubmitting(false);
			}
		};

		const handleSubmitResult = async <T, E>(fn: () => Promise<Result<T, E>>, formatError?: (e: E) => string): Promise<T | undefined> => {
			setSubmitting(true);
			setError(null);
			try {
				const result = await fn();
				if (!result.ok) {
					const errorMsg = formatError ? formatError(result.error) : typeof result.error === "object" && result.error !== null && "message" in result.error ? (result.error as { message: string }).message : String(result.error);
					setError(errorMsg);
					return undefined;
				}
				return result.value;
			} catch (err) {
				setError(err instanceof Error ? err.message : "Operation failed");
				return undefined;
			} finally {
				setSubmitting(false);
			}
		};

		return { submitting, error, setError, handleSubmit, handleSubmitResult };
	},
};
