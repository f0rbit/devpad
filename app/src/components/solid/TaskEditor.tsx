import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Loader from "lucide-solid/icons/loader";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import { TagPicker } from "./TagPicker";
import HistoryTimeline from "./HistoryTimeline";
import type { _FetchedCodebaseTask, _FetchedTask, Task } from "../../server/tasks";
import { type HistoryAction, type Tag, type UpsertTag } from "../../server/types";
import type { Project } from "../../server/projects";
import { ProjectSelector } from "./ProjectSelector";

interface Props {
  task: {
    task: _FetchedTask | null;
    codebase_tasks: _FetchedCodebaseTask | null;
    tags: string[];
  };
  user_tags: Tag[];
  current_tags: UpsertTag[];
  history: HistoryAction[];
  user_id: string;
  project_map: Record<string, Project>;
}

type Progress = Task['task']['progress'];
type Visibility = Task['task']['visibility'];
type Priority = Task['task']['priority'];

const TaskEditor = ({ task, user_tags, current_tags, history, user_id, project_map }: Props) => {
  const [state, setState] = createStore({
    title: task.task?.title ?? "",
    summary: task.task?.summary ?? null,
    description: task.task?.description ?? null,
    progress: (task.task?.progress ?? "UNSTARTED") as Progress,
    visibility: (task.task?.visibility ?? "PRIVATE") as Visibility,
    start_time: task.task?.start_time ?? null,
    end_time: task.task?.end_time ?? null,
    priority: (task.task?.priority ?? "LOW") as Priority,
    project_id: task.task?.project_id ?? null,
  });
  const [currentTags, setCurrentTags] = createSignal(current_tags);
  const [requestState, setRequestState] = createSignal<"idle" | "loading" | "success" | "error">("idle");

  const project_disabled = () => !!(task?.task?.project_id && task?.codebase_tasks);

  const saveTask = async () => {
    setRequestState("loading");

    const response = await fetch(`/api/todo/upsert`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: task.task?.id ?? null,
        title: state.title,
        summary: state.summary == "" ? null : state.summary,
        description: state.description == "" ? null : state.description,
        progress: state.progress,
        visibility: state.visibility,
        start_time: state.start_time == "" ? null : state.start_time,
        end_time: state.end_time == "" ? null : state.end_time,
        priority: state.priority,
        owner_id: user_id,
        project_id: state.project_id,
        tags: currentTags(),
      }),
    });

    if (response.ok) {
      setRequestState("success");
    } else {
      setRequestState("error");
    }

    setTimeout(() => {
      setRequestState("idle");
    }, 5000);
  };

  return (
    <div>
      <h4>{task.task ? "edit task" : "new task"}</h4>
      <br />
      <div class="editor" data-todo-id={task.task?.id ?? null} data-user-id={user_id}>
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value={state.title} onInput={(e) => setState({ title: e.target.value })} />
        <label for="summary">Summary</label>
        <input type="text" id="summary" name="summary" value={state.summary ?? ""} onInput={(e) => setState({ summary: e.target.value })} />
        <label for="description">Description</label>
        <textarea id="description" name="description" onInput={(e) => setState({ description: e.target.value })}>
          {state.description ?? ""}
        </textarea>

        <label for="progress">Progress</label>
        <div class="flex-row combined-row">
          <select id="progress" name="progress" value={state.progress} onChange={(e) => setState({ progress: e.target.value as Progress })}>
            <option value="UNSTARTED" selected={state.progress == "UNSTARTED"}>Not Started</option>
            <option value="IN_PROGRESS" selected={state.progress == "IN_PROGRESS"}>In Progress</option>
            <option value="COMPLETED" selected={state.progress == "COMPLETED"}>Completed</option>
          </select>
          <label for="project-selector" style="padding: 0px 5px;">Project</label>
          <ProjectSelector project_map={project_map} default_id={state.project_id} callback={(p) => setState({ project_id: p })} disabled={project_disabled()} />
        </div>
        <label for="end_time">End Time</label>
        <input type="datetime-local" id="end_time" name="end_time" value={state.end_time ?? ""} onInput={(e) => setState({ end_time: e.target.value })} />
      </div>
      <details class="boxed">
        <summary class="flex-row" style="font-size: smaller;">
          <ChevronUp class="up-arrow" />
          <ChevronDown class="down-arrow" />
          More Options
        </summary>
        <div class="editor">
          <label for="start_time">Start Time</label>
          <input type="datetime-local" id="start_time" name="start_time" value={state.start_time ?? ""} onInput={(e) => setState({ start_time: e.target.value })} />
          <label for="visibility">Visibility</label>
          <select id="visibility" name="visibility" value={state.visibility} onChange={(e) => setState({ visibility: e.target.value as Visibility })}>
            <option value="PUBLIC" selected={state.visibility == "PUBLIC"}>Public</option>
            <option value="PRIVATE" selected={state.visibility == "PRIVATE"}>Private</option>
            <option value="HIDDEN" selected={state.visibility == "HIDDEN"}>Hidden</option>
            <option value="ARCHIVED" selected={state.visibility == "ARCHIVED"}>Archived</option>
            <option value="DRAFT" selected={state.visibility == "DRAFT"}>Draft</option>
            <option value="DELETED" selected={state.visibility == "DELETED"}>Deleted</option>
          </select>
          <label for="priority">Priority</label>
          <select id="priority" name="priority" value={state.priority} onChange={(e) => setState({ priority: e.target.value as Priority })}>
            <option value="LOW" selected={state.priority == "LOW"}>Low</option>
            <option value="MEDIUM" selected={state.priority == "MEDIUM"}>Medium</option>
            <option value="HIGH" selected={state.priority == "HIGH"}>High</option>
          </select>
        </div>
      </details>
      <br />
      <div class="editor">
        <label for="tags">Tags</label>
        <TagPicker currentTags={currentTags()} availableTags={user_tags} owner_id={user_id} onChange={(t) => setCurrentTags(t)} />
      </div>
      <br />
      <a role="button" id="save-button" onClick={saveTask}>save</a>
      <Loader class="icon spinner" classList={{ hidden: requestState() !== "loading" }} />
      <Check class="icon success-icon" classList={{ hidden: requestState() !== "success" }} />
      <X class="icon error-icon" classList={{ hidden: requestState() !== "error" }} />
      <br />
      <br />
      <div id="response" class="response"></div>
      {task.codebase_tasks && (
        <>
          <br />
          <h5>linked code</h5>
          <LinkedCode code={task.codebase_tasks} />
        </>
      )}
      {history?.length > 0 && (
        <>
          <br />
          <h5 style="margin-bottom: 10px">task history</h5>
          <HistoryTimeline actions={history} view="task" />
        </>
      )}
    </div>
  );
};

const LinkedCode = ({ code }: { code: NonNullable<Task['codebase_tasks']> }) => {
  // format <path>:<line>
  let path = 'unknown:?';
  if (code.file) {
    path = code.file;
    if (code.line) {
      path += `:${code.line}`;
    }
  }

  const buildContext = (context: string[]) => {
    if (!context) return null;
    const minWhitespace = context.reduce((acc, line) => {
      if (line.trim() === '') return acc;
      const whitespace = line.match(/^\s*/);
      if (whitespace) {
        return Math.min(acc, whitespace[0].length);
      }
      return acc;
    }, Infinity);

    return context.map((line) => line.slice(minWhitespace)).join('\n');
  };

  const context = code.context ? buildContext(code.context as string[]) : null;

  return (
    <div class="flex-col" style={{ gap: '2px' }}>
      <div class="flex-row">
        <span>{code.type}</span>
        <span> - </span>
        <code>{path}</code>
      </div>
      {context && (
        <pre class="astro-code">
          {context}
        </pre>
      )}
    </div>
  );
};

export default TaskEditor;
