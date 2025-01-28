import { createSignal } from "solid-js";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Loader from "lucide-solid/icons/loader";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import { TagPicker } from "./TagPicker";
import HistoryTimeline from "./HistoryTimeline";
import type { _FetchedCodebaseTask, _FetchedTask, Task } from "../../server/tasks";
import { type HistoryAction, type Tag, type UpsertTag } from "../../server/types";

interface Props {
  task: _FetchedTask;
  codebase_tasks: _FetchedCodebaseTask;
  tags: string[];
  tag_map: Map<string, Tag>;
  history: HistoryAction[];
  user_id: string;
}

const TaskEditor = ({ task, codebase_tasks, tags, tag_map, history, user_id }: Props) => {
  const [title, setTitle] = createSignal(task?.title ?? "");
  const [summary, setSummary] = createSignal(task?.summary ?? "");
  const [description, setDescription] = createSignal(task?.description ?? "");
  const [progress, setProgress] = createSignal(task?.progress ?? "UNSTARTED");
  const [visibility, setVisibility] = createSignal(task?.visibility ?? "PRIVATE");
  const [startTime, setStartTime] = createSignal(task?.start_time ?? "");
  const [endTime, setEndTime] = createSignal(task?.end_time ?? "");
  const [priority, setPriority] = createSignal(task?.priority ?? "LOW");
  const [currentTags, setCurrentTags] = createSignal<UpsertTag[]>(tags.map(tag_id => tag_map.get(tag_id)!) ?? []);
  const [showSpinner, setShowSpinner] = createSignal(false);
  const [showSuccess, setShowSuccess] = createSignal(false);
  const [showError, setShowError] = createSignal(false);

  const saveTask = async () => {
    setShowSpinner(true);
    setShowSuccess(false);
    setShowError(false);

    const response = await fetch(`/api/todo/upsert`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: task?.id ?? null,
        title: title(),
        summary: summary(),
        description: description(),
        progress: progress(),
        visibility: visibility(),
        start_time: startTime(),
        end_time: endTime(),
        priority: priority(),
        owner_id: user_id,
        tags: currentTags(),
      }),
    });

    if (response.ok) {
      setShowSuccess(true);
    } else {
      setShowError(true);
    }

    setShowSpinner(false);
    setTimeout(() => {
      setShowSuccess(false);
      setShowError(false);
    }, 5000);
  };

  return (
    <div>
      <h4>{task ? "edit task" : "new task"}</h4>
      <br />
      <div class="editor" data-todo-id={task?.id ?? null} data-user-id={user_id}>
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value={title()} onInput={(e) => setTitle(e.target.value)} />
        <label for="summary">Summary</label>
        <input type="text" id="summary" name="summary" value={summary()} onInput={(e) => setSummary(e.target.value)} />
        <label for="description">Description</label>
        <textarea id="description" name="description" value={description()} onInput={(e) => setDescription(e.target.value)} />
        <label for="progress">Progress</label>
        <select id="progress" name="progress" value={progress()} onChange={(e) => setProgress(e.target.value as Props['task']['progress'])}>
          <option value="UNSTARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <label for="end_time">End Time</label>
        <input type="datetime-local" id="end_time" name="end_time" value={endTime()} onInput={(e) => setEndTime(e.target.value)} />
      </div>
      <details class="boxed">
        <summary class="flex-row" style="font-size: smaller;">
          <ChevronUp class="up-arrow" />
          <ChevronDown class="down-arrow" />
          More Options
        </summary>
        <div class="editor">
          <label for="start_time">Start Time</label>
          <input type="datetime-local" id="start_time" name="start_time" value={startTime()} onInput={(e) => setStartTime(e.target.value)} />
          <label for="visibility">Visibility</label>
          <select id="visibility" name="visibility" value={visibility()} onChange={(e) => setVisibility(e.target.value as Props['task']['visibility'] )}>
            <option value="PUBLIC">Public</option>
            <option value="PRIVATE">Private</option>
            <option value="HIDDEN">Hidden</option>
            <option value="ARCHIVED">Archived</option>
            <option value="DRAFT">Draft</option>
            <option value="DELETED">Deleted</option>
          </select>
          <label for="priority">Priority</label>
          <select id="priority" name="priority" value={priority()} onChange={(e) => setPriority(e.target.value as Props['task']['priority'])}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
      </details>
      <br />
      <div class="editor">
        <label for="tags">Tags</label>
        <TagPicker currentTags={currentTags()} availableTags={Object.values(tag_map)} owner_id={user_id} />
      </div>
      <br />
      <a role="button" id="save-button" onClick={saveTask}>save</a>
      <Loader id="spinner" class="icon" classList={{ hidden: !showSpinner() }} />
      <Check id="success-icon" class="icon" classList={{ hidden: !showSuccess() }} />
      <X id="error-icon" class="icon" classList={{ hidden: !showError() }} />
      <br />
      <br />
      <div id="response" class="response"></div>
      {codebase_tasks && (
        <>
          <br />
          <h5>linked code</h5>
          <LinkedCode code={codebase_tasks} />
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
  
	/** @note had to set these to 'any' to avoid type error on lang attribute */
	let fileType: any = '';
	if (code.file) {
	  const parts = code.file.split('.');
	  fileType = parts[parts.length - 1];
	}
  
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
