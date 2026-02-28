import { getBrowserClient } from "@devpad/core/ui/client";
import type { TaskWithDetails as Task, UpdateAction, UpdateData } from "@devpad/schema";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Save from "lucide-solid/icons/save";
import Trash from "lucide-solid/icons/trash";
import { createSignal, For } from "solid-js";
import { buildCodeContext, formatCodeLocation } from "@/utils/code-utils";

interface Props {
	items: UpdateData[];
	tasks: Record<string, Task>; //key is codebase_tasks.id
	project_id: string;
	update_id: number;
}

const ACTIONS = {
	SAME: ["CONFIRM", "UNLINK"],
	MOVE: ["CONFIRM", "UNLINK"],
	UPDATE: ["CONFIRM", "UNLINK"],
	NEW: ["CREATE", "IGNORE"],
	DELETE: ["UNLINK", "COMPLETE", "DELETE"],
} as const;

export function UpdateDiffList({ items, tasks, project_id, update_id }: Props) {
	const _items = JSON.parse(JSON.stringify(items)) as UpdateData[];
	const mapped_items = _items.map(item => {
		const task = tasks[item.id];
		return task ? { ...item, task } : item;
	});

	const { same = [], others = [] } = Object.groupBy(mapped_items, u => (u.type === "SAME" || u.type === "MOVE" ? "same" : "others"));

	// Initialize actions state with default actions
	const defaultActions = Object.fromEntries(
		mapped_items.map(item => [
			item.id,
			ACTIONS[item.type as keyof typeof ACTIONS][0], // Default to the 0th action
		])
	);
	const [actionsState, setActionsState] = createSignal<Record<string, UpdateAction>>(defaultActions);
	const [titles, setTitles] = createSignal<Record<string, string>>({});

	const updateAction = (id: string, action: UpdateAction) => {
		setActionsState(prev => ({ ...prev, [id]: action }));
	};

	const updateTitle = (id: string, title: string) => {
		setTitles(prev => {
			prev[id] = title;
			return prev;
		});
	};

	const saveActions = async () => {
		const actions = actionsState();
		// Make the API request here
		const grouped = Object.entries(actions).reduce(
			(acc, [id, action]) => {
				if (acc[action]) {
					acc[action].push(id);
				} else {
					acc[action] = [id];
				}
				return acc;
			},
			{} as Record<UpdateAction, string[]>
		);

		try {
			const apiClient = getBrowserClient();
			await apiClient.projects.scan.update(project_id, {
				id: update_id,
				actions: grouped,
				titles: titles(),
				approved: true,
			});
			location.reload();
		} catch (error) {
			console.error("Failed to save actions");
			console.error(error);
		}
	};

	const ignoreUpdate = async () => {
		try {
			const apiClient = getBrowserClient();
			await apiClient.projects.scan.update(project_id, {
				id: update_id,
				actions: {},
				titles: {},
				approved: true,
			});
			location.reload();
		} catch (error) {
			console.error("Failed to save actions");
			console.error(error);
		}
	};

	return (
		<div class="flex-col diff-list">
			{same.length > 0 && (
				<details class="boxed">
					<summary class="flex-row" style="justify-content: center">
						<ChevronUp class="up-arrow" />
						<ChevronDown class="down-arrow" />
						<span>{same.length} tasks were the same</span>
					</summary>
					<br />
					<div class="flex-col">
						{same.map(item => (
							<UpdateDiff update={item} action={actionsState()[item.id]} onActionChange={updateAction} onTitleChange={updateTitle} />
						))}
					</div>
				</details>
			)}
			{others.length > 0 && others.map(item => <UpdateDiff update={item} action={actionsState()[item.id]} onActionChange={updateAction} onTitleChange={updateTitle} />)}
			<hr />
			<div class="icons" style="gap: 20px; justify-content: center;">
				<a role="button" onClick={saveActions} class="flex-row">
					<Save /> save actions
				</a>
				<a role="button" onClick={ignoreUpdate} class="flex-row">
					<Trash /> ignore updates
				</a>
			</div>
		</div>
	);
}

interface ItemProps {
	update: UpdateData & { task?: Task };
	action: UpdateAction;
	onActionChange: (id: string, action: UpdateAction) => void;
	onTitleChange: (id: string, title: string) => void;
}

export function UpdateDiff({ update, action, onActionChange, onTitleChange }: ItemProps) {
	const available_actions = ACTIONS[update.type];
	const { data } = update;

	const title: string | null = update?.task?.task?.title ?? null;

	// Determine the path based on new or old data
	const path = data.new?.file ? formatCodeLocation(data.new.file, data.new.line) : data.old?.file ? formatCodeLocation(data.old.file, data.old.line) : "unknown:?";

	// Build contexts for old and new code
	const old_context = data.old?.context ? buildCodeContext(data.old.context) : null;
	const new_context = data.new?.context ? buildCodeContext(data.new.context) : null;

	return (
		<div class="flex-col" style="gap: 2px;">
			<h5 class="flex-row">
				{/** @idea paid users could "generate" title using AI, could have automatic generation as option */}
				<span>{update.type}</span>
				<span> - </span>
				{title ? <span>{title}</span> : <input type="text" placeholder="Enter title" style="width: 50ch" onInput={e => onTitleChange(update.id, e.currentTarget.value)} />}
			</h5>
			<div class="flex-row">
				<span>{update.tag}</span> - <code>{path}</code>
			</div>
			<div style="padding-left: 0ch; gap: 3px;" class="flex-col">
				{data.old && (
					<div class="item old">
						<code>{data.old.text}</code>
					</div>
				)}
				{data.new && (
					<div class="item new">
						<code>{data.new.text}</code>
					</div>
				)}
			</div>
			<div style="position: relative; padding-top: 2px">
				<Context old_context={old_context} new_context={new_context} />
				<div class="button-container flex-row">
					<For each={available_actions}>
						{label => (
							<>
								<input type="radio" name={update.id} id={`${update.id}-${label}`} style="display: none" checked={label === action} onChange={() => onActionChange(update.id, label)} />
								<label class="label-modal" for={`${update.id}-${label}`}>
									{label.toLowerCase()}
								</label>
							</>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}

function Context({ old_context, new_context }: { old_context: string | null; new_context: string | null }) {
	const [open, setOpen] = createSignal(false);
	if (!old_context && !new_context) return <></>;

	return (
		<div class="flex-col">
			<div style="width: max-content" class="flex-row label-modal" onClick={() => setOpen(!open())}>
				<ChevronUp style={{ display: open() ? "none" : "unset" }} />
				<ChevronDown style={{ display: open() ? "unset" : "none" }} />
				<span>Context</span>
			</div>
			<div style={{ "margin-top": "5px", display: open() ? "grid" : "none" }}>
				{old_context && <pre class="astro-code old">{old_context}</pre>}
				{old_context && new_context && <div style="height: 5px" />}
				{new_context && <pre class="astro-code new">{new_context}</pre>}
			</div>
		</div>
	);
}
