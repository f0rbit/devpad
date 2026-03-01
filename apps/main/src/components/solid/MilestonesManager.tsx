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
	goalTaskCounts?: Record<string, { total: number; completed: number }>;
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

function ProgressCircle(props: { percentage: number; size?: number }) {
	const size = () => props.size ?? 18;
	const strokeWidth = 2.5;
	const radius = () => (size() - strokeWidth) / 2;
	const circumference = () => 2 * Math.PI * radius();
	const offset = () => circumference() - (props.percentage / 100) * circumference();

	return (
		<svg width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`} style={{ "flex-shrink": "0" }}>
			<title>{`${Math.round(props.percentage)}% complete`}</title>
			<circle cx={size() / 2} cy={size() / 2} r={radius()} fill="none" stroke="var(--border)" stroke-width={strokeWidth} />
			<Show when={props.percentage > 0}>
				<circle
					cx={size() / 2}
					cy={size() / 2}
					r={radius()}
					fill="none"
					stroke="var(--accent)"
					stroke-width={strokeWidth}
					stroke-dasharray={`${circumference()}`}
					stroke-dashoffset={offset()}
					stroke-linecap="round"
					transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
				/>
			</Show>
		</svg>
	);
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
							return (
								<Step title="" status={status}>
									<div class="stack-sm">
										<div class="row-between" style={{ "align-items": "center" }}>
											<span style={{ "font-size": "1.1rem", "font-weight": "500" }}>{milestone.name}</span>
											<a href={`/project/${props.projectSlug}/milestone/${milestone.id}`} class="text-muted" title="Edit milestone" style={{ "flex-shrink": "0", "text-decoration": "none" }}>
												<Edit size={14} />
											</a>
										</div>

										<Show when={milestone.description}>
											<p class="text-sm text-faint" style={{ margin: "0" }}>
												{milestone.description}
											</p>
										</Show>

										<div class="stack-sm" style={{ "margin-top": "0.25rem" }}>
											<For each={goals}>
												{goal => {
													const counts = () => (props.goalTaskCounts || {})[goal.id];
													const pct = () => {
														const c = counts();
														return c && c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
													};
													return (
														<a
															class="interactive-row"
															href={`/project/${props.projectSlug}/milestone/${milestone.id}/goal/${goal.id}`}
															style={{ "text-decoration": "none", display: "flex", "align-items": "center", "justify-content": "space-between" }}
														>
															<div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
																<Show when={counts() && counts()!.total > 0}>
																	<ProgressCircle percentage={pct()} />
																</Show>
																<span class="text-sm">{goal.name}</span>
															</div>
															<div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
																<Show when={counts() && counts()!.total > 0}>
																	<span class="text-xs text-faint">
																		{counts()!.completed}/{counts()!.total}
																	</span>
																</Show>
																<Show when={goal.target_time}>
																	<span class="text-xs text-muted">{formatDate(goal.target_time)}</span>
																</Show>
															</div>
														</a>
													);
												}}
											</For>
											<Show when={goals.length === 0}>
												<span class="text-sm text-faint">no goals yet</span>
											</Show>
										</div>

										<a
											href={`/project/${props.projectSlug}/milestone/${milestone.id}/goal/new`}
											style={{ display: "flex", "align-items": "center", gap: "0.25rem", color: "var(--text-link)", "font-size": "smaller", "text-decoration": "none" }}
										>
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
