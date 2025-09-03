import type { TaskWithDetails } from "@devpad/schema";
import { getApiClient } from "@/utils/api-client";

export type Progress = TaskWithDetails["task"]["progress"];
export type Priority = TaskWithDetails["task"]["priority"];
export type Visibility = TaskWithDetails["task"]["visibility"];

// Progress state management
export const PROGRESS_OPTIONS = [
	{ value: "UNSTARTED", label: "Not Started" },
	{ value: "IN_PROGRESS", label: "In Progress" },
	{ value: "COMPLETED", label: "Completed" },
] as const;

export const PRIORITY_OPTIONS = [
	{ value: "LOW", label: "Low" },
	{ value: "MEDIUM", label: "Medium" },
	{ value: "HIGH", label: "High" },
] as const;

export const VISIBILITY_OPTIONS = [
	{ value: "PUBLIC", label: "Public" },
	{ value: "PRIVATE", label: "Private" },
	{ value: "HIDDEN", label: "Hidden" },
	{ value: "ARCHIVED", label: "Archived" },
	{ value: "DRAFT", label: "Draft" },
	{ value: "DELETED", label: "Deleted" },
] as const;

/**
 * Get the next progress state when advancing a task
 */
export function getNextProgress(currentProgress: Progress): Progress | null {
	switch (currentProgress) {
		case "UNSTARTED":
			return "IN_PROGRESS";
		case "IN_PROGRESS":
			return "COMPLETED";
		case "COMPLETED":
			return null; // Cannot progress further
		default:
			return null;
	}
}

/**
 * Check if a task can be progressed (not already completed)
 */
export function canProgress(progress: Progress): boolean {
	return progress !== "COMPLETED";
}

/**
 * Get CSS class for task priority
 */
export function getPriorityClass(priority: Priority, hasEndTime: boolean = true): string {
	switch (priority) {
		case "HIGH":
			return "priority-high";
		case "MEDIUM":
			return "priority-medium";
		case "LOW":
			return hasEndTime ? "priority-low" : "priority-none";
		default:
			return "priority-none";
	}
}

/**
 * Update task progress via API
 */
export async function updateTaskProgress(taskId: string, ownerId: string, newProgress: Progress, onSuccess?: (progress: Progress) => void, onError?: (error: any) => void): Promise<void> {
	try {
		const apiClient = getApiClient();
		await apiClient.tasks.upsert({
			id: taskId,
			progress: newProgress,
			owner_id: ownerId,
		});
		onSuccess?.(newProgress);
	} catch (error) {
		console.error("Error updating task progress:", error);
		onError?.(error);
	}
}

/**
 * Advance task to next progress state
 */
export async function advanceTaskProgress(taskId: string, ownerId: string, currentProgress: Progress, onSuccess?: (progress: Progress) => void, onError?: (error: any) => void): Promise<void> {
	const nextProgress = getNextProgress(currentProgress);
	if (!nextProgress) {
		console.warn("Cannot advance task progress: already at final state");
		return;
	}

	await updateTaskProgress(taskId, ownerId, nextProgress, onSuccess, onError);
}

/**
 * Format due date with relative time
 */
export function formatDueDate(date: string | null): string {
	if (!date) return "No due date";

	const now = new Date();
	const due = new Date(date);
	const past = now.getTime() > due.getTime();
	const diff = Math.abs(due.getTime() - now.getTime());

	const diffMinutes = diff / (1000 * 60);
	const diffHours = diffMinutes / 60;
	const diffDays = diffHours / 24;

	// Determine the appropriate span
	let span: string | null = null;
	if (diffMinutes < 60) {
		span = `${Math.round(diffMinutes)} minutes`;
	} else if (diffHours < 48) {
		span = `${Math.round(diffHours)} hours`;
	} else if (diffDays < 14) {
		span = `${Math.round(diffDays)} days`;
	}

	if (span) {
		return past ? `${span} ago` : span;
	}

	// Format as date
	const options = { month: "long", day: "numeric", year: "numeric" } as const;
	return new Intl.DateTimeFormat("en-US", options).format(due);
}

/**
 * Check if a due date is past due
 */
export function isPastDue(date: string | null): boolean {
	if (!date) return false;
	return new Date(date) < new Date();
}

/**
 * Get appropriate icon component name for progress state and type
 */
export function getProgressIconType(progress: Progress, type: "box" | "circle"): string {
	const baseType = type === "box" ? "Square" : "Circle";

	switch (progress) {
		case "UNSTARTED":
			return baseType; // Square or Circle
		case "IN_PROGRESS":
			return `${baseType}Dot`; // SquareDot or CircleDot
		case "COMPLETED":
			return `${baseType}Check`; // SquareCheck or CircleCheck
		default:
			return baseType;
	}
}

/**
 * Check if progress icon should be clickable
 */
export function isProgressClickable(progress: Progress): boolean {
	return progress !== "COMPLETED";
}
