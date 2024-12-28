import { For, createEffect, createSignal } from "solid-js";
import type { Task as TaskType } from "../../server/tasks";
import { TaskCard } from "./TaskCard";
import type { Project } from "../../server/projects";
import Search from "lucide-solid/icons/search";
import ArrowDownWideNarrow from "lucide-solid/icons/sort-desc";
import { ProjectSelector } from "./ProjectSelector";
import FolderSearch from "lucide-solid/icons/folder-search";

const options = ["recent", "priority", "progress"] as const;

export type SortOption = (typeof options)[number];

// SolidJS component to render <Task />
// takes list of Tasks, a default selected option, and project_map array as props
export function TaskSorter({ tasks, defaultOption, project_map, from }: { tasks: TaskType[]; defaultOption: SortOption; project_map: Record<string, Project>; from: string }) {
  const [selectedOption, setSelectedOption] = createSignal<SortOption>(defaultOption);
  const [sortedTasks, setSortedTasks] = createSignal<TaskType[]>([]);
  const [search, setSearch] = createSignal("");
  const [project, setProject] = createSignal<string | null>(null); // -1 means no project selected


  // sort tasks based on selected option
  createEffect(() => {
    // filter out 'archived' and 'deleted' tasks
    let filtered = tasks.filter((task) => {
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
  });

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

      </div>
      <ul class="flex-col" style={{ gap: "9px" }}>
        <For each={sortedTasks()}>
          {(task) => {
            const project = project_map[task.task.project_id!];
            if (project == null) return null;
            return (
              <li>
                <TaskCard task={task} project={project} from={from} />
              </li>
            );
          }}
        </For> 
      </ul>
    </div>
  );
}
