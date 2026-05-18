import { AiProvenance } from "@devpad/core/ui";
import type { Project } from "@devpad/schema";
import Github from "lucide-solid/icons/github";
import { formatDueDate } from "@/utils/task-status";
import { formatRelativeTime } from "@/utils/time-utils";
import { Show } from "solid-js";

type PipelineStatus = {
	package_id: string;
	package_name: string;
	latest_run: any | null;
	pending_approval_count: number;
};

interface Props {
	project: Project;
	pipeline_status?: PipelineStatus;
}

const STATUS_LABELS: Record<Project["status"], string> = {
	DEVELOPMENT: "Development",
	PAUSED: "Paused",
	RELEASED: "Released",
	LIVE: "Live",
	FINISHED: "Finished",
	ABANDONED: "Abandoned",
	STOPPED: "Stopped",
};

const STATUS_COLORS: Record<Project["status"], string> = {
	DEVELOPMENT: "var(--text-link)",
	PAUSED: "var(--fg-faint)",
	RELEASED: "color-mix(in srgb, var(--fg-muted) 70%, green)",
	LIVE: "color-mix(in srgb, var(--fg-muted) 70%, green)",
	FINISHED: "color-mix(in srgb, var(--fg-muted) 70%, green)",
	ABANDONED: "color-mix(in srgb, var(--fg-muted) 70%, red)",
	STOPPED: "color-mix(in srgb, var(--fg-muted) 70%, orange)",
};

const PIPELINE_STATUS_ICONS: Record<string, string> = {
	running: "●",
	queued: "⏳",
	staging: "▶",
	baking: "⏳",
	awaiting_approval: "⏸",
	deploying: "▶",
	succeeded: "✓",
	failed: "✗",
	rolled_back: "↩",
	cancelled: "◯",
	idle: "○",
};

const PIPELINE_STATUS_COLORS: Record<string, string> = {
	running: "var(--text-link)",
	queued: "var(--fg-muted)",
	staging: "var(--text-link)",
	baking: "var(--text-link)",
	awaiting_approval: "color-mix(in srgb, var(--fg-muted) 70%, orange)",
	deploying: "var(--text-link)",
	succeeded: "color-mix(in srgb, var(--fg-muted) 70%, green)",
	failed: "color-mix(in srgb, var(--fg-muted) 70%, red)",
	rolled_back: "color-mix(in srgb, var(--fg-muted) 70%, orange)",
	cancelled: "var(--fg-muted)",
	idle: "var(--fg-faint)",
};

const get_pipeline_status_label = (run: any): string => {
	if (!run) return "idle";
	return run.status || "idle";
};

export const ProjectCard = (props: Props) => {
	const { project, pipeline_status } = props;

	return (
		<a href={`/project/${project.project_id}`} class="card stack stack-sm" style={{ gap: "3px", width: "100%", height: "100%", "text-decoration": "none" }}>
			<div class="row row-sm">
				<span class="task-title">{project.name}</span>
				<AiProvenance created_by={project.created_by} modified_by={project.modified_by} />
			</div>
			{project.description && <p class="task-summary">{project.description}</p>}
			<div style={{ height: "100%" }} />
			<div class="stack stack-sm" style={{ "font-size": "small", gap: "6px" }}>
				<span class="row row-sm">
					<span style={{ color: "var(--fg-faint)" }}>{formatDueDate(project.updated_at)}</span>
					<span
						style={{
							color: STATUS_COLORS[project.status],
							"font-weight": "500",
							"margin-left": "auto",
						}}
					>
						{STATUS_LABELS[project.status]}
					</span>
					{project.repo_url && (
						<span class="row row-sm" style={{ color: "var(--fg-faint)" }} title="GitHub repository">
							<Github size={16} />
						</span>
					)}
				</span>

				<Show when={pipeline_status}>
					{status => {
						const run = status().latest_run;
						const run_status = get_pipeline_status_label(run);
						const color = PIPELINE_STATUS_COLORS[run_status] || "var(--fg-muted)";
						const icon = PIPELINE_STATUS_ICONS[run_status] || "○";
						const relative_time = run?.finished_at ? formatRelativeTime(new Date(run.finished_at)) : "";

						return (
							<div class="stack stack-sm" style={{ gap: "6px" }}>
								<span class="row row-sm" style={{ color, "font-size": "0.9em" }}>
									<span>{icon}</span>
									<span style={{ "margin-left": "4px", "text-transform": "lowercase" }}>{run_status}</span>
									{relative_time && <span style={{ "margin-left": "auto", color: "var(--fg-faint)" }}>{relative_time}</span>}
								</span>

								<Show when={status().pending_approval_count > 0}>
									<span class="row row-sm" style={{ color: "color-mix(in srgb, var(--fg-muted) 70%, orange)", "font-size": "0.9em" }}>
										<span>→</span>
										<span style={{ "margin-left": "4px" }}>
											{status().pending_approval_count} awaiting approval
										</span>
									</span>
								</Show>
							</div>
						);
					}}
				</Show>
			</div>
		</a>
	);
};
