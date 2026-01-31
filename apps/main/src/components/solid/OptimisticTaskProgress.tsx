import type { Task, TaskWithDetails } from "@devpad/schema";
import Circle from "lucide-solid/icons/circle";
import CircleCheck from "lucide-solid/icons/circle-check";
import CircleDot from "lucide-solid/icons/circle-dot";
import Square from "lucide-solid/icons/square";
import SquareCheck from "lucide-solid/icons/square-check";
import SquareDot from "lucide-solid/icons/square-dot";
import { Show } from "solid-js";
import { OptimisticStatus } from "@/components/solid/OptimisticStatus";
import { getApiClient } from "@/utils/api-client";
import { createOptimisticUpdate } from "@/utils/optimistic-updates";

type Progress = Task["progress"];

interface OptimisticTaskProgressProps {
	task: TaskWithDetails;
	type?: "circle" | "box";
	onUpdate?: (taskId: string, updates: { progress: Progress }) => void;
}

/**
 * Task progress component with optimistic updates
 * Shows immediate UI feedback while persisting changes to server
 */
export function OptimisticTaskProgress(props: OptimisticTaskProgressProps) {
	const type = () => props.type || "circle";

	// Set up optimistic update for the task's progress
	const progressUpdate = createOptimisticUpdate({
		initialData: props.task.task,
		updateFn: async updatedTask => {
			const apiClient = getApiClient();
			const result = await apiClient.tasks.upsert({
				id: updatedTask.id,
				progress: updatedTask.progress,
				owner_id: updatedTask.owner_id,
			});
			if (!result.ok) throw new Error(result.error?.message ?? "Failed to update task");
			return result.value.task;
		},
		showSuccessToast: false, // No toast for quick actions
		showErrorToast: true,
		successMessage: "Task progress updated",
		errorTitle: "Failed to update task",
		onSuccess: updatedTask => {
			// Notify parent component of successful update
			props.onUpdate?.(updatedTask.id, { progress: updatedTask.progress });
		},
	});

	const currentProgress = () => progressUpdate.data().progress;
	const isLoading = () => progressUpdate.isLoading();
	const isSuccess = () => progressUpdate.isSuccess();

	const nextProgress = (current: Progress): Progress => {
		switch (current) {
			case "UNSTARTED":
				return "IN_PROGRESS";
			case "IN_PROGRESS":
				return "COMPLETED";
			case "COMPLETED":
				return "UNSTARTED";
			default:
				return "UNSTARTED";
		}
	};

	const handleProgressClick = () => {
		const current = currentProgress();
		const next = nextProgress(current);
		progressUpdate.updateFields({ progress: next });
	};

	const ProgressIcon = () => {
		const progress = currentProgress();

		if (type() === "box") {
			switch (progress) {
				case "COMPLETED":
					return <SquareCheck class="text-green-600" />;
				case "IN_PROGRESS":
					return <SquareDot class="text-blue-600" />;
				case "UNSTARTED":
					return <Square class="text-gray-400" />;
				default:
					return <Square class="text-gray-400" />;
			}
		} else {
			switch (progress) {
				case "COMPLETED":
					return <CircleCheck class="text-green-600" />;
				case "IN_PROGRESS":
					return <CircleDot class="text-blue-600" />;
				case "UNSTARTED":
					return <Circle class="text-gray-400" />;
				default:
					return <Circle class="text-gray-400" />;
			}
		}
	};

	return (
		<div class="relative inline-flex items-center">
			<button
				onClick={handleProgressClick}
				disabled={isLoading()}
				class={`
					p-1 rounded transition-colors
					hover:bg-gray-100 active:bg-gray-200
					${isLoading() ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
				`}
				title={`Click to mark as ${nextProgress(currentProgress()).toLowerCase().replace("_", " ")}`}
			>
				<ProgressIcon />
			</button>

			{/* Status overlay for loading/success states */}
			<Show when={isLoading() || isSuccess()}>
				<div class="absolute -top-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
					<OptimisticStatus state={progressUpdate.state()} size="sm" />
				</div>
			</Show>
		</div>
	);
}

/**
 * Example of how to use the OptimisticTaskProgress in existing TaskCard
 * This shows the integration pattern
 */
export function ExampleUsage() {
	return `
// In your existing TaskCard.tsx, replace the progress onClick handler with:

<OptimisticTaskProgress 
	task={fetched_task}
	type="box"
	onUpdate={(taskId, updates) => {
		// This callback fires when the server confirms the update
		props.update?.(taskId, updates);
	}}
/>

// The component will:
// 1. Immediately update the UI when clicked
// 2. Show a small spinner while saving
// 3. Show a checkmark for 2 seconds on success
// 4. Show error toast and revert on failure
	`;
}
