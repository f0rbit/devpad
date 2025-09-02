import { createSignal, createStore } from "solid-js/store";
import { createSignal as signal } from "solid-js";

/**
 * Form state management utilities for SolidJS components
 * Reduces duplication in TaskEditor, TagEditor, and other form components
 */

export type RequestState = "idle" | "loading" | "success" | "error";

export interface FormState<T> {
	data: T;
	requestState: RequestState;
	errors: Record<string, string>;
}

/**
 * Hook for managing form state with built-in loading and error handling
 */
export function createFormStore<T extends Record<string, any>>(initialData: T) {
	const [state, setState] = createStore<FormState<T>>({
		data: initialData,
		requestState: "idle" as RequestState,
		errors: {},
	});

	const updateField = (field: keyof T, value: T[keyof T]) => {
		setState("data", field, value);
		// Clear error when field is updated
		if (state.errors[field as string]) {
			setState("errors", field as string, undefined);
		}
	};

	const setError = (field: string, error: string) => {
		setState("errors", field, error);
	};

	const clearError = (field: string) => {
		setState("errors", field, undefined);
	};

	const clearAllErrors = () => {
		setState("errors", {});
	};

	const setRequestState = (newState: RequestState) => {
		setState("requestState", newState);
	};

	const reset = () => {
		setState("data", initialData);
		setState("requestState", "idle");
		setState("errors", {});
	};

	return {
		state,
		setState,
		updateField,
		setError,
		clearError,
		clearAllErrors,
		setRequestState,
		reset,
	};
}

/**
 * Hook for managing simple loading states (commonly used for save buttons)
 */
export function createRequestState(initialState: RequestState = "idle") {
	const [requestState, setRequestState] = signal<RequestState>(initialState);

	const setLoading = () => setRequestState("loading");
	const setSuccess = () => setRequestState("success");
	const setError = () => setRequestState("error");
	const setIdle = () => setRequestState("idle");

	// Auto-reset success/error states after delay
	const setTempState = (tempState: "success" | "error", delay: number = 3000) => {
		setRequestState(tempState);
		setTimeout(() => {
			if (requestState() === tempState) {
				setRequestState("idle");
			}
		}, delay);
	};

	return {
		requestState,
		setRequestState,
		setLoading,
		setSuccess: () => setTempState("success"),
		setError: () => setTempState("error"),
		setIdle,
		isLoading: () => requestState() === "loading",
		isSuccess: () => requestState() === "success",
		isError: () => requestState() === "error",
		isIdle: () => requestState() === "idle",
	};
}

/**
 * Generic async form submit handler with error handling
 */
export async function handleFormSubmit<T, R>(formStore: ReturnType<typeof createFormStore<T>>, submitFn: (data: T) => Promise<R>, onSuccess?: (result: R) => void, onError?: (error: unknown) => void): Promise<R | null> {
	formStore.setRequestState("loading");
	formStore.clearAllErrors();

	try {
		const result = await submitFn(formStore.state.data);
		formStore.setRequestState("success");
		onSuccess?.(result);

		// Auto-reset to idle after success
		setTimeout(() => {
			if (formStore.state.requestState === "success") {
				formStore.setRequestState("idle");
			}
		}, 3000);

		return result;
	} catch (error) {
		console.error("Form submission error:", error);
		formStore.setRequestState("error");
		onError?.(error);

		// Auto-reset to idle after error
		setTimeout(() => {
			if (formStore.state.requestState === "error") {
				formStore.setRequestState("idle");
			}
		}, 5000);

		return null;
	}
}

/**
 * Validation utilities
 */
export const validators = {
	required: (value: any): string | null => {
		if (!value || (typeof value === "string" && value.trim() === "")) {
			return "This field is required";
		}
		return null;
	},

	minLength:
		(min: number) =>
		(value: string): string | null => {
			if (value && value.length < min) {
				return `Must be at least ${min} characters`;
			}
			return null;
		},

	maxLength:
		(max: number) =>
		(value: string): string | null => {
			if (value && value.length > max) {
				return `Must be no more than ${max} characters`;
			}
			return null;
		},

	email: (value: string): string | null => {
		if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
			return "Must be a valid email address";
		}
		return null;
	},
};

/**
 * Validate a form field
 */
export function validateField<T>(formStore: ReturnType<typeof createFormStore<T>>, fieldName: keyof T, validatorFns: Array<(value: any) => string | null>): boolean {
	const value = formStore.state.data[fieldName];

	for (const validator of validatorFns) {
		const error = validator(value);
		if (error) {
			formStore.setError(fieldName as string, error);
			return false;
		}
	}

	formStore.clearError(fieldName as string);
	return true;
}

/**
 * Validate entire form
 */
export function validateForm<T>(formStore: ReturnType<typeof createFormStore<T>>, validationRules: Record<keyof T, Array<(value: any) => string | null>>): boolean {
	let isValid = true;

	for (const [fieldName, validatorFns] of Object.entries(validationRules)) {
		const fieldValid = validateField(formStore, fieldName as keyof T, validatorFns);
		if (!fieldValid) {
			isValid = false;
		}
	}

	return isValid;
}
