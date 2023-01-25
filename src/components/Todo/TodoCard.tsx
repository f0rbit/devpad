import { useState } from "react";
import { FetchedTask, trpc } from "src/utils/trpc";
import { CalendarClock, Edit2, Newspaper, Tags } from "lucide-react";
import { hoverLinkClass } from "../HoverLink";
import TodoTag from "./TodoTag";
import VisiblityIcon from "./VisibilityIcon";
import StatusIcon from "./StatusIcon";
import GenericModal from "../GenericModal";
import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { TODO_LAYOUT } from "./ListLayout";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Module } from "@/types/page-link";

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

const TodoStatus = ({
	status,
	update_progress,
	id
}: {
	status: TASK_PROGRESS;
	update_progress: any;
	id: string;
}) => {
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

const TodoCard = ({
	initial_item,
	layout,
	set_item
}: {
	initial_item: FetchedTask;
	layout: string;
	set_item: (item: FetchedTask) => void;
}) => {
	const update_item = trpc.tasks.update_item.useMutation();
	const delete_item = trpc.tasks.delete_item.useMutation();
	const add_module = trpc.tasks.add_module.useMutation();
	const update_module = trpc.tasks.update_module.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TASK_PROGRESS) => {
		const new_item = { ...initial_item, progress: status };
		update_item.mutate({ item: new_item, id: initial_item.id });
		set_item(new_item);
	};

	const updateItem = (item: ItemInput, modules: { type: string, data: string }[]) => {
		update_item.mutate(
			{
				id: initial_item.id,
				item
			},
			{
				onSuccess: (data) => {
					set_item(data as FetchedTask);
				}
			}
		);

		update_module.mutate({
			modules: modules,
			task_id: initial_item.id
		},
		{
			onSuccess: (data) => {
				set_item(data as FetchedTask)
			}
		})
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
		add_module.mutate({ task_id: initial_item.id, module_id: module }, {
			onSuccess: (data) => {
				set_item(data as FetchedTask);
			}
		});
	}


	if (initial_item.visibility == TASK_VISIBILITY.DELETED) return null;
	// TODO: refactor this
	if (layout == TODO_LAYOUT.GRID) {
		return (
			<>
				<div className="absolute">
					<GenericModal
						open={editModalOpen}
						setOpen={setEditModalOpen}
					>
						<TodoEditForm
							item={initial_item}
							updateItem={updateItem}
							setOpen={setEditModalOpen}
							deleteItem={deleteCard}
							addModule={addModule}
						/>
					</GenericModal>
				</div>
				<div className="group relative w-full rounded-md bg-pad-gray-600 px-4 py-2 drop-shadow-md">
					<div className="inline-flex items-center gap-2 align-middle">
						<TodoStatus
							status={initial_item.progress}
							update_progress={setItemStatus}
							id={initial_item.id}
						/>
						<h1 className=" text-2xl font-medium">
							{initial_item.title}
						</h1>
					</div>
					{/* {initial_item.end_time && (
						<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
							<CalendarClock className="min-w-5 w-5" />
							<span>
								{initial_item.end_time?.toLocaleDateString()}
							</span>
							<span>
								{initial_item.end_time
									?.toTimeString()
									.split(" ")[0]
									?.substring(0, 5)}
							</span>
						</div>
					)} */}
					{initial_item.tags?.length > 0 && (
						<div className="flex items-center gap-2 align-middle">
							<span>
								<Tags className="w-5" />
							</span>
							<span>
								{initial_item.tags.map((tag, index) => {
									return <TodoTag key={index} tag={tag} />;
								})}
							</span>
						</div>
					)}

					{/* {initial_item.summary != undefined &&
						initial_item.summary?.length > 0 && (
							<div className="flex items-center gap-2 align-middle">
								<span>
									<Newspaper className="w-5" />
								</span>
								<span className="font-mono text-sm">
									{initial_item.summary}
								</span>
							</div>
						)} */}
					<div className="duration-400 absolute right-2 bottom-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0">
						<span
							className="text-gray-500 dark:text-pad-gray-400"
							title={
								initial_item.visibility[0]?.toUpperCase() +
								initial_item.visibility
									.toLowerCase()
									.substring(1)
							}
						>
							<VisiblityIcon
								visibility={initial_item.visibility}
							/>
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
	} else {
		// list item
		return (
			<>
				<div className="absolute">
					<GenericModal
						open={editModalOpen}
						setOpen={setEditModalOpen}
					>
						<TodoEditForm
							item={initial_item}
							updateItem={updateItem}
							setOpen={setEditModalOpen}
							deleteItem={deleteCard}
							addModule={addModule}
						/>
					</GenericModal>
				</div>
				<div className="group relative flex w-full flex-wrap gap-4 rounded-md bg-pad-gray-600 px-4 py-2 drop-shadow-md">
					<div className="inline-flex items-center gap-2 align-middle">
						<TodoStatus
							status={initial_item.progress}
							update_progress={setItemStatus}
							id={initial_item.id}
						/>
						<h1 className=" text-2xl font-medium">
							{initial_item.title}
						</h1>
					</div>
					{/* {initial_item.end_time && (
						<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
							<CalendarClock className="min-w-5 w-5" />
							<span>
								{initial_item.end_time?.toLocaleDateString()}
							</span>
							<span>
								{initial_item.end_time
									?.toTimeString()
									.split(" ")[0]
									?.substring(0, 5)}
							</span>
						</div>
					)} */}
					{initial_item.tags?.length > 0 && (
						<div className="flex items-center gap-2 align-middle">
							<span>
								<Tags className="w-5" />
							</span>
							<span>
								{initial_item.tags.map((tag, index) => {
									return <TodoTag key={index} tag={tag} />;
								})}
							</span>
						</div>
					)}

					{/* {initial_item.summary != undefined &&
						initial_item.summary?.length > 0 && (
							<div className="flex items-center gap-2 align-middle">
								<span>
									<Newspaper className="w-5" />
								</span>
								<span className="font-mono text-sm">
									{initial_item.summary}
								</span>
							</div>
						)} */}
					<div
						className={
							"duration-400 absolute right-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0 " +
							(layout == "GRID" ? "bottom-2" : "bottom-[25%]")
						}
					>
						<span
							className="text-gray-500 dark:text-pad-gray-400"
							title={
								initial_item.visibility[0]?.toUpperCase() +
								initial_item.visibility
									.toLowerCase()
									.substring(1)
							}
						>
							<VisiblityIcon
								visibility={initial_item.visibility}
							/>
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
	}
};

export default TodoCard;
