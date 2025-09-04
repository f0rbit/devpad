import type { Project, TaskWithDetails as TaskType, TaskView, UpsertTag, TagWithTypedColor as UserTag } from "@devpad/schema";
import FolderSearch from "lucide-solid/icons/folder-search";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import LayoutList from "lucide-solid/icons/layout-list";
import Search from "lucide-solid/icons/search";
import ArrowDownWideNarrow from "lucide-solid/icons/sort-desc";
import Tag from "lucide-solid/icons/tag";
import { type Accessor, createEffect, createSignal, For } from "solid-js";
import { ProjectSelector } from "@/components/solid/ProjectSelector";
import { TagSelect } from "@/components/solid/TagPicker";
import { getApiClient } from "@/utils/api-client";
import { TaskCard } from "./TaskCard";

const options = ["upcoming", "recent", "priority", "progress"] as const;

export type SortOption = (typeof options)[number];

type Props = {
	tasks: TaskType[];
	defaultOption: SortOption;
	project_map: Record<string, Project>;
	tags: UserTag[];
	user_id: string;
	defaultView: TaskView | null;
};

// task sorting functions

const last_updated = (a: TaskType, b: TaskType) => {
	return new Date(b.task?.updated_at ?? 0).getTime() - new Date(a.task?.updated_at ?? 0).getTime();
};

const by_priority = (a: TaskType, b: TaskType) => {
	const priority_map = { LOW: 0, MEDIUM: 1, HIGH: 2 };
	return priority_map[b.task?.priority] - priority_map[a.task?.priority];
};

const by_progress = (a: TaskType, b: TaskType) => {
	const progress_map = { UNSTARTED: 0, IN_PROGRESS: 1, COMPLETED: 2 };
	return progress_map[b.task?.progress] - progress_map[a.task?.progress];
};

const by_due_date = (a: TaskType, b: TaskType) => {
	if (a.task?.end_time == null && b.task?.end_time == null) return 0;
	if (a.task?.end_time == null) return 1;
	if (b.task?.end_time == null) return -1;
	return new Date(a.task?.end_time).getTime() - new Date(b.task?.end_time).getTime();
};

// SolidJS component to render <Task />
// takes list of Tasks, a default selected option, and project_map array as props
export function TaskSorter({ tasks: defaultTasks, defaultOption, project_map, tags, user_id, defaultView }: Props) {
	const [tasks, setTasks] = createSignal<TaskType[]>(defaultTasks);
	const [selectedOption, setSelectedOption] = createSignal<SortOption>(defaultOption);
	const [sortedTasks, setSortedTasks] = createSignal<TaskType[]>([]);
	const [search, setSearch] = createSignal("");
	const [project, setProject] = createSignal<string | null>(null); // id of selected project
	const [tag, setTag] = createSignal<string | null>(null); // id of selected tag
	const [view, setView] = createSignal<TaskView>(defaultView ?? "list");

	// sort tasks based on selected option
	createEffect(() => {
		// filter out 'archived' and 'deleted' tasks
		let filtered = tasks().filter(task => {
			if (task.task == null) return false;
			return task.task.visibility !== "ARCHIVED" && task.task.visibility !== "DELETED" && task.task.visibility !== "HIDDEN";
		});

		const search_term = search();
		if (search_term.length > 0) {
			filtered = filtered.filter(task => {
				return task.task.title.toLowerCase().includes(search_term.toLowerCase());
			});
		}

		const search_project = project();
		if (search_project != null && search_project !== "") {
			filtered = filtered.filter(task => task.task.project_id === search_project);
		}

		const search_tag = tag();
		if (search_tag != null && search_tag !== "") {
			filtered = filtered.filter(task => task.tags.some(tag_id => tag_id === search_tag));
		}

		if (selectedOption() === "upcoming") {
			filtered = filtered.filter(task => task.task.progress !== "COMPLETED");
		}

		const sorted = filtered.toSorted((a, b) => {
			if (a == null && b == null) return 0;
			if (a == null) return 1;
			if (b == null) return -1;
			if (a.task == null && b.task == null) return 0;
			if (a.task == null) return 1;
			if (b.task == null) return -1;

			if (selectedOption() === "recent") {
				return last_updated(a, b);
			} else if (selectedOption() === "priority") {
				return by_priority(a, b);
			} else if (selectedOption() === "progress") {
				return by_progress(a, b);
			} else if (selectedOption() === "upcoming") {
				// at the top should be tasks that are set as "IN_PROGRESS"
				// within those, they should be sorted by priority & then due date
				// for those that are not in progress, they should be sorted by priority & then due date
				// for those that have the same due date, they should be sorted by updated_at
				const progress = by_progress(a, b);
				if (progress !== 0) return progress;
				const priority = by_priority(a, b);
				if (priority !== 0) return priority;
				const due_date = by_due_date(a, b);
				if (due_date !== 0) return due_date;
				return last_updated(a, b);
			}

			return a.task.id < b.task.id ? -1 : 1;
		});
		setSortedTasks(sorted);
	}, [tasks]);

	async function selectView(view: TaskView) {
		setView(view);

		try {
			const apiClient = getApiClient();
			await apiClient.user.preferences({
				id: user_id,
				task_view: view,
			});
		} catch (error) {
			console.error("Failed to update user view", error);
		}
	}

	const update = (task_id: string, data: any) => {
		// replace the task with the updated task
		const new_tasks = tasks().map(t => {
			if (t.task.id === task_id) {
				return { ...t, task: { ...t.task, ...data } };
			}
			return t;
		});
		setTasks(new_tasks);
	};

	return (
		<div class="flex-col">
			<div class="task-filters" style={{ gap: "9px" }}>
				<Search />
				<input type="text" placeholder="Search" value={search()} onInput={e => setSearch(e.target.value)} />
				<ArrowDownWideNarrow />
				<select value={selectedOption()} onChange={e => setSelectedOption(e.target.value as SortOption)}>
					{options.map(option => (
						<option value={option} selected={option === selectedOption()}>
							{option}
						</option>
					))}
				</select>
				{Object.keys(project_map).length > 1 && (
					<>
						<FolderSearch />
						<ProjectSelector project_map={project_map} default_id={project()} callback={project_id => setProject(project_id)} disabled={false} />
					</>
				)}
				<Tag />
				<TagSelect tags={tags} onSelect={tag => setTag(tag?.id ?? null)} />

				<div class="icons" style={{ gap: "9px", "margin-left": "auto", "grid-column": "span 2" }}>
					<a
						role="button"
						onClick={e => {
							e.preventDefault();
							selectView("list");
						}}
					>
						<LayoutList />
					</a>
					<a
						role="button"
						onClick={e => {
							e.preventDefault();
							selectView("grid");
						}}
					>
						<LayoutGrid />
					</a>
				</div>
			</div>
			{view() === "list" ? (
				<ListView tasks={sortedTasks} project_map={project_map} user_tags={tags as UpsertTag[]} update={update} />
			) : (
				<GridView tasks={sortedTasks} project_map={project_map} user_tags={tags as UpsertTag[]} update={update} />
			)}
		</div>
	);
}

type ListProps = {
	tasks: Accessor<Props["tasks"]>;
	project_map: Props["project_map"];
	user_tags: UpsertTag[];
	update: (task_id: string, data: any) => void;
};

function ListView({ tasks, project_map, user_tags, update }: ListProps) {
	return (
		<ul class="flex-col" style={{ gap: "9px" }}>
			<For each={tasks()}>
				{task => {
					let project = null;
					if (task.task.project_id) project = project_map[task.task.project_id];
					return (
						<li>
							<TaskCard task={task} project={project} user_tags={user_tags} update={update} draw_project={Object.keys(project_map).length > 1} />
						</li>
					);
				}}
			</For>
		</ul>
	);
}

function GridView({ tasks, project_map, user_tags, update }: ListProps) {
	return (
		<ul style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(300px, 1fr))", gap: "9px" }}>
			<For each={tasks()}>
				{task => {
					let project = null;
					if (task.task.project_id) project = project_map[task.task.project_id];
					return (
						<li style={{ border: "1px solid var(--input-border)", "border-radius": "4px", padding: "7px" }}>
							<TaskCard task={task} project={project} user_tags={user_tags} update={update} draw_project={Object.keys(project_map).length > 1} />
						</li>
					);
				}}
			</For>
		</ul>
	);
}
