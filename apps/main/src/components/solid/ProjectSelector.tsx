import type { Project } from "@devpad/schema";
import { For, onMount } from "solid-js";

export function ProjectSelector({ project_map, default_id, callback, disabled }: { project_map: Record<string, Project>; default_id: string | null; callback: (project_id: string | null) => void; disabled: boolean }) {
	let ref!: HTMLSelectElement;

	onMount(() => {
		if (default_id) {
			ref.value = default_id;
		}
	});

	return (
		<select
			ref={ref}
			id="project-selector"
			value={default_id ?? ""}
			disabled={disabled}
			onChange={e => {
				const project_id = e.target.value;
				callback(project_id === "" ? null : project_id);
			}}
		>
			<option value="">-</option>
			<For each={Object.keys(project_map)}>{project_id => <option value={project_id}>{project_map[project_id].name}</option>}</For>
		</select>
	);
}
