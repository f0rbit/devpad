// React todo card component

import { TODO_STATUS, TODO_VISBILITY } from "@prisma/client";
import { useState } from "react";
import { trpc } from "src/utils/trpc";
import { CalendarClock, Edit2, Newspaper, Tags } from "lucide-react";
import { hoverLinkClass } from "../HoverLink";
import TodoTag from "./TodoTag";
import { FetchedTodo } from "./ListRenderer";
import VisiblityIcon from "./VisibilityIcon";
import StatusIcon from "./StatusIcon";
import GenericModal from "../GenericModal";
import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { TODO_LAYOUT } from "./ListLayout";

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

const getNextStatus = (status: TODO_STATUS) => {
	switch (status) {
		case "COMPLETED":
			return TODO_STATUS.COMPLETED;
		case "UNSTARTED":
			return TODO_STATUS.IN_PROGRESS;
		case "IN_PROGRESS":
			return TODO_STATUS.COMPLETED;
	}
};

const TodoStatus = ({
	status,
	update_progress,
	id
}: {
	status: TODO_STATUS;
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

const TodoCard = ({
	initial_item,
	layout,
	set_item
}: {
	initial_item: FetchedTodo;
	layout: string;
	set_item: (item: FetchedTodo) => void
}) => {
	const update_progress = trpc.todo.updateProgress.useMutation();
	const update_item = trpc.todo.updateItem.useMutation();
	const delete_item = trpc.todo.deleteItem.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TODO_STATUS) => {
		update_progress.mutate({ progress: status, item_id: initial_item.id });
		const new_item = { ...initial_item, progress: status };
		set_item(new_item);
	};

	const updateItem = ({
		title,
		summary,
		description,
		status,
		visibility,
		start_time,
		end_time
	}: {
		title: string;
		summary: string;
		description: object;
		status: TODO_STATUS;
		visibility: TODO_VISBILITY;
		start_time: Date;
		end_time: Date;
	}) => {
		// setItem({
		// 	...item,
		// 	title,
		// 	summary,
		// 	description: description,
		// 	progress: status,
		// 	visibility,
		// 	start_time,
		// 	end_time
		// });
		update_item.mutate({
			id: initial_item.id,
			item: {
				title,
				summary,
				description: JSON.stringify(description),
				progress: status,
				visibility,
				start_time,
				end_time
			}
		}, { onSuccess: (data) => {
			set_item(data as FetchedTodo);
		}});
	};

	const deleteCard = async ({ id }: { id: string }) => {
		await delete_item.mutate(
			{ id },
			{
				onSuccess: ({ success }) => {
					if (success) {
						set_item({
							...initial_item,
							visibility: TODO_VISBILITY.DELETED
						});
					}
				}
			}
		);
	};
	if (initial_item.visibility == TODO_VISBILITY.DELETED) return null;
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
						<h1 className=" text-2xl font-medium">{initial_item.title}</h1>
					</div>
					{initial_item.end_time && (
						<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
							<CalendarClock className="min-w-5 w-5" />
							<span>{initial_item.end_time?.toLocaleDateString()}</span>
							<span>
								{initial_item.end_time
									?.toTimeString()
									.split(" ")[0]
									?.substring(0, 5)}
							</span>
						</div>
					)}
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

					{initial_item.summary != undefined && initial_item.summary?.length > 0 && (
						<div className="flex items-center gap-2 align-middle">
							<span>
								<Newspaper className="w-5" />
							</span>
							<span className="font-mono text-sm">
								{initial_item.summary}
							</span>
						</div>
					)}
					<div className="duration-400 absolute right-2 bottom-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0">
						<span
							className="text-gray-500 dark:text-pad-gray-400"
							title={
								initial_item.visibility[0]?.toUpperCase() +
								initial_item.visibility.toLowerCase().substring(1)
							}
						>
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
						<h1 className=" text-2xl font-medium">{initial_item.title}</h1>
					</div>
					{initial_item.end_time && (
						<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
							<CalendarClock className="min-w-5 w-5" />
							<span>{initial_item.end_time?.toLocaleDateString()}</span>
							<span>
								{initial_item.end_time
									?.toTimeString()
									.split(" ")[0]
									?.substring(0, 5)}
							</span>
						</div>
					)}
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

					{initial_item.summary != undefined && initial_item.summary?.length > 0 && (
						<div className="flex items-center gap-2 align-middle">
							<span>
								<Newspaper className="w-5" />
							</span>
							<span className="font-mono text-sm">
								{initial_item.summary}
							</span>
						</div>
					)}
					<div className={"duration-400 absolute right-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0 " + (layout == "GRID" ? "bottom-2" : "bottom-[25%]")}>
						<span
							className="text-gray-500 dark:text-pad-gray-400"
							title={
								initial_item.visibility[0]?.toUpperCase() +
								initial_item.visibility.toLowerCase().substring(1)
							}
						>
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
	}
};

export default TodoCard;
