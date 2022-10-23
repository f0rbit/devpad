// React todo card component

import { TODO_Item, TODO_STATUS } from "@prisma/client";
import { trpc } from "src/utils/trpc";

const COLOURS = {
    COMPLETED: {
        bg: "bg-green-500",
        outline: "border-green-400"
    },
    UNSTARTED: {
        bg: "bg-gray-500",
        outline: "border-gray-400"
    },
    IN_PROGRESS: {
        bg: "bg-blue-500",
        outline: "border-blue-400"
    }
};

const getNextStatus = (status: TODO_STATUS) => {
    switch (status) {
        case TODO_STATUS.COMPLETED:
            return TODO_STATUS.COMPLETED;
        case TODO_STATUS.UNSTARTED:
            return TODO_STATUS.IN_PROGRESS;
        case TODO_STATUS.IN_PROGRESS:
            return TODO_STATUS.COMPLETED;
    }
};

const TodoStatus = ({ status, update_progress, id }: { status: TODO_STATUS; update_progress: any; id: string }) => {
    const next_status = getNextStatus(status);
    console.log(next_status);
    return (
        <button
            onClick={(e) => {
                e.preventDefault();
                console.log("Upgrade status");
                update_progress.mutate({ progress: next_status, item_id: id });
            }}
            title={"Change status to " + next_status}
        >
            <div
                className={
                    COLOURS[status].bg +
                    " " +
                    COLOURS[status].outline +
                    " h-5 w-5 rounded-lg border-2"
                }
            ></div>
        </button>
    );
};

const TodoCard = ({ item }: { item: TODO_Item }) => {
    const update_progress = trpc.todo.updateProgress.useMutation();


    return (
        <div className="w-full rounded-md bg-pad-gray-600 p-4 drop-shadow-md">
            <div className="inline-flex items-center gap-2 align-middle">
                <TodoStatus status={item.progress} update_progress={update_progress} id={item.id} />
                <h1 className="sm:text-lg md:text-xl lg:text-2xl whitespace-nowrap font-bold">{item.title}</h1>
            </div>
            <p>Status: {item.progress}</p>
            <p>Visiblity: {item.visibility}</p>
        </div>
    );
};

export default TodoCard;
