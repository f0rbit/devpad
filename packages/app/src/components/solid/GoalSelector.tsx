import type { Goal, Milestone } from "@devpad/schema";

import Edit from "lucide-solid/icons/edit";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, For, Show } from "solid-js";
import { getApiClient } from "@/utils/api-client";
import { GoalQuickForm } from "./GoalQuickForm";

interface Props {
	project_id: string | null; // Database ID, not slug
	goal_id: string | null;
	onChange: (goal_id: string | null) => void;
	disabled?: boolean;
}

interface MilestoneWithGoals extends Milestone {
	goals: Goal[];
}

export function GoalSelector({ project_id, goal_id, onChange, disabled = false }: Props) {
	const [selected, setSelected] = createSignal<string>(goal_id ?? "");
	const [milestones, setMilestones] = createSignal<MilestoneWithGoals[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [showQuickForm, setShowQuickForm] = createSignal(false);
	const [quickFormMode, setQuickFormMode] = createSignal<"create" | "edit">("create");
	const [editingGoal, setEditingGoal] = createSignal<Goal | null>(null);

	// Load milestones and goals when project changes
	createEffect(() => {
		if (project_id) {
			loadMilestonesAndGoals();
		} else {
			setMilestones([]);
			setSelected("");
			onChange(null);
		}
	});

	// Update selected when goal_id prop changes
	createEffect(() => {
		setSelected(goal_id ?? "");
	});

	const loadMilestonesAndGoals = async () => {
		if (!project_id) return;

		setLoading(true);
		const api_client = getApiClient();
		const { milestones, error } = await api_client.milestones.getByProject(project_id);
		if (error) {
			console.error("Failed to load milestones and goals:", error);
			setMilestones([]);
			setLoading(false);
			return;
		}
		const with_goals = await Promise.all(
			milestones.map(async m => {
				const { goals, error } = await api_client.milestones.goals(m.id);
				if (error) return { ...m, goals: [] };
				return { ...m, goals };
			})
		);
		setLoading(false);
		setMilestones(with_goals);
	};

	const handleSelectionChange = (value: string) => {
		setSelected(value);

		// Handle special actions
		if (value === "__create_new__") {
			setQuickFormMode("create");
			setEditingGoal(null);
			setShowQuickForm(true);
			setSelected(goal_id ?? ""); // Reset selection
			return;
		}

		onChange(value === "" ? null : value);
	};

	const handleEditGoal = (goal: Goal) => {
		setQuickFormMode("edit");
		setEditingGoal(goal);
		setShowQuickForm(true);
	};

	const handleQuickFormSuccess = (goal: Goal) => {
		setShowQuickForm(false);
		loadMilestonesAndGoals(); // Refresh data
		setSelected(goal.id);
		onChange(goal.id);
	};

	const handleQuickFormCancel = () => {
		setShowQuickForm(false);
		setEditingGoal(null);
	};

	const handleClearSelection = () => {
		setSelected("");
		onChange(null);
	};

	const selectedGoal = () => {
		for (const milestone of milestones()) {
			const goal = milestone.goals.find(g => g.id === selected());
			if (goal) return goal;
		}
		return null;
	};

	return (
		<div class="goal-selector-container">
			<div class="flex-row" style={{ gap: "5px", "align-items": "center" }}>
				<select id="goal-selector" value={selected()} disabled={disabled || loading() || !project_id} onChange={e => handleSelectionChange(e.target.value)} style={{ "flex-grow": "1" }}>
					<option value="" selected={selected() === ""}>
						{!project_id ? "Select project first" : "No goal"}
					</option>

					<Show when={project_id && milestones().length > 0}>
						<For each={milestones()}>
							{milestone => (
								<optgroup label={milestone.name}>
									<For each={milestone.goals}>
										{goal => (
											<option value={goal.id} selected={goal.id === selected()}>
												{goal.name}
											</option>
										)}
									</For>
								</optgroup>
							)}
						</For>
					</Show>

					<Show when={project_id && milestones().length > 0}>
						<option value="__create_new__">+ Create new goal</option>
					</Show>
				</select>

				<Show when={selectedGoal()}>
					<button type="button" class="icon-button" title="Edit goal" onClick={() => handleEditGoal(selectedGoal()!)} disabled={disabled}>
						<Edit size={14} />
					</button>
					<button type="button" class="icon-button" title="Clear goal selection" onClick={handleClearSelection} disabled={disabled}>
						<X size={14} />
					</button>
				</Show>
			</div>

			<Show when={loading()}>
				<div class="loading-indicator">Loading goals...</div>
			</Show>

			<Show when={showQuickForm()}>
				<GoalQuickForm mode={quickFormMode()} goal={editingGoal()} milestones={milestones()} onSuccess={handleQuickFormSuccess} onCancel={handleQuickFormCancel} />
			</Show>
		</div>
	);
}
