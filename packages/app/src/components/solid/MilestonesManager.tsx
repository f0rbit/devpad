import { createSignal, For, Show } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import type { Milestone, Goal } from "@devpad/schema";

interface Props {
	projectId: string;
	projectSlug: string;
	initialMilestones?: Milestone[];
	initialGoalsMap?: Record<string, Goal[]>;
}

function MilestoneCard(props: { milestone: Milestone; projectSlug: string; goals: Goal[] }) {
	const [showGoals, setShowGoals] = createSignal(true);

	const handleEdit = () => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}`;
	};

	const handleAddGoal = () => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}/goal/new`;
	};

	const handleEditGoal = (goalId: string) => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}/goal/${goalId}`;
	};

	return (
		<section
			style={{
				border: "1px solid var(--input-border)",
				borderRadius: "4px",
				padding: "16px",
				backgroundColor: "var(--input-background)",
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
					<a role="button" onClick={handleEdit} title="Edit milestone">
						<svg class="lucide" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
						</svg>
					</a>
				</div>
			</header>

			{/* Goals Section */}
			<section style={{ borderTop: "1px solid var(--input-border)", paddingTop: "8px" }}>
				<header>
					<a role="button" onClick={() => setShowGoals(!showGoals())}>
						<svg class={`lucide ${showGoals() ? "transform rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
						<span>Goals ({props.goals.length})</span>
					</a>
					<a role="button" onClick={handleAddGoal}>
						+ Add Goal
					</a>
				</header>

				<Show when={showGoals()}>
					<ul>
						<Show when={props.goals.length > 0} fallback={<p class="description">No goals yet. Add your first goal above.</p>}>
							<For each={props.goals}>
								{goal => (
									<li
										style={{
											backgroundColor: "var(--bg-primary)",
											padding: "8px",
											borderRadius: "4px",
											border: "1px solid var(--input-border)",
											cursor: "pointer",
										}}
										onClick={() => handleEditGoal(goal.id)}
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
			</section>
		</section>
	);
}

export default function MilestonesManager(props: Props) {
	const [milestones] = createSignal<Milestone[]>(props.initialMilestones || []);
	const [goalsMap] = createSignal<Record<string, Goal[]>>(props.initialGoalsMap || {});


	return (
		<section>
			{/* Milestones List */}
			<Show when={milestones().length > 0}>
				<For each={milestones()}>{milestone => <MilestoneCard milestone={milestone} projectSlug={props.projectSlug} goals={goalsMap()[milestone.id] || []} />}</For>
			</Show>

			<Show when={milestones().length === 0}>
				<p class="description">No milestones yet</p>
			</Show>

			<a href={`/project/${props.projectSlug}/milestone/new`}>+ create</a>
		</section>
	);
}
