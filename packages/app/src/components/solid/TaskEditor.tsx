import type { HistoryAction, Project, TagWithTypedColor, TaskWithDetails, UpsertTag } from "@devpad/schema";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import { createSignal, For } from "solid-js";
import { createStore } from "solid-js/store";
import HistoryTimeline from "@/components/solid/HistoryTimeline";
import { ProjectSelector } from "@/components/solid/ProjectSelector";
import { GoalSelector } from "@/components/solid/GoalSelector";
import { TagPicker } from "@/components/solid/TagPicker";
import { getApiClient } from "@/utils/api-client";
import { buildCodeContext, formatCodeLocation } from "@/utils/code-utils";
import { PROGRESS_OPTIONS, PRIORITY_OPTIONS, VISIBILITY_OPTIONS, type Progress, type Priority, type Visibility } from "@/utils/task-status";

interface Props {
	task: TaskWithDetails | null;
	user_tags: TagWithTypedColor[];
	current_tags: UpsertTag[];
	history: HistoryAction[];
	user_id: string;
	project_map: Record<string, Project>;
	default_project_id?: string | null;
}

const TaskEditor = ({ task, user_tags, current_tags, history, user_id, project_map, default_project_id }: Props) => {
	const [state, setState] = createStore({
		title: task?.task?.title ?? "",
		summary: task?.task?.summary ?? null,
		description: task?.task?.description ?? null,
		progress: (task?.task?.progress ?? "UNSTARTED") as Progress,
		visibility: (task?.task?.visibility ?? "PRIVATE") as Visibility,
		start_time: task?.task?.start_time ?? null,
		end_time: task?.task?.end_time ?? null,
		priority: (task?.task?.priority ?? "LOW") as Priority,
		project_id: default_project_id ?? task?.task?.project_id ?? null,
		goal_id: task?.task?.goal_id ?? null,
	});
	const [currentTags, setCurrentTags] = createSignal(current_tags);
	const [requestState, setRequestState] = createSignal<"idle" | "loading" | "success" | "error">("idle");

	const project_disabled = () => !!(task?.task?.project_id && task?.codebase_tasks) || !!default_project_id;

	const saveTask = async () => {
		setRequestState("loading");

		try {
			const apiClient = getApiClient();
			const result = await apiClient.tasks.upsert({
				id: task?.task?.id ?? null,
				title: state.title,
				summary: state.summary === "" ? null : state.summary,
				description: state.description === "" ? null : state.description,
				progress: state.progress,
				visibility: state.visibility,
				start_time: state.start_time === "" ? null : state.start_time,
				end_time: state.end_time === "" ? null : state.end_time,
				priority: state.priority,
				owner_id: user_id,
				project_id: state.project_id,
				goal_id: state.goal_id,
				tags: currentTags(),
			} as any);

			setRequestState("success");
			if (task?.task?.id == null) {
				const new_id = result.task?.task?.id;
				// redirect to new task page
				if (new_id) {
					window.location.href = `/todo/${new_id}`;
				} else {
					console.error("Failed to get new task ID from result:", result);
				}
			}
		} catch (error) {
			console.error("Error saving task:", error);
			setRequestState("error");
		}

		setTimeout(() => {
			setRequestState("idle");
		}, 5000);
	};

	return (
		<div>
			<h4>{task?.task ? "edit task" : "new task"}</h4>
			<br />
			<div class="editor" data-todo-id={task?.task?.id ?? null} data-user-id={user_id}>
				<label for="title">Title</label>
				<input type="text" id="title" name="title" value={state.title} onInput={e => setState({ title: e.target.value })} />
				<label for="summary">Summary</label>
				<input type="text" id="summary" name="summary" value={state.summary ?? ""} onInput={e => setState({ summary: e.target.value })} />
				<label for="description">Description</label>
				<textarea id="description" name="description" onInput={e => setState({ description: e.target.value })}>
					{state.description ?? ""}
				</textarea>

				<label for="progress">Progress</label>
				<div class="flex-row combined-row">
					<select id="progress" name="progress" value={state.progress} onChange={e => setState({ progress: e.target.value as Progress })}>
						<For each={PROGRESS_OPTIONS}>
							{option => (
								<option value={option.value} selected={state.progress === option.value}>
									{option.label}
								</option>
							)}
						</For>
					</select>
					<label for="project-selector" style="padding: 0px 5px;">
						Project
					</label>
					<ProjectSelector project_map={project_map} default_id={state.project_id} callback={p => setState({ project_id: p })} disabled={project_disabled()} />
				</div>
				<label for="goal-selector">Goal</label>
				<GoalSelector project_id={state.project_id} goal_id={state.goal_id} onChange={goal_id => setState({ goal_id })} disabled={project_disabled()} />
				<label for="end_time">End Time</label>
				<input type="datetime-local" id="end_time" name="end_time" value={state.end_time ?? ""} onInput={e => setState({ end_time: e.target.value })} />
			</div>
			<details class="boxed">
				<summary class="flex-row" style="font-size: smaller;">
					<ChevronUp class="up-arrow" />
					<ChevronDown class="down-arrow" />
					More Options
				</summary>
				<div class="editor">
					<label for="start_time">Start Time</label>
					<input type="datetime-local" id="start_time" name="start_time" value={state.start_time ?? ""} onInput={e => setState({ start_time: e.target.value })} />
					<label for="visibility">Visibility</label>
					<select id="visibility" name="visibility" value={state.visibility} onChange={e => setState({ visibility: e.target.value as Visibility })}>
						<For each={VISIBILITY_OPTIONS}>
							{option => (
								<option value={option.value} selected={state.visibility === option.value}>
									{option.label}
								</option>
							)}
						</For>
					</select>
					<label for="priority">Priority</label>
					<select id="priority" name="priority" value={state.priority} onChange={e => setState({ priority: e.target.value as Priority })}>
						<For each={PRIORITY_OPTIONS}>
							{option => (
								<option value={option.value} selected={state.priority === option.value}>
									{option.label}
								</option>
							)}
						</For>
					</select>
				</div>
			</details>
			<br />
			<div class="editor">
				<label for="tags">Tags</label>
				<TagPicker currentTags={currentTags()} availableTags={user_tags} owner_id={user_id} onChange={t => setCurrentTags(t)} />
			</div>
			<br />
			<a role="button" id="save-button" onClick={saveTask}>
				save
			</a>
			<Loader class="icon spinner" classList={{ hidden: requestState() !== "loading" }} />
			<Check class="icon success-icon" classList={{ hidden: requestState() !== "success" }} />
			<X class="icon error-icon" classList={{ hidden: requestState() !== "error" }} />
			<br />
			<br />
			<div id="response" class="response"></div>
			{task?.codebase_tasks && (
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

const LinkedCode = ({ code }: { code: NonNullable<TaskWithDetails["codebase_tasks"]> }) => {
	const path = formatCodeLocation(code.file, code.line);
	const context = buildCodeContext(code.context);

	return (
		<div class="flex-col" style={{ gap: "2px" }}>
			<div class="flex-row">
				<span>{code.type}</span>
				<span> - </span>
				<code>{path}</code>
			</div>
			{context && <pre class="astro-code">{context}</pre>}
		</div>
	);
};

export default TaskEditor;
