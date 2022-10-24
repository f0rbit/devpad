// React todo card component

import { Prisma, TODO_Item, TODO_STATUS, TODO_VISBILITY } from "@prisma/client";
import { useState } from "react";
import { trpc } from "src/utils/trpc";
import { Edit2, Newspaper, Tags } from "lucide-react";
import { hoverLinkClass } from "../HoverLink";
import TodoTag from "./TodoTag";
import { FetchedTodo } from "./ListRenderer";
import VisiblityIcon from "./VisibilityIcon";
import StatusIcon from "./StatusIcon";
import DescriptionParser from "./Description/DescriptionParser";
import GenericModal from "../GenericModal";
import TodoEditForm from "./TodoEditForm";

const COLOURS = {
    COMPLETED: {
        colour: "text-green-400"
    },
    UNSTARTED: {
        colour: "text-gray-400"
    },
    IN_PROGRESS: {
        colour: "text-blue-400"
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

const TodoCard = ({ initial_item }: { initial_item: FetchedTodo }) => {
    const update_progress = trpc.todo.updateProgress.useMutation();
    const update_item = trpc.todo.updateItem.useMutation();
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
        visibility
    }: {
        title: string;
        summary: string;
        description: object;
        status: TODO_STATUS;
        visibility: TODO_VISBILITY;
    }) => {
        setItem({
            ...item,
            title,
            summary,
            description: description,
            progress: status,
            visibility
        });
        update_item.mutate({
            id: item.id,
            item: {
                title,
                summary,
                description: JSON.stringify(description),
                progress: status,
                visibility
            }
        });
    };

    return (
        <>
            <div className="absolute">
                <GenericModal open={editModalOpen} setOpen={setEditModalOpen}>
                    <TodoEditForm
                        item={item}
                        updateItem={updateItem}
                        setOpen={setEditModalOpen}
                    />
                </GenericModal>
            </div>
            <div className="group relative w-full rounded-md bg-pad-gray-600 p-4 drop-shadow-md">
                <div className="inline-flex items-center gap-2 align-middle">
                    <TodoStatus
                        status={item.progress}
                        update_progress={setItemStatus}
                        id={item.id}
                    />
                    <h1 className="whitespace-nowrap text-2xl font-medium">
                        {item.title}
                    </h1>
                </div>
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
};

export default TodoCard;
