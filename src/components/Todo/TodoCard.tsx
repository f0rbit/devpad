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

const TodoCard = ({ initial_item, layout }: { initial_item: FetchedTodo, layout: string }) => {
	const update_progress = trpc.todo.updateProgress.useMutation();
	const update_item = trpc.todo.updateItem.useMutation();
	const delete_item = trpc.todo.deleteItem.useMutation();
	const [item, setItem] = useState(initial_item);
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TODO_STATUS) => {
		update_progress.mutate({ progress: status, item_id: item.id });
		setItem({
			...item,
			progress: status
		});
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
		setItem({
			...item,
			title,
			summary,
			description: description,
			progress: status,
			visibility,
			start_time,
			end_time
		});
		update_item.mutate({
			id: item.id,
			item: {
				title,
				summary,
				description: JSON.stringify(description),
				progress: status,
				visibility,
				start_time,
				end_time
			}
		});
	};

	const deleteCard = async ({ id }: { id: string }) => {
		await delete_item.mutate(
			{ id },
			{
				onSuccess: ({ success }) => {
					if (success) {
						setItem({
							...item,
							visibility: TODO_VISBILITY.DELETED
						});
					}
				}
			}
		);
	};
	if (item.visibility == TODO_VISBILITY.DELETED) return null;
    if (layout == TODO_LAYOUT.GRID) {
        return (
            <>
                <div className="absolute">
                    <GenericModal open={editModalOpen} setOpen={setEditModalOpen}>
                        <TodoEditForm
                            item={item}
                            updateItem={updateItem}
                            setOpen={setEditModalOpen}
                            deleteItem={deleteCard}
                        />
                    </GenericModal>
                </div>
                <div className="group relative w-full rounded-md bg-pad-gray-600 px-4 py-2 drop-shadow-md">
                    <div className="inline-flex items-center gap-2 align-middle">
                        <TodoStatus
                            status={item.progress}
                            update_progress={setItemStatus}
                            id={item.id}
                        />
                        <h1 className=" text-2xl font-medium">{item.title}</h1>
                    </div>
                    {item.end_time && (
                        <div className="flex flex-wrap items-center gap-2 align-middle text-sm">
                            <CalendarClock className="min-w-5 w-5" />
                            <span>{item.end_time?.toLocaleDateString()}</span>
                            <span>
                                {item.end_time
                                    ?.toTimeString()
                                    .split(" ")[0]
                                    ?.substring(0, 5)}
                            </span>
                        </div>
                    )}
                    {item.tags?.length > 0 && (
                        <div className="flex items-center gap-2 align-middle">
                            <span>
                                <Tags className="w-5" />
                            </span>
                            <span>
                                {item.tags.map((tag, index) => {
                                    return <TodoTag key={index} tag={tag} />;
                                })}
                            </span>
                        </div>
                    )}
    
                    {item.summary != undefined && item.summary?.length > 0 && (
                        <div className="flex items-center gap-2 align-middle">
                            <span>
                                <Newspaper className="w-5" />
                            </span>
                            <span className="font-mono text-sm">
                                {item.summary}
                            </span>
                        </div>
                    )}
                    <div className="duration-400 absolute right-2 bottom-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0">
                        <span
                            className="text-gray-500 dark:text-pad-gray-400"
                            title={
                                item.visibility[0]?.toUpperCase() +
                                item.visibility.toLowerCase().substring(1)
                            }
                        >
                            <VisiblityIcon visibility={item.visibility} />
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
                    <GenericModal open={editModalOpen} setOpen={setEditModalOpen}>
                        <TodoEditForm
                            item={item}
                            updateItem={updateItem}
                            setOpen={setEditModalOpen}
                            deleteItem={deleteCard}
                        />
                    </GenericModal>
                </div>
                <div className="group relative w-full rounded-md bg-pad-gray-600 px-4 py-2 drop-shadow-md flex gap-4 flex-wrap">
                    <div className="inline-flex items-center gap-2 align-middle">
                        <TodoStatus
                            status={item.progress}
                            update_progress={setItemStatus}
                            id={item.id}
                        />
                        <h1 className=" text-2xl font-medium">{item.title}</h1>
                    </div>
                    {item.end_time && (
                        <div className="flex flex-wrap items-center gap-2 align-middle text-sm">
                            <CalendarClock className="min-w-5 w-5" />
                            <span>{item.end_time?.toLocaleDateString()}</span>
                            <span>
                                {item.end_time
                                    ?.toTimeString()
                                    .split(" ")[0]
                                    ?.substring(0, 5)}
                            </span>
                        </div>
                    )}
                    {item.tags?.length > 0 && (
                        <div className="flex items-center gap-2 align-middle">
                            <span>
                                <Tags className="w-5" />
                            </span>
                            <span>
                                {item.tags.map((tag, index) => {
                                    return <TodoTag key={index} tag={tag} />;
                                })}
                            </span>
                        </div>
                    )}
    
                    {item.summary != undefined && item.summary?.length > 0 && (
                        <div className="flex items-center gap-2 align-middle">
                            <span>
                                <Newspaper className="w-5" />
                            </span>
                            <span className="font-mono text-sm">
                                {item.summary}
                            </span>
                        </div>
                    )}
                    <div className="duration-400 absolute right-2 bottom-2 flex flex-row items-center justify-center gap-2 align-middle transition-opacity group-hover:opacity-100 md:opacity-0">
                        <span
                            className="text-gray-500 dark:text-pad-gray-400"
                            title={
                                item.visibility[0]?.toUpperCase() +
                                item.visibility.toLowerCase().substring(1)
                            }
                        >
                            <VisiblityIcon visibility={item.visibility} />
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
