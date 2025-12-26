import type { Project } from "@devpad/schema";
import { For } from "solid-js";
import { ProjectCard } from "./ProjectCard";

type Props = {
	projects: Project[];
};

const byUpdatedAt = (a: Project, b: Project) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();

const isNotDeleted = (project: Project) => project.visibility !== "DELETED";

export function ProjectCardGrid({ projects }: Props) {
	const sorted_projects = projects.filter(isNotDeleted).toSorted(byUpdatedAt);

	if (sorted_projects.length === 0) {
		return (
			<div class="empty-state">
				<p>No projects found</p>
			</div>
		);
	}

	return (
		<ul style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(300px, 1fr))", gap: "9px" }}>
			<For each={sorted_projects}>
				{project => (
					<li style={{ display: "flex", width: "100%", height: "100%" }}>
						<ProjectCard project={project} />
					</li>
				)}
			</For>
		</ul>
	);
}
