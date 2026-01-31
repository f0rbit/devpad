import type { Goal, Milestone } from "@devpad/schema";
import Check from "lucide-solid/icons/check";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { getApiClient } from "@/utils/api-client";

interface Props {
	mode: "create" | "edit";
	goal: Goal | null;
	milestones: Milestone[];
	onSuccess: (goal: Goal) => void;
	onCancel: () => void;
}

export function GoalQuickForm({ mode, goal, milestones, onSuccess, onCancel }: Props) {
	const [state, setState] = createStore({
		name: goal?.name ?? "",
		description: goal?.description ?? "",
		milestone_id: goal?.milestone_id ?? milestones[0]?.id ?? "",
		target_time: goal?.target_time ?? "",
	});

	const [requestState, setRequestState] = createSignal<"idle" | "loading" | "success" | "error">("idle");
	const [errorMessage, setErrorMessage] = createSignal("");

	const handleSubmit = async (e: Event) => {
		e.preventDefault();

		if (!state.name.trim()) {
			setErrorMessage("Goal name is required");
			return;
		}

		if (!state.milestone_id) {
			setErrorMessage("Please select a milestone");
			return;
		}

		setRequestState("loading");
		setErrorMessage("");

		try {
			const apiClient = getApiClient();

			let result;
			if (mode === "create") {
				const createResult = await apiClient.goals.create({
					milestone_id: state.milestone_id,
					name: state.name.trim(),
					description: state.description.trim() || undefined,
					target_time: state.target_time || undefined,
				});
				if (!createResult.ok) throw new Error(createResult.error.message);
				result = createResult.value;
			} else {
				const updateResult = await apiClient.goals.update(goal!.id, {
					name: state.name.trim(),
					description: state.description.trim() || undefined,
					target_time: state.target_time || undefined,
				});
				if (!updateResult.ok) throw new Error(updateResult.error.message);
				result = updateResult.value;
			}

			setRequestState("success");
			setTimeout(() => onSuccess(result), 500);
		} catch (error) {
			console.error(`Error ${mode}ing goal:`, error);
			setErrorMessage(`Failed to ${mode} goal. Please try again.`);
			setRequestState("error");

			setTimeout(() => {
				setRequestState("idle");
			}, 3000);
		}
	};

	return (
		<div class="goal-quick-form-overlay">
			<div class="goal-quick-form">
				<h4>{mode === "create" ? "Create New Goal" : "Edit Goal"}</h4>

				<form onSubmit={handleSubmit}>
					<div class="form-group">
						<label for="goal-name">Goal Name *</label>
						<input type="text" id="goal-name" value={state.name} onInput={e => setState({ name: e.target.value })} placeholder="Enter goal name..." disabled={requestState() === "loading"} required />
					</div>

					<div class="form-group">
						<label for="goal-milestone">Milestone *</label>
						<select id="goal-milestone" value={state.milestone_id} onChange={e => setState({ milestone_id: e.target.value })} disabled={requestState() === "loading" || mode === "edit"} required>
							<option value="">Select milestone</option>
							<For each={milestones}>
								{milestone => (
									<option value={milestone.id} selected={milestone.id === state.milestone_id}>
										{milestone.name}
									</option>
								)}
							</For>
						</select>
						<Show when={mode === "edit"}>
							<small class="help-text">Milestone cannot be changed when editing</small>
						</Show>
					</div>

					<div class="form-group">
						<label for="goal-description">Description</label>
						<textarea id="goal-description" value={state.description} onInput={e => setState({ description: e.target.value })} placeholder="Optional description..." disabled={requestState() === "loading"} rows={3} />
					</div>

					<div class="form-group">
						<label for="goal-target-time">Target Date</label>
						<input
							type="date"
							id="goal-target-time"
							value={state.target_time ? state.target_time.split("T")[0] : ""}
							onInput={e => setState({ target_time: e.target.value ? e.target.value + "T00:00:00.000Z" : "" })}
							disabled={requestState() === "loading"}
						/>
					</div>

					<Show when={errorMessage()}>
						<div class="error-message">{errorMessage()}</div>
					</Show>

					<div class="form-actions">
						<button type="button" onClick={onCancel} disabled={requestState() === "loading"} class="button secondary">
							Cancel
						</button>
						<button type="submit" disabled={requestState() === "loading"} class="button primary">
							<Show when={requestState() === "loading"}>
								<Loader class="icon spinner" size={16} />
							</Show>
							<Show when={requestState() === "success"}>
								<Check class="icon success-icon" size={16} />
							</Show>
							<Show when={requestState() === "error"}>
								<X class="icon error-icon" size={16} />
							</Show>
							{mode === "create" ? "Create Goal" : "Update Goal"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
