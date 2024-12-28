import { For, createEffect, createSignal } from "solid-js";
import type { Project } from "../../server/projects";


/** solid-js component called <ProjectSelector>, given a map of projects via `project_map`,
 * render a <select> element with the name of each project, and on change call `callback(project_id)`, the prop also accepts `default` as a project_id, otherwise the selected value is -1
 */
export function ProjectSelector({ project_map, default_id, callback }: { project_map: Record<string, Project>; default_id: string | null; callback: (project_id: string | null) => void }) {
  const [selected, setSelected] = createSignal<string>(default_id ?? "");

  createEffect(() => {
    setSelected(default_id ?? "");
    callback(default_id == "" ? null : default_id);
  });

  return (
    <select value={selected() ?? ""} onChange={(e) => {
      const project_id = e.target.value;
      setSelected(project_id ?? "");
      callback(project_id == "" ? null : project_id);
    }}>
      <option value="" selected={selected() === ""}>-</option>
      <For each={Object.keys(project_map)}>
        {(project_id) => (
          <option value={project_id} selected={project_id === selected()}>
            {project_map[project_id].name}
          </option>
        )}
      </For>
    </select>
  );
}

