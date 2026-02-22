import { createSignal, onCleanup } from "solid-js";

// Import the getUserFriendlyErrorMessage function
// Note: Import directly from the source since package exports may not be available yet
function getUserFriendlyErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return "An unexpected error occurred";
}

export type UpdateState = "idle" | "loading" | "success" | "error";

export interface OptimisticUpdateOptions<T> {
	/** The initial data */
	initialData: T;
	/** Function to call to persist the update to the server */
	updateFn: (data: T) => Promise<T>;
	/** How long to show the success state (default: 2000ms) */
	successDuration?: number;
	/** How long to show the error state (default: 5000ms) */
	errorDuration?: number;
	/** Callback when update succeeds */
	onSuccess?: (data: T) => void;
	/** Callback when update fails */
	onError?: (error: unknown, originalData: T) => void;
}

export interface OptimisticUpdateResult<T> {
	/** Current data (optimistically updated) */
	data: () => T;
	/** Current update state */
	state: () => UpdateState;
	/** Error message if in error state */
	error: () => string | null;
	/** Update the data optimistically and persist to server */
	update: (newData: T) => Promise<void>;
	/** Update specific fields optimistically */
	updateFields: (updates: Partial<T>) => Promise<void>;
	/** Reset to initial state */
	reset: () => void;
	/** Whether currently loading */
	isLoading: () => boolean;
	/** Whether in success state */
	isSuccess: () => boolean;
	/** Whether in error state */
	isError: () => boolean;
}

/**
 * Hook for optimistic updates with automatic state management
 *
 * @example
 * const taskUpdate = createOptimisticUpdate({
 *   initialData: task,
 *   updateFn: async (updatedTask) => {
 *     return await apiClient.tasks.update(updatedTask.id, updatedTask);
 *   },
 *   onSuccess: () => console.log("Task updated successfully"),
 *   onError: (error) => console.error("Update failed:", error)
 * });
 *
 * // Usage in component
 * <button onClick={() => taskUpdate.updateFields({ progress: "COMPLETED" })}>
 *   Mark Complete
 * </button>
 */
export function createOptimisticUpdate<T extends Record<string, any>>(options: OptimisticUpdateOptions<T>): OptimisticUpdateResult<T> {
	const { initialData, updateFn, successDuration = 2000, errorDuration = 5000, onSuccess, onError } = options;

	const [data, setData] = createSignal<T>(initialData);
	const [state, setState] = createSignal<UpdateState>("idle");
	const [error, setError] = createSignal<string | null>(null);

	let successTimeout: number | undefined;
	let errorTimeout: number | undefined;

	// Clean up timeouts on component unmount
	onCleanup(() => {
		if (successTimeout) clearTimeout(successTimeout);
		if (errorTimeout) clearTimeout(errorTimeout);
	});

	const update = async (newData: T): Promise<void> => {
		// Clear any existing timeouts
		if (successTimeout) clearTimeout(successTimeout);
		if (errorTimeout) clearTimeout(errorTimeout);

		// Store original data for rollback
		const originalData = data();

		// Optimistically update the UI
		setData(() => newData);
		setState("loading");
		setError(null);

		try {
			// Persist to server
			const result = await updateFn(newData);

			// Update with server response
			setData(() => result);
			setState("success");

			// Show success state for specified duration
			successTimeout = window.setTimeout(() => {
				setState("idle");
			}, successDuration);

			// Call success callback
			onSuccess?.(result);
		} catch (err) {
			// Rollback optimistic update
			setData(() => originalData);
			setState("error");

			// Set user-friendly error message
			const errorMessage = getUserFriendlyErrorMessage(err);
			setError(errorMessage);

			// Show error state for specified duration
			errorTimeout = window.setTimeout(() => {
				setState("idle");
				setError(null);
			}, errorDuration);

			// Call error callback
			onError?.(err, originalData);
		}
	};

	const updateFields = async (updates: Partial<T>): Promise<void> => {
		const newData = { ...data(), ...updates };
		return update(newData);
	};

	const reset = () => {
		if (successTimeout) clearTimeout(successTimeout);
		if (errorTimeout) clearTimeout(errorTimeout);
		setData(() => initialData);
		setState("idle");
		setError(null);
	};

	return {
		data,
		state,
		error,
		update,
		updateFields,
		reset,
		isLoading: () => state() === "loading",
		isSuccess: () => state() === "success",
		isError: () => state() === "error",
	};
}

/**
 * Hook for optimistic form state management
 */
export function createOptimisticForm<T extends Record<string, any>>(
	options: OptimisticUpdateOptions<T> & {
		/** Validation function */
		validate?: (data: T) => Record<keyof T, string> | null;
	}
) {
	const optimisticUpdate = createOptimisticUpdate(options);
	const [validationErrors, setValidationErrors] = createSignal<Record<keyof T, string> | null>(null);

	const updateWithValidation = async (newData: T): Promise<void> => {
		// Clear previous validation errors
		setValidationErrors(null);

		// Validate if validation function provided
		if (options.validate) {
			const errors = options.validate(newData);
			if (errors) {
				setValidationErrors(() => errors);
				return;
			}
		}

		return optimisticUpdate.update(newData);
	};

	const updateFieldsWithValidation = async (updates: Partial<T>): Promise<void> => {
		const newData = { ...optimisticUpdate.data(), ...updates };
		return updateWithValidation(newData);
	};

	return {
		...optimisticUpdate,
		update: updateWithValidation,
		updateFields: updateFieldsWithValidation,
		validationErrors,
		clearValidationErrors: () => setValidationErrors(null),
		isValid: () => validationErrors() === null,
	};
}

/**
 * Hook for list-based optimistic updates (for arrays of items)
 */
export function createOptimisticList<T extends { id: string }>(options: {
	initialItems: T[];
	updateItemFn: (item: T) => Promise<T>;
	createItemFn?: (item: Omit<T, "id">) => Promise<T>;
	deleteItemFn?: (id: string) => Promise<void>;
	onSuccess?: (action: "update" | "create" | "delete", item?: T) => void;
	onError?: (error: unknown, action: "update" | "create" | "delete", item?: T) => void;
}) {
	const [items, setItems] = createSignal<T[]>(options.initialItems);
	const [loadingItems, setLoadingItems] = createSignal<Set<string>>(new Set());
	const [errorItems, setErrorItems] = createSignal<Map<string, string>>(new Map());

	const updateItem = async (id: string, updates: Partial<T>): Promise<void> => {
		const originalItems = items();
		const itemIndex = originalItems.findIndex(item => item.id === id);

		if (itemIndex === -1) return;

		const originalItem = originalItems[itemIndex];
		const updatedItem = { ...originalItem, ...updates } as T;

		// Optimistically update
		const newItems = [...originalItems];
		newItems[itemIndex] = updatedItem;
		setItems(newItems);

		// Add to loading state
		setLoadingItems(prev => new Set([...prev, id]));

		// Clear any previous error
		setErrorItems(prev => {
			const newMap = new Map(prev);
			newMap.delete(id);
			return newMap;
		});

		try {
			const result = await options.updateItemFn(updatedItem);

			// Update with server response
			const finalItems = items().map(item => (item.id === id ? result : item));
			setItems(finalItems);

			options.onSuccess?.("update", result);
		} catch (error) {
			// Rollback
			setItems(originalItems);

			// Set error state
			const errorMessage = getUserFriendlyErrorMessage(error);
			setErrorItems(prev => new Map(prev.set(id, errorMessage)));

			options.onError?.(error, "update", originalItem);
		} finally {
			// Remove from loading state
			setLoadingItems(prev => {
				const newSet = new Set(prev);
				newSet.delete(id);
				return newSet;
			});
		}
	};

	const createItem = async (newItem: Omit<T, "id">): Promise<void> => {
		if (!options.createItemFn) return;

		const tempId = crypto.randomUUID();
		const tempItem = { ...newItem, id: tempId } as T;

		// Optimistically add item
		setItems(prev => [...prev, tempItem]);
		setLoadingItems(prev => new Set([...prev, tempId]));

		try {
			const result = await options.createItemFn(newItem);

			// Replace temp item with real item
			setItems(prev => prev.map(item => (item.id === tempId ? result : item)));

			options.onSuccess?.("create", result);
		} catch (error) {
			// Remove temp item
			setItems(prev => prev.filter(item => item.id !== tempId));

			const errorMessage = getUserFriendlyErrorMessage(error);
			setErrorItems(prev => new Map(prev.set(tempId, errorMessage)));

			options.onError?.(error, "create", tempItem);
		} finally {
			setLoadingItems(prev => {
				const newSet = new Set(prev);
				newSet.delete(tempId);
				return newSet;
			});
		}
	};

	const deleteItem = async (id: string): Promise<void> => {
		if (!options.deleteItemFn) return;

		const originalItems = items();
		const itemToDelete = originalItems.find(item => item.id === id);

		if (!itemToDelete) return;

		// Optimistically remove item
		setItems(prev => prev.filter(item => item.id !== id));
		setLoadingItems(prev => new Set([...prev, id]));

		try {
			await options.deleteItemFn(id);
			options.onSuccess?.("delete", itemToDelete);
		} catch (error) {
			// Restore item
			setItems(originalItems);

			const errorMessage = getUserFriendlyErrorMessage(error);
			setErrorItems(prev => new Map(prev.set(id, errorMessage)));

			options.onError?.(error, "delete", itemToDelete);
		} finally {
			setLoadingItems(prev => {
				const newSet = new Set(prev);
				newSet.delete(id);
				return newSet;
			});
		}
	};

	return {
		items,
		updateItem,
		createItem: options.createItemFn ? createItem : undefined,
		deleteItem: options.deleteItemFn ? deleteItem : undefined,
		isItemLoading: (id: string) => loadingItems().has(id),
		getItemError: (id: string) => errorItems().get(id) || null,
		clearItemError: (id: string) => {
			setErrorItems(prev => {
				const newMap = new Map(prev);
				newMap.delete(id);
				return newMap;
			});
		},
	};
}
