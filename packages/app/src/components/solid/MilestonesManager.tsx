import { createSignal, createResource, For, Show } from "solid-js";
import { getApiClient } from "@/utils/api-client";
import type { Milestone, Goal, UpsertMilestone, UpsertGoal } from "@devpad/schema";

interface Props {
	projectId: string;
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
		<form onSubmit={handleSubmit} class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Name *</label>
				<input
					type="text"
					value={formData().name}
					onInput={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Milestone name"
					required
				/>
			</div>

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
				<textarea
					value={formData().description}
					onInput={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Optional description"
					rows={3}
				/>
			</div>

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Target Version</label>
				<input
					type="text"
					value={formData().target_version}
					onInput={e => setFormData(prev => ({ ...prev, target_version: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="e.g., v1.0.0"
				/>
			</div>

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
				<input
					type="date"
					value={formData().target_time}
					onInput={e => setFormData(prev => ({ ...prev, target_time: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<div class="flex space-x-3">
				<button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors">
					{props.milestone ? "Update" : "Create"} Milestone
				</button>
				<button type="button" onClick={props.onCancel} class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 transition-colors">
					Cancel
				</button>
			</div>
		</form>
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
			const response = await fetch(`/api/v0/milestones/${props.milestone.id}/goals`, {
				headers: {
					Authorization: `Bearer ${apiClient["_api_key"]}`,
				},
			});
			if (response.ok) {
				const goalData = await response.json();
				setGoals(goalData);
			}
		} catch (error) {
			console.error("Failed to fetch goals:", error);
		}
	};

	// Load goals on mount
	loadGoals();

	const handleAddGoal = () => {
		setShowGoalForm(true);
	};

	const handleGoalSubmit = async (data: Omit<UpsertGoal, "milestone_id" | "id">) => {
		try {
			const apiClient = getApiClient();
			const response = await fetch("/api/v0/goals", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiClient["_api_key"]}`,
				},
				body: JSON.stringify({
					...data,
					milestone_id: props.milestone.id,
				}),
			});
			if (!response.ok) throw new Error("Failed to create goal");

			setShowGoalForm(false);
			loadGoals(); // Refresh goals
		} catch (error) {
			console.error("Failed to create goal:", error);
			alert("Failed to create goal");
		}
	};

	return (
		<div class="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
			<div class="flex items-start justify-between mb-4">
				<div class="flex-1">
					<h3 class="text-lg font-semibold text-gray-900 mb-1">{props.milestone.name}</h3>
					<Show when={props.milestone.description}>
						<p class="text-gray-600 text-sm mb-2">{props.milestone.description}</p>
					</Show>
					<div class="flex items-center space-x-4 text-sm text-gray-500">
						<Show when={props.milestone.target_version}>
							<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">{props.milestone.target_version}</span>
						</Show>
						<Show when={props.milestone.target_time}>
							<span class="flex items-center">
								<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
								</svg>
								{new Date(props.milestone.target_time!).toLocaleDateString()}
							</span>
						</Show>
					</div>
				</div>
				<div class="flex items-center space-x-2">
					<button onClick={() => props.onEdit(props.milestone)} class="text-gray-400 hover:text-blue-600 transition-colors" title="Edit milestone">
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
						</svg>
					</button>
					<button onClick={() => props.onDelete(props.milestone.id)} class="text-gray-400 hover:text-red-600 transition-colors" title="Delete milestone">
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
						</svg>
					</button>
				</div>
			</div>

			{/* Goals Section */}
			<div class="border-t border-gray-100 pt-4">
				<div class="flex items-center justify-between mb-3">
					<button onClick={() => setShowGoals(!showGoals())} class="flex items-center text-gray-700 hover:text-gray-900 transition-colors">
						<svg class={`h-4 w-4 mr-2 transition-transform ${showGoals() ? "transform rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
						<span class="font-medium">Goals ({goals().length})</span>
					</button>
					<button onClick={handleAddGoal} class="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors">
						+ Add Goal
					</button>
				</div>

				<Show when={showGoals()}>
					<div class="space-y-2">
						<Show when={goals().length > 0} fallback={<p class="text-gray-500 text-sm italic">No goals yet. Add your first goal above.</p>}>
							<For each={goals()}>
								{goal => (
									<div class="bg-gray-50 p-3 rounded-md">
										<h4 class="font-medium text-gray-900">{goal.name}</h4>
										<Show when={goal.description}>
											<p class="text-sm text-gray-600 mt-1">{goal.description}</p>
										</Show>
										<Show when={goal.target_time}>
											<p class="text-xs text-gray-500 mt-1">Due: {new Date(goal.target_time!).toLocaleDateString()}</p>
										</Show>
									</div>
								)}
							</For>
						</Show>
					</div>
				</Show>

				{/* Goal Form Modal */}
				<Show when={showGoalForm()}>
					<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
						<div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
							<h3 class="text-lg font-bold mb-4">Add Goal</h3>
							<GoalForm onSubmit={handleGoalSubmit} onCancel={() => setShowGoalForm(false)} />
						</div>
					</div>
				</Show>
			</div>
		</div>
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
		<form onSubmit={handleSubmit} class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Name *</label>
				<input
					type="text"
					value={formData().name}
					onInput={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Goal name"
					required
				/>
			</div>

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
				<textarea
					value={formData().description}
					onInput={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Optional description"
					rows={2}
				/>
			</div>

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
				<input
					type="date"
					value={formData().target_time}
					onInput={e => setFormData(prev => ({ ...prev, target_time: e.target.value }))}
					class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<div class="flex space-x-3">
				<button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors">
					{props.goal ? "Update" : "Create"} Goal
				</button>
				<button type="button" onClick={props.onCancel} class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 transition-colors">
					Cancel
				</button>
			</div>
		</form>
	);
}

export default function MilestonesManager(props: Props) {
	const [showMilestoneForm, setShowMilestoneForm] = createSignal(false);
	const [editingMilestone, setEditingMilestone] = createSignal<Milestone | null>(null);

	// Fetch milestones for this project
	const [milestones, { refetch }] = createResource(
		() => props.projectId,
		async projectId => {
			try {
				const apiClient = getApiClient();
				// Use the correct API endpoint - project-specific milestones
				const response = await fetch(`/api/v0/projects/${projectId}/milestones`, {
					headers: {
						Authorization: `Bearer ${apiClient["_api_key"]}`,
					},
				});
				if (!response.ok) throw new Error("Failed to fetch milestones");
				return (await response.json()) as Milestone[];
			} catch (error) {
				console.error("Failed to fetch milestones:", error);
				return [];
			}
		}
	);

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
			const response = await fetch(`/api/v0/milestones/${milestoneId}`, {
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${apiClient["_api_key"]}`,
				},
			});
			if (!response.ok) throw new Error("Failed to delete milestone");
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
				const response = await fetch(`/api/v0/milestones/${editingMilestone()!.id}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiClient["_api_key"]}`,
					},
					body: JSON.stringify(data),
				});
				if (!response.ok) throw new Error("Failed to update milestone");
			} else {
				// Create new milestone
				const response = await fetch("/api/v0/milestones", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiClient["_api_key"]}`,
					},
					body: JSON.stringify({
						...data,
						project_id: props.projectId,
					}),
				});
				if (!response.ok) throw new Error("Failed to create milestone");
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
		<div class="space-y-6">
			{/* Milestones List */}
			<Show when={!milestones.loading && milestones()} fallback={<div class="text-center py-8 text-gray-500">Loading milestones...</div>}>
				<Show
					when={milestones()?.length && milestones()!.length > 0}
					fallback={
						<div class="text-center py-12 text-gray-500">
							<div class="mb-4">
								<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
								</svg>
							</div>
							<p class="text-lg font-medium">No milestones yet</p>
							<p class="text-sm">Get started by creating your first milestone</p>
						</div>
					}
				>
					<For each={milestones()}>{milestone => <MilestoneCard milestone={milestone} onEdit={handleEditMilestone} onDelete={handleDeleteMilestone} />}</For>
				</Show>
			</Show>

			{/* Add Milestone Button */}
			<button onClick={handleAddMilestone} class="w-full border-2 border-dashed border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-700 p-4 rounded-lg transition-colors">
				<div class="flex items-center justify-center space-x-2">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
					</svg>
					<span>Add Milestone</span>
				</div>
			</button>

			{/* Milestone Form Modal */}
			<Show when={showMilestoneForm()}>
				<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
						<h2 class="text-xl font-bold mb-4">{editingMilestone() ? "Edit Milestone" : "Add Milestone"}</h2>
						<MilestoneForm milestone={editingMilestone()} onSubmit={handleMilestoneSubmit} onCancel={handleFormCancel} />
					</div>
				</div>
			</Show>
		</div>
	);
}
