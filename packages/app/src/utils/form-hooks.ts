import { createStore } from "solid-js/store";
import { createOptimisticUpdate, createOptimisticForm, type OptimisticUpdateOptions } from "./optimistic-updates";

/**
 * Form state management utilities for SolidJS components
 * Reduces duplication in TaskEditor, TagEditor, and other form components
 * Now includes optimistic update capabilities
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

	const updateField = (field: string, value: any) => {
		setState("data", field as any, value);
		// Clear error when field is updated
		if (state.errors[field]) {
			setState("errors", field, "");
		}
	};

	const setError = (field: string, message: string) => {
		setState("errors", field, message);
	};

	const clearErrors = () => {
		setState("errors", {});
	};

	const setLoading = () => {
		setState("requestState", "loading");
	};

	const setSuccess = () => {
		setState("requestState", "success");
	};

	const setFailed = () => {
		setState("requestState", "error");
	};

	const setIdle = () => {
		setState("requestState", "idle");
	};

	return {
		state,
		updateField,
		setError,
		clearErrors,
		setLoading,
		setSuccess,
		setFailed,
		setIdle,
		isLoading: () => state.requestState === "loading",
		isSuccess: () => state.requestState === "success",
		isError: () => state.requestState === "error",
	};
}

/**
 * Enhanced form hook with optimistic updates
 * Perfect for forms that need immediate feedback
 */
export function createOptimisticFormStore<T extends Record<string, any>>(
	options: OptimisticUpdateOptions<T> & {
		validate?: (data: T) => Record<keyof T, string> | null;
	}
) {
	const optimisticForm = createOptimisticForm(options);

	const updateField = (field: string, value: any) => {
		const current = optimisticForm.data();
		const updated = { ...current, [field]: value };
		optimisticForm.update(updated);
	};

	const submitForm = () => {
		return optimisticForm.update(optimisticForm.data());
	};

	return {
		data: optimisticForm.data,
		state: optimisticForm.state,
		error: optimisticForm.error,
		validationErrors: optimisticForm.validationErrors,
		updateField,
		submitForm,
		reset: optimisticForm.reset,
		isLoading: optimisticForm.isLoading,
		isSuccess: optimisticForm.isSuccess,
		isError: optimisticForm.isError,
		isValid: optimisticForm.isValid,
	};
}

/**
 * Simplified hook for single-field optimistic updates
 * Great for toggles, dropdowns, and other simple controls
 */
export function createOptimisticField<T extends Record<string, any>>(
	initialValue: T,
	updateFn: (value: T) => Promise<T>,
	options: {
		showSuccessToast?: boolean;
		showErrorToast?: boolean;
		successMessage?: string;
		onSuccess?: (value: T) => void;
		onError?: (error: unknown) => void;
	} = {}
) {
	return createOptimisticUpdate({
		initialData: initialValue,
		updateFn: async (value: T) => updateFn(value),
		showSuccessToast: options.showSuccessToast || false,
		showErrorToast: options.showErrorToast !== false, // Default to true
		successMessage: options.successMessage || "Updated successfully",
		onSuccess: options.onSuccess,
		onError: options.onError,
	});
}

// Export the optimistic update utilities for direct use
export { createOptimisticUpdate, createOptimisticForm } from "./optimistic-updates";
