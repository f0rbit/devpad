import { TODO_Item } from "@prisma/client";
import { dateToDateTime } from "src/utils/dates";
import { COLOURS } from "@/components/Todo/TodoCard";

const GenericTodoEditForm = ({
    item,
    title,
    onClick,
    buttonText,
    onDeleteClick
}: {
    item?: TODO_Item;
    title: string;
    onClick: any;
    buttonText: string;
    onDeleteClick?: () => void;
}) => {
    return (
        <div
            style={{ maxHeight: "calc(60vh)" }}
            className="scrollbar-hide overflow-y-auto pr-2 text-neutral-300"
        >
            <div className="mb-4 w-full text-center text-xl">{title}</div>
            <div
                style={{
                    gridTemplateColumns: "1fr 7fr",
                    width: "calc(100vw - 90px)"
                }}
                className="flex flex-col gap-2 md:grid md:max-w-[500px] xl:max-w-[700px]"
                id="edit-todo"
            >
                <label htmlFor="title">Title</label>
                <input
                    type="text"
                    name="title"
                    id="title"
                    defaultValue={item?.title}
                />
                <label htmlFor="summary">Summary</label>
                <input
                    type="text"
                    name="summary"
                    id="summary"
                    defaultValue={item?.summary ?? ""}
                ></input>
                <label htmlFor="description">Description</label>
                <textarea
                    name="description"
                    id="description"
                    defaultValue={
                        (typeof item?.description != "string"
                            ? JSON.stringify(item?.description ?? {})
                            : item?.description) ?? ""
                    }
                    className="scrollbar-hide h-96"
                ></textarea>
                <label htmlFor="progress">Progress</label>
                <div className="relative inline-flex flex-row gap-4">
                    <select
                        name="progress"
                        id="progress"
                        defaultValue={item?.progress}
                        className="w-full"
                    >
                        <option
                            value="UNSTARTED"
                            className={COLOURS.UNSTARTED.colour}
                        >
                            Not Started
                        </option>
                        <option
                            value="IN_PROGRESS"
                            className={COLOURS.IN_PROGRESS.colour}
                        >
                            In Progress
                        </option>
                        <option
                            value="COMPLETED"
                            className={COLOURS.COMPLETED.colour}
                        >
                            Done
                        </option>
                    </select>
                    <label htmlFor="Visiblity">
                        <div className="absolute bottom-8 right-0 w-full text-right text-pad-gray-50 md:contents">
                            Visiblity
                        </div>
                    </label>
                    <select
                        name="visibility"
                        id="visibility"
                        defaultValue={item?.visibility}
                        className="w-full"
                    >
                        <option value="PRIVATE">Private</option>
                        <option value="PUBLIC">Public</option>
                        <option value="HIDDEN">Hidden</option>
                        <option value="DRAFT">Draft</option>
                        <option value="ARCHIVED">Archived</option>
                    </select>
                </div>
                <label htmlFor="start_date">Start Date</label>
                <input
                    type="datetime-local"
                    name="start_date"
                    id="start_date"
                    defaultValue={dateToDateTime(
                        item?.start_time ?? new Date()
                    )}
                />
                <label htmlFor="end_date">End Date</label>
                <input
                    type="datetime-local"
                    name="end_date"
                    id="end_date"
                    defaultValue={
                        item?.end_time ? dateToDateTime(item?.end_time) : ""
                    }
                />
            </div>
            <div className="mt-4 mb-1 flex justify-center gap-2">
                {onDeleteClick && (
                    <button
                        className="rounded-md bg-red-400 px-4 py-2 text-white  duration-300 hover:scale-110 hover:bg-red-500"
                        onClick={(e) => {
                            e.preventDefault();
                            onDeleteClick();
                        }}
                    >
                        Delete
                    </button>
                )}
                <button
                    className="rounded-md bg-green-200 px-4 py-2 text-pad-gray-700 transition-all duration-300 hover:scale-110 hover:bg-green-300"
                    onClick={(e) => {
                        e.preventDefault();
                        onClick();
                    }}
                >
                    {buttonText}
                </button>
            </div>
        </div>
    );
};
export default GenericTodoEditForm;
