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
	PAUSED: "var(--text-muted)",
	RELEASED: "color-mix(in srgb, var(--text-secondary) 70%, green)",
	LIVE: "color-mix(in srgb, var(--text-secondary) 70%, green)",
	FINISHED: "color-mix(in srgb, var(--text-secondary) 70%, green)",
	ABANDONED: "color-mix(in srgb, var(--text-secondary) 70%, red)",
	STOPPED: "color-mix(in srgb, var(--text-secondary) 70%, orange)",
};

export const ProjectCard = (props: Props) => {
	const { project } = props;

	return (
		<a href={`/project/${project.project_id}`} class="card flex-col" style={{ gap: "3px", width: "100%", height: "100%", "text-decoration": "none" }}>
			<div>
				<span class="task-title">{project.name}</span>
			</div>
			{project.description && <p class="task-summary">{project.description}</p>}
			<div style={{ height: "100%" }} />
			<div class="flex-col" style={{ "font-size": "small", gap: "6px" }}>
				<span class="flex-row">
					<span style={{ color: "var(--text-muted)" }}>{formatDueDate(project.updated_at)}</span>
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
						<span class="icons" style={{ color: "var(--text-muted)" }} title="GitHub repository">
							<Github size={14} />
						</span>
					)}
				</span>
			</div>
		</a>
	);
};
