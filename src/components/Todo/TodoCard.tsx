import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { FetchedTask, getModuleData, Module } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { CalendarClock, Edit2, Newspaper, Tags } from "lucide-react";
import moment from "moment";
import { useState } from "react";
import { trpc } from "src/utils/trpc";
import TaskCard from "../common/TaskCard";
import GenericModal from "../GenericModal";
import { hoverLinkClass } from "../HoverLink";
import { TODO_LAYOUT } from "./ListLayout";
import StatusIcon from "./StatusIcon";
import TodoTag from "./TodoTag";
import VisiblityIcon from "./VisibilityIcon";

export const COLOURS = {
	COMPLETED: {
		colour: "text-green-300"
	},
	UNSTARTED: {
		colour: "text-neutral-400"
	},
	IN_PROGRESS: {
		colour: "text-pad-purple-500"
	}
};

const getNextStatus = (status: TASK_PROGRESS) => {
	switch (status) {
		case "COMPLETED":
			return TASK_PROGRESS.COMPLETED;
		case "UNSTARTED":
			return TASK_PROGRESS.IN_PROGRESS;
		case "IN_PROGRESS":
			return TASK_PROGRESS.COMPLETED;
	}
};

export const TodoStatus = ({ status, update_progress, id }: { status: TASK_PROGRESS; update_progress?: (status: TASK_PROGRESS) => void; id: string }) => {
	const next_status = getNextStatus(status);
	return (
		<button
			onClick={(e) => {
				e.preventDefault();
				update_progress?.(next_status);
			}}
			title={"Change status to " + next_status}
		>
			<div className={COLOURS[status]?.colour + " fill-current"}>
				<StatusIcon status={status} />
			</div>
		</button>
	);
};

type ItemInput = {
	title: string;
	progress: TASK_PROGRESS;
	visibility: TASK_VISIBILITY;
};

const TodoCard = ({ initial_item, layout, set_item, tags }: { initial_item: FetchedTask; layout: TODO_LAYOUT; set_item: (item: FetchedTask) => void; tags: TaskTags[] | undefined }) => {
	const update_item = trpc.tasks.updateItem.useMutation();
	const delete_item = trpc.tasks.deleteItem.useMutation();
	const add_module = trpc.tasks.addModule.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TASK_PROGRESS) => {
		const new_item: ItemInput = { title: initial_item.title, visibility: initial_item.visibility, progress: status };
		update_item.mutate({ item: new_item, id: initial_item.id }, { onSuccess: (data) => set_item(data as FetchedTask) });
	};

	const updateItem = (item: ItemInput, modules: { type: string; data: string }[]) => {
		update_item.mutate(
			{ id: initial_item.id, item, modules },
			{
				onSuccess: (data) => {
					set_item(data as FetchedTask);
				}
			}
		);
	};

	const deleteCard = async ({ id }: { id: string }) => {
		await delete_item.mutate(
			{ id },
			{
				onSuccess: (success) => {
					if (success) {
						set_item({
							...initial_item,
							visibility: TASK_VISIBILITY.DELETED
						});
					}
				}
			}
		);
	};

	const addModule = (module: Module) => {
		// add the module to the item
		add_module.mutate(
			{ task_id: initial_item.id, module_type: module },
			{
				onSuccess: (data) => {
					set_item(data as FetchedTask);
				}
			}
		);
	};

	if (initial_item.visibility == TASK_VISIBILITY.DELETED) return null;

	// list item
	return (
		<>
			<div className="absolute">
				<GenericModal open={editModalOpen} setOpen={setEditModalOpen}>
					<TodoEditForm item={initial_item} updateItem={updateItem} setOpen={setEditModalOpen} deleteItem={deleteCard} addModule={addModule} tags={tags} />
				</GenericModal>
			</div>
			<TaskCard
				task={initial_item}
				layout={layout}
				onEdit={(e) => {
					e.preventDefault();
					setEditModalOpen(true);
				}}
				setItemStatus={setItemStatus}
			/>
		</>
	);
};

export const EndTime = ({ endTime }: { endTime: { date: Date } }) => {
	if (!endTime || !endTime.date) return <></>;
	const { date: timestamp } = endTime;
	const date = new Date(timestamp);
	return (
		<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
			<CalendarClock className="min-w-5 w-5" />
			<span>{moment(date).calendar()}</span>
		</div>
	);
};

export const TodoTags = ({ tags }: { tags: TaskTags[] }) => {
	if (!tags || tags.length <= 0) return <></>;
	return (
		<div className="flex items-center gap-2 align-middle">
			<span>
				<Tags className="w-5" />
			</span>
			<span className="flex flex-wrap gap-1">
				{tags.map((tag, index) => {
					return <TodoTag key={index} tag={tag} />;
				})}
			</span>
		</div>
	);
};

export const SummaryText = ({ module }: { module: { summary: string } }) => {
	if (!module || !module.summary) return <></>;
	return (
		<div className="flex items-center gap-2 align-middle">
			<span>
				<Newspaper className="w-5" />
			</span>

			<span className="font-mono text-sm">{module.summary}</span>
		</div>
	);
};

export default TodoCard;
