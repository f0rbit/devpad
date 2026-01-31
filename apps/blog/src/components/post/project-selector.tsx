import { Button, MultiSelect, type MultiSelectOption } from "@f0rbit/ui";
import { createResource, createSignal } from "solid-js";
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
		<div class="row">
			<MultiSelect options={options()} value={props.selectedIds} onChange={props.onChange} placeholder="No projects linked" addLabel="Add Project" doneLabel="Done" emptyMessage="No more projects to add" />
			<Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing()} label="Refresh projects from DevPad">
				{refreshing() ? "..." : "↻"}
			</Button>
		</div>
	);
};

export default ProjectSelector;
