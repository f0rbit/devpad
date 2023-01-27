import { useState } from "react";
import { FetchedTask, getModuleData, trpc } from "src/utils/trpc";
import { CalendarClock, Edit2, Newspaper, Tags } from "lucide-react";
import { hoverLinkClass } from "../HoverLink";
import TodoTag from "./TodoTag";
import VisiblityIcon from "./VisibilityIcon";
import StatusIcon from "./StatusIcon";
import GenericModal from "../GenericModal";
import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { TODO_LAYOUT } from "./ListLayout";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Module } from "@/types/page-link";
import { ModuleIcon } from "./ModuleIcon";

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

const TodoStatus = ({ status, update_progress, id }: { status: TASK_PROGRESS; update_progress: any; id: string }) => {
	const next_status = getNextStatus(status);
	return (
		<button
			onClick={(e) => {
				e.preventDefault();
				update_progress(next_status);
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

const TodoCard = ({ initial_item, layout, set_item }: { initial_item: FetchedTask; layout: string; set_item: (item: FetchedTask) => void }) => {
	const update_item = trpc.tasks.update_item.useMutation();
	const delete_item = trpc.tasks.delete_item.useMutation();
	const add_module = trpc.tasks.add_module.useMutation();
	const update_module = trpc.tasks.update_module.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TASK_PROGRESS) => {
		const new_item = { ...initial_item, progress: status };
		update_item.mutate({ item: new_item, id: initial_item.id }, { onSuccess: (data) => set_item(data as FetchedTask) });
	};

	/** @todo implement the module update inside of the update item query, instead of chained calls. */
	const updateItem = (item: ItemInput, modules: { type: string; data: string }[]) => {
		update_item.mutate(
			{ id: initial_item.id, item },
			{
				onSuccess: () => {
					update_module.mutate(
						{ modules: modules, task_id: initial_item.id },
						{
							onSuccess: (data) => {
								set_item(data as FetchedTask);
							}
						}
					);
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
			{ task_id: initial_item.id, module_id: module },
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
					<TodoEditForm item={initial_item} updateItem={updateItem} setOpen={setEditModalOpen} deleteItem={deleteCard} addModule={addModule} />
				</GenericModal>
			</div>
			<div className={"group relative w-full rounded-md bg-gray-100 dark:bg-pad-gray-600 px-4 py-2 " + (layout == TODO_LAYOUT.LIST ? "flex flex-wrap gap-4" : "")}>
				<div className="inline-flex items-center gap-2 align-middle">
					<TodoStatus status={initial_item.progress} update_progress={setItemStatus} id={initial_item.id} />
					<h1 className=" text-2xl font-medium">{initial_item.title}</h1>
				</div>
				<EndTime endTime={getModuleData(initial_item, Module.END_DATE)} />
				<TodoTags tags={initial_item?.tags} />
				<SummaryText module={getModuleData(initial_item, Module.SUMMARY)} />
				<div className={"text-gray-400 dark:text-pad-gray-400 duration-400 absolute right-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0 " + (layout == "GRID" ? "bottom-2" : "bottom-[25%]")}>
					<span title={initial_item.visibility[0]?.toUpperCase() + initial_item.visibility.toLowerCase().substring(1)}>
						<VisiblityIcon visibility={initial_item.visibility} />
					</span>
					<button
						className={hoverLinkClass}
						title="Edit"
						onClick={(e) => {
							e.preventDefault();
							setEditModalOpen(true);
						}}
					>
						<Edit2 className="" />
					</button>
				</div>
			</div>
		</>
	);
};

const EndTime = ({ endTime }: { endTime: { date: Date } }) => {
	if (!endTime || !endTime.date) return <></>;
	const { date: timestamp } = endTime;
	const date = new Date(timestamp);
	const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" };
	return (
		<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
			<CalendarClock className="min-w-5 w-5" />
			<span>{date.toLocaleDateString(undefined, options).replaceAll(", ", " @ ")}</span>
		</div>
	);
};

const TodoTags = ({ tags }: { tags: TaskTags[] }) => {
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

const SummaryText = ({ module }: { module: { summary: string } }) => {
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
