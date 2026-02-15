import { Button, MultiSelect, type MultiSelectOption } from "@f0rbit/ui";
import { createResource, createSignal, For, Show } from "solid-js";
import { getClient, unwrap } from "@/lib/client";

type Project = {
	id: string;
	name: string;
	project_id: string;
	description: string | null;
	icon_url: string | null;
};

type ProjectSelectorProps = {
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	initialProjects?: Project[];
};

const fetchProjects = async (): Promise<Project[]> => {
	if (typeof window === "undefined") return [];
	const result = await getClient().projects.list();
	if (!result.ok) return [];
	return result.value as Project[];
};

const ProjectSelector = (props: ProjectSelectorProps) => {
	const [fetchTrigger, setFetchTrigger] = createSignal(0);

	const [projects] = createResource(
		() => {
			const trigger = fetchTrigger();
			if (trigger === 0 && props.initialProjects && props.initialProjects.length > 0) {
				return null;
			}
			return trigger;
		},
		fetchProjects,
		{ initialValue: props.initialProjects ?? [] }
	);

	const [refreshing, setRefreshing] = createSignal(false);

	const options = (): MultiSelectOption<string>[] =>
		(projects() ?? []).map(p => ({
			value: p.id,
			label: p.name,
			description: p.description ?? undefined,
		}));

	const selectedProjects = () => {
		const all = projects() ?? [];
		const ids = new Set(props.selectedIds);
		return all.filter(p => ids.has(p.id));
	};

	const handleRefresh = async () => {
		setRefreshing(true);
		try {
			await getClient().projects.list();
			setFetchTrigger(n => n + 1);
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
			<div class="row">
				<MultiSelect options={options()} value={props.selectedIds} onChange={props.onChange} placeholder="No projects linked" addLabel="Add Project" doneLabel="Done" emptyMessage="No more projects to add" />
				<Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing()} label="Refresh projects from DevPad">
					{refreshing() ? "..." : "↻"}
				</Button>
			</div>
			<Show when={selectedProjects().length > 0}>
				<div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px", "padding-left": "2px" }}>
					<For each={selectedProjects()}>
						{p => (
							<a href={`https://devpad.tools/project/${p.name}`} target="_blank" rel="noopener noreferrer" style={{ "font-size": "0.75rem", color: "var(--fg-faint)", "text-decoration": "none" }}>
								{p.name} ↗
							</a>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
};

export default ProjectSelector;
