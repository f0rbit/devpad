import { createSignal, For, Show } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import Edit from "lucide-solid/icons/edit";
import GripVertical from "lucide-solid/icons/grip-vertical";
import type { Milestone, Goal } from "@devpad/schema";

interface Props {
	projectId: string;
	projectSlug: string;
	initialMilestones?: Milestone[];
	initialGoalsMap?: Record<string, Goal[]>;
}

function MilestoneItem(props: { milestone: Milestone; projectSlug: string; goals: Goal[] }) {
	const [isDotHovered, setIsDotHovered] = createSignal(false);

	const handleEdit = () => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}`;
	};

	const handleAddGoal = () => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}/goal/new`;
	};

	const handleEditGoal = (goalId: string) => {
		window.location.href = `/project/${props.projectSlug}/milestone/${props.milestone.id}/goal/${goalId}`;
	};

	const formatDate = (dateString?: string) => {
		if (!dateString) return null;
		const date = new Date(dateString);
		return date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	};

	return (
		<div class="timeline-item">
			{/* Timeline dot with hover state */}
			<div class="timeline-dot" onMouseEnter={() => setIsDotHovered(true)} onMouseLeave={() => setIsDotHovered(false)}>
				<Show when={isDotHovered()} fallback={<div class="timeline-marker"></div>}>
					<div class="drag-handle">
						<GripVertical size={12} />
					</div>
				</Show>
			</div>

			{/* Milestone content using composable card */}
			<div class="card flex-col" style={{ gap: "0.5rem", width: "100%" }}>
				{/* Header Row using existing flex-row pattern */}
				<header class="flex-row" style={{ "justify-content": "space-between", "align-items": "flex-start" }}>
					<div class="flex-row" style={{ "flex-wrap": "wrap" }}>
						<h5>{props.milestone.name}</h5>
						<Show when={props.milestone.target_version}>
							<span class="version-tag">{props.milestone.target_version}</span>
						</Show>
					</div>
					<div class="flex-row icons">
						<Show when={props.milestone.target_time}>
							<span class="description" style={{ "font-size": "smaller" }}>
								{formatDate(props.milestone.target_time || undefined)}
							</span>
						</Show>
						<a role="button" onClick={handleEdit} title="Edit milestone">
							<Edit size={16} />
						</a>
					</div>
				</header>

				{/* Description using existing class */}
				<Show when={props.milestone.description}>
					<p class="task-summary" style="margin-top: -7px">{props.milestone.description}</p>
				</Show>

				{/* Goals List using flex-col and interactive-row */}
				<div class="flex-col" style={{ gap: "4px" }}>
					<For each={props.goals}>
						{goal => (
							<div class="interactive-row flex-row" style={{ "justify-content": "space-between" }} onClick={() => handleEditGoal(goal.id)}>
								<span>{goal.name}</span>
								<Show when={goal.target_time}>
									<span class="description" style={{ "font-size": "smaller" }}>
										{formatDate(goal.target_time || undefined)}
									</span>
								</Show>
							</div>
						)}
					</For>
					<Show when={props.goals.length === 0}>
						<p class="description">no goals yet</p>
					</Show>
				</div>

				{/* Add Goal Button using existing flex-row pattern */}
				<a role="button" class="flex-row" style={{ "align-items": "center", gap: "0.5rem", color: "var(--text-link)", "font-size": "smaller" }} onClick={handleAddGoal}>
					<Plus size={16} />
					<span>add goal</span>
				</a>
			</div>
		</div>
	);
}

export default function MilestonesManager(props: Props) {
	const [milestones] = createSignal<Milestone[]>(props.initialMilestones || []);
	const [goalsMap] = createSignal<Record<string, Goal[]>>(props.initialGoalsMap || {});

	// Sort milestones by target_time
	const sortedMilestones = () => {
		return [...milestones()].sort((a, b) => {
			if (!a.target_time && !b.target_time) return 0;
			if (!a.target_time) return 1;
			if (!b.target_time) return -1;
			return new Date(a.target_time).getTime() - new Date(b.target_time).getTime();
		});
	};

	return (
		<div class="flex-col">
			<Show when={milestones().length > 0}>
				<div class="timeline-container" style={{ gap: "2rem" }}>
					<For each={sortedMilestones()}>{milestone => <MilestoneItem milestone={milestone} projectSlug={props.projectSlug} goals={goalsMap()[milestone.id] || []} />}</For>
				</div>
			</Show>

			<Show when={milestones().length === 0}>
				<p class="description">no milestones yet</p>
			</Show>

			{/* Create Milestone Button - align with timeline content */}
			<div style={{ "margin-left": "30px" }}>
				<a role="button" class="flex-row" style={{ "align-items": "center", gap: "0.5rem", color: "var(--text-link)", "font-size": "smaller" }} href={`/project/${props.projectSlug}/milestone/new`}>
					<Plus size={16} />
					<span>create milestone</span>
				</a>
			</div>
		</div>
	);
}
