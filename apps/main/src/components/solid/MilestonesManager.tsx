import type { Goal, Milestone } from "@devpad/schema";
import type { StepStatus } from "@f0rbit/ui";
import { Empty, Step, Stepper } from "@f0rbit/ui";
import Edit from "lucide-solid/icons/edit";
import Plus from "lucide-solid/icons/plus";
import { For, Show } from "solid-js";

interface Props {
	projectId: string;
	projectSlug: string;
	initialMilestones?: Milestone[];
	initialGoalsMap?: Record<string, Goal[]>;
}

const formatDate = (dateString?: string | null) => {
	if (!dateString) return null;
	const date = new Date(dateString);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
};

function deriveStatus(milestone: Milestone, goals: Goal[]): StepStatus {
	if (milestone.finished_at) return "completed";
	if (goals.length === 0) return "upcoming";
	return goals.every(g => g.finished_at) ? "completed" : "current";
}

function buildDescription(milestone: Milestone, goals: Goal[]): string {
	const parts: string[] = [];
	if (milestone.target_version) parts.push(`v${milestone.target_version}`);
	const date = formatDate(milestone.target_time);
	if (date) parts.push(date);
	parts.push(goals.length === 0 ? "no goals" : `${goals.length} goal${goals.length === 1 ? "" : "s"}`);
	return parts.join(" · ");
}

export default function MilestonesManager(props: Props) {
	const sortedMilestones = () => {
		const ms = props.initialMilestones || [];
		return [...ms].sort((a, b) => {
			if (!a.target_time && !b.target_time) return 0;
			if (!a.target_time) return 1;
			if (!b.target_time) return -1;
			return new Date(a.target_time).getTime() - new Date(b.target_time).getTime();
		});
	};

	const goalsFor = (milestoneId: string): Goal[] => (props.initialGoalsMap || {})[milestoneId] || [];

	return (
		<div>
			<Show when={sortedMilestones().length > 0} fallback={<Empty title="No milestones yet" description="Create your first milestone to start tracking project goals." />}>
				<Stepper orientation="vertical">
					<For each={sortedMilestones()}>
						{milestone => {
							const goals = goalsFor(milestone.id);
							const status = deriveStatus(milestone, goals);
							const description = buildDescription(milestone, goals);
							return (
								<Step title={milestone.name} description={description} status={status}>
									<div class="stack-sm">
										<div class="row-between" style={{ "margin-bottom": "0.25rem" }}>
											<Show when={milestone.description}>
												<p class="text-sm text-muted" style={{ margin: "0" }}>
													{milestone.description}
												</p>
											</Show>
											<a href={`/project/${props.projectSlug}/milestone/${milestone.id}`} class="text-muted" title="Edit milestone" style={{ "flex-shrink": "0" }}>
												<Edit size={14} />
											</a>
										</div>

										<For each={goals}>
											{goal => (
												<a class="interactive-row row-between" href={`/project/${props.projectSlug}/milestone/${milestone.id}/goal/${goal.id}`} style={{ "text-decoration": "none" }}>
													<span class="text-sm">{goal.name}</span>
													<Show when={goal.target_time}>
														<span class="text-xs text-muted">{formatDate(goal.target_time)}</span>
													</Show>
												</a>
											)}
										</For>

										<a href={`/project/${props.projectSlug}/milestone/${milestone.id}/goal/new`} class="row text-sm" style={{ gap: "0.25rem", color: "var(--text-link)", "text-decoration": "none" }}>
											<Plus size={14} /> add goal
										</a>
									</div>
								</Step>
							);
						}}
					</For>
				</Stepper>
			</Show>

			<a href={`/project/${props.projectSlug}/milestone/new`} class="row text-sm" style={{ gap: "0.25rem", color: "var(--text-link)", "text-decoration": "none", "margin-top": "1rem" }}>
				<Plus size={14} /> create milestone
			</a>
		</div>
	);
}
