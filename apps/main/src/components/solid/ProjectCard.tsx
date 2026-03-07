import { AiProvenance } from "@devpad/core/ui";
import type { Project } from "@devpad/schema";
import Github from "lucide-solid/icons/github";
import { formatDueDate } from "@/utils/task-status";

interface Props {
	project: Project;
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

export const ProjectCard = (props: Props) => {
	const { project } = props;

	return (
		<a href={`/project/${project.project_id}`} class="card stack stack-sm" style={{ gap: "3px", width: "100%", height: "100%", "text-decoration": "none" }}>
			<div class="row row-sm">
				<span class="task-title">{project.name}</span>
				<AiProvenance created_by={project.created_by} modified_by={project.modified_by} size={12} />
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
							<Github size={14} />
						</span>
					)}
				</span>
			</div>
		</a>
	);
};
