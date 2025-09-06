import { createSignal, For, Show } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import { getApiClient } from "@/utils/api-client";
import type { Milestone, Goal, UpsertMilestone, UpsertGoal } from "@devpad/schema";

interface Props {
	projectId: string;
	initialMilestones?: Milestone[];
}

function MilestoneForm(props: { milestone?: Milestone | null; onSubmit: (data: Omit<UpsertMilestone, "project_id" | "id">) => void; onCancel: () => void }) {
	const [formData, setFormData] = createSignal({
		name: props.milestone?.name || "",
		description: props.milestone?.description || "",
		target_version: props.milestone?.target_version || "",
		target_time: props.milestone?.target_time || "",
	});

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		const data = formData();
		if (!data.name.trim()) {
			alert("Milestone name is required");
			return;
		}
		props.onSubmit(data);
	};

	return (
		<section>
			<div class="flex-row">
				<label for="name">name</label>
				<input id="name" type="text" value={formData().name} onInput={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Milestone name" required />
			</div>

			<div class="flex-row">
				<label for="description">description</label>
				<textarea id="description" value={formData().description} onInput={e => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description" rows={3} />
			</div>

			<div class="flex-row">
				<label for="target-version">target version</label>
				<input id="target-version" type="text" value={formData().target_version} onInput={e => setFormData(prev => ({ ...prev, target_version: e.target.value }))} placeholder="e.g., v1.0.0" />
			</div>

			<div class="flex-row">
				<label for="target-date">target date</label>
				<input id="target-date" type="datetime-local" value={formData().target_time} onInput={e => setFormData(prev => ({ ...prev, target_time: e.target.value }))} />
			</div>

			<div class="flex-row" style="gap: 20px">
				<a role="button" onClick={handleSubmit}>
					{props.milestone ? "Update" : "Create"} Milestone
				</a>
				<a role="button" onClick={props.onCancel}>
					Cancel
				</a>
			</div>
		</section>
	);
}

function MilestoneCard(props: { milestone: Milestone; onEdit: (milestone: Milestone) => void; onDelete: (id: string) => void }) {
	const [showGoals, setShowGoals] = createSignal(true);
	const [goals, setGoals] = createSignal<Goal[]>([]);
	const [showGoalForm, setShowGoalForm] = createSignal(false);

	// Fetch goals for this milestone
	const loadGoals = async () => {
		try {
			const apiClient = getApiClient();
			const goalData = await apiClient.milestones.goals(props.milestone.id);
			setGoals(goalData);
		} catch (error) {
			console.error("Failed to fetch goals:", error);
		}
	};

	// Load goals on mount (client-side only)
	if (typeof window !== "undefined") {
		loadGoals();
	}

	const handleAddGoal = () => {
		setShowGoalForm(true);
	};

	const handleGoalSubmit = async (data: Omit<UpsertGoal, "milestone_id" | "id">) => {
		try {
			const apiClient = getApiClient();
			await apiClient.goals.create({
				...data,
				milestone_id: props.milestone.id,
			});

			setShowGoalForm(false);
			loadGoals(); // Refresh goals
		} catch (error) {
			console.error("Failed to create goal:", error);
			alert("Failed to create goal");
		}
	};

	return (
		<section
			style={{
				border: "1px solid var(--input-border)",
				"border-radius": "4px",
				padding: "16px",
				"background-color": "var(--input-background)",
			}}
		>
			<header>
				<div>
					<h4>{props.milestone.name}</h4>
					<Show when={props.milestone.description}>
						<p class="description">{props.milestone.description}</p>
					</Show>
					<div class="flex-row">
						<Show when={props.milestone.target_version}>
							<span class="version-tag">{props.milestone.target_version}</span>
						</Show>
						<Show when={props.milestone.target_time}>
							<span class="description">{new Date(props.milestone.target_time!).toLocaleDateString()}</span>
						</Show>
					</div>
				</div>
				<div class="icons">
					<a role="button" onClick={() => props.onEdit(props.milestone)}>
						edit
					</a>
					<a role="button" onClick={() => props.onDelete(props.milestone.id)} title="Delete milestone">
						delete
					</a>
				</div>
			</header>

			{/* Goals Section */}
			<section style={{ "border-top": "1px solid var(--input-border)", "padding-top": "8px" }}>
				<header>
					<a role="button" onClick={() => setShowGoals(!showGoals())}>
						<svg class={`lucide ${showGoals() ? "transform rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
						<span>Goals ({goals().length})</span>
					</a>
					<a role="button" onClick={handleAddGoal}>
						+ Add Goal
					</a>
				</header>

				<Show when={showGoals()}>
					<ul>
						<Show when={goals().length > 0} fallback={<p class="description">No goals yet. Add your first goal above.</p>}>
							<For each={goals()}>
								{goal => (
									<li
										style={{
											"background-color": "var(--bg-primary)",
											padding: "8px",
											"border-radius": "4px",
											border: "1px solid var(--input-border)",
										}}
									>
										<h6>{goal.name}</h6>
										<Show when={goal.description}>
											<p class="description">{goal.description}</p>
										</Show>
										<Show when={goal.target_time}>
											<p class="description">Due: {new Date(goal.target_time!).toLocaleDateString()}</p>
										</Show>
									</li>
								)}
							</For>
						</Show>
					</ul>
				</Show>

				{/* Goal Form Modal */}
				<Show when={showGoalForm()}>
					<h4>Add Goal</h4>
					<GoalForm onSubmit={handleGoalSubmit} onCancel={() => setShowGoalForm(false)} />
				</Show>
			</section>
		</section>
	);
}

function GoalForm(props: { goal?: Goal | null; onSubmit: (data: Omit<UpsertGoal, "milestone_id" | "id">) => void; onCancel: () => void }) {
	const [formData, setFormData] = createSignal({
		name: props.goal?.name || "",
		description: props.goal?.description || "",
		target_time: props.goal?.target_time || "",
	});

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		const data = formData();
		if (!data.name.trim()) {
			alert("Goal name is required");
			return;
		}
		props.onSubmit(data);
	};

	return (
		<section>
			<div class="flex-row">
				<label>Name *</label>
				<input type="text" value={formData().name} onInput={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Goal name" required />
			</div>

			<div class="flex-row">
				<label>Description</label>
				<textarea value={formData().description} onInput={e => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description" rows={2} />
			</div>

			<div class="flex-row">
				<label>Target Date</label>
				<input type="datetime-local" value={formData().target_time} onInput={e => setFormData(prev => ({ ...prev, target_time: e.target.value }))} />
			</div>

			<div class="flex-row">
				<a role="button" onClick={handleSubmit}>
					{props.goal ? "Update" : "Create"} Goal
				</a>
				<a role="button" onClick={props.onCancel}>
					Cancel
				</a>
			</div>
		</section>
	);
}

export default function MilestonesManager(props: Props) {
	const [showMilestoneForm, setShowMilestoneForm] = createSignal(false);
	const [editingMilestone, setEditingMilestone] = createSignal<Milestone | null>(null);
	const [milestones, setMilestones] = createSignal<Milestone[]>(props.initialMilestones || []);

	// Refetch function for updates
	const refetch = async () => {
		if (typeof window === "undefined") return;

		try {
			const apiClient = getApiClient();
			const data = await apiClient.milestones.getByProject(props.projectId);
			setMilestones(data);
		} catch (error) {
			console.error("Failed to refetch milestones:", error);
		}
	};

	const handleAddMilestone = () => {
		setEditingMilestone(null);
		setShowMilestoneForm(true);
	};

	const handleEditMilestone = (milestone: Milestone) => {
		setEditingMilestone(milestone);
		setShowMilestoneForm(true);
	};

	const handleDeleteMilestone = async (milestoneId: string) => {
		if (!confirm("Are you sure you want to delete this milestone? This will also delete all its goals.")) {
			return;
		}

		try {
			const apiClient = getApiClient();
			await apiClient.milestones.delete(milestoneId);
			refetch();
		} catch (error) {
			console.error("Failed to delete milestone:", error);
			alert("Failed to delete milestone");
		}
	};

	const handleMilestoneSubmit = async (data: Omit<UpsertMilestone, "project_id" | "id">) => {
		try {
			const apiClient = getApiClient();

			if (editingMilestone()) {
				// Update existing milestone
				await apiClient.milestones.update(editingMilestone()!.id, data);
			} else {
				// Create new milestone
				await apiClient.milestones.create({
					...data,
					project_id: props.projectId,
				});
			}

			setShowMilestoneForm(false);
			setEditingMilestone(null);
			refetch();
		} catch (error) {
			console.error("Failed to save milestone:", error);
			alert("Failed to save milestone");
		}
	};

	const handleFormCancel = () => {
		setShowMilestoneForm(false);
		setEditingMilestone(null);
	};

	return (
		<section>
			{/* Milestones List */}
			<Show when={milestones().length > 0}>
				<For each={milestones()}>{milestone => <MilestoneCard milestone={milestone} onEdit={handleEditMilestone} onDelete={handleDeleteMilestone} />}</For>
			</Show>

			<Show when={milestones().length === 0}>
				<p class="description">No milestones yet</p>
			</Show>

			<a role="button" onClick={handleAddMilestone}>
				+ create
			</a>

			{/* Milestone Form Modal */}
			<Show when={showMilestoneForm()}>
				<h3>{editingMilestone() ? "edit" : "add"}</h3>
				<MilestoneForm milestone={editingMilestone()} onSubmit={handleMilestoneSubmit} onCancel={handleFormCancel} />
			</Show>
		</section>
	);
}
