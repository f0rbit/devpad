import { For, createEffect, createSignal, type Accessor } from "solid-js";
import type { Task as TaskType } from "../../server/tasks";
import { TaskCard } from "./TaskCard";
import type { Project } from "../../server/projects";
import Search from "lucide-solid/icons/search";
import ArrowDownWideNarrow from "lucide-solid/icons/sort-desc";
import { ProjectSelector } from "./ProjectSelector";
import FolderSearch from "lucide-solid/icons/folder-search";
import type { Tag as UserTag } from "../../server/tags";
import { TagSelect } from "./TagPicker";
import Tag from "lucide-solid/icons/tag";
import type { TaskView, UpsertTag } from "../../server/types";
import LayoutList from "lucide-solid/icons/layout-list";
import LayoutGrid from "lucide-solid/icons/layout-grid";

const options = ["recent", "priority", "progress"] as const;

export type SortOption = (typeof options)[number];

type Props = {
  tasks: TaskType[];
  defaultOption: SortOption;
  project_map: Record<string, Project>;
  from: string;
  tags: UserTag[];
  user_id: string;
  defaultView: TaskView | null;
};

// SolidJS component to render <Task />
// takes list of Tasks, a default selected option, and project_map array as props
export function TaskSorter({ tasks: defaultTasks, defaultOption, project_map, from, tags, user_id, defaultView }: Props) {
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
    let filtered = tasks().filter((task) => {
      if (task.task == null) return false;
      return task.task.visibility !== "ARCHIVED" && task.task.visibility !== "DELETED" && task.task.visibility != "HIDDEN";
    });

    const search_term = search();
    if (search_term.length > 0) {
      filtered = filtered.filter((task) => {
        return task.task.title.toLowerCase().includes(search_term.toLowerCase());
      });
    }

    const search_project = project();
    if (search_project != null && search_project !== "") {
      filtered = filtered.filter((task) => task.task.project_id === search_project);
    }

    const search_tag = tag();
    if (search_tag != null && search_tag != "") {
      filtered = filtered.filter((task) => task.tags.some((tag_id) => tag_id === search_tag));
    }

    const sorted = filtered.toSorted((a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (a.task == null && b.task == null) return 0;
      if (a.task == null) return 1;
      if (b.task == null) return -1;

      if (selectedOption() === "recent") {
        return new Date(b.task.updated_at ?? 0).getTime() - new Date(a.task.updated_at ?? 0).getTime();
      } else if (selectedOption() === "priority") {
        // priorioty is either "LOW", "MEDIUM", "HIGH"
        const priority_map = { LOW: 0, MEDIUM: 1, HIGH: 2 };
        return priority_map[b.task.priority] - priority_map[a.task.priority];
      } else if (selectedOption() === "progress") {
        // progress is "UNSTARTED", "IN_PROGRESS", "COMPLETED"
        const progress_map = { UNSTARTED: 0, IN_PROGRESS: 1, COMPLETED: 2 };
        return progress_map[b.task.progress] - progress_map[a.task.progress];
      }

      return a.task.id < b.task.id ? -1 : 1;
    });
    setSortedTasks(sorted);
  }, [tasks]);

  async function selectView(view: TaskView) {
    setView(view);

    const body = JSON.stringify({ task_view: view, id: user_id });
    const response = await fetch("/api/user/update_view", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    if (!response.ok) {
      console.error("Failed to update user view", await response.text());
      return;
    }
  }

  const update = (task_id: string, data: any) => {
    // replace the task with the updated task
    const new_tasks = tasks().map((t) => {
      if (t.task.id === task_id) {
        return { ...t, task: { ...t.task, ...data } };
      }
      return t;
    });
    setTasks(new_tasks);
  }

  return (
    <div class="flex-col" >
      <div class="flex-row" style={{ gap: "9px" }}>
        <Search />
        <input type="text" placeholder="Search" value={search()} onInput={(e) => setSearch(e.target.value)} />
        <ArrowDownWideNarrow />
        <select value={selectedOption()} onChange={(e) => setSelectedOption(e.target.value as SortOption)}>
          {options.map((option) => (
            <option value={option} selected={option === selectedOption()}>
              {option}
            </option>
          ))}
        </select>
        <FolderSearch />
        <ProjectSelector project_map={project_map} default_id={project()} callback={(project_id) => setProject(project_id)} />
        <Tag />
        <TagSelect tags={tags} onSelect={(tag) => setTag(tag?.id ?? null)} />

        <div class="icons" style={{ gap: "9px", "margin-left": "auto" }} >
          <a href="#" onClick={(e) => { e.preventDefault(); selectView("list") }}>
            <LayoutList />
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); selectView("grid") }}>
            <LayoutGrid />
          </a>
        </div>
      </div>
      {view() === "list" ? <ListView tasks={sortedTasks} project_map={project_map} from={from} user_tags={tags as UpsertTag[]} update={update} /> : <GridView tasks={sortedTasks} project_map={project_map} from={from} user_tags={tags as UpsertTag[]} update={update} />}

    </div >
  );
}

type ListProps = {
  tasks: Accessor<Props['tasks']>;
  project_map: Props['project_map'];
  from: Props['from'];
  user_tags: UpsertTag[];
  update: (task_id: string, data: any) => void;
};

function ListView({ tasks, project_map, from, user_tags, update }: ListProps) {
  return (
    <ul class="flex-col" style={{ gap: "9px" }}>
      <For each={tasks()}>
        {(task) => {
          const project = project_map[task.task.project_id!];
          if (project == null) return null;
          return (
            <li>
              <TaskCard task={task} project={project} from={from} user_tags={user_tags} update={update} />
            </li>
          );
        }}
      </For>
    </ul>
  );
}

function GridView({ tasks, project_map, from, user_tags, update }: ListProps) {
  return (
    <ul style={{ display: "grid", 'grid-template-columns': "repeat(auto-fill, minmax(300px, 1fr))", gap: "9px" }}>
      <For each={tasks()}>
        {(task) => {
          const project = project_map[task.task.project_id!];
          if (project == null) return null;
          return (
            <li style={{ border: "1px solid var(--input-border)", "border-radius": "4px", padding: "7px" }}>
              <TaskCard task={task} project={project} from={from} user_tags={user_tags} update={update} />
            </li>
          );
        }}
      </For>
    </ul>
  );
}
