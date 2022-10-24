import { TODO_Item, TODO_STATUS } from "@prisma/client";
import { dateToDateTime } from "src/utils/dates";

const TodoEditForm = ({
    item,
    updateItem,
    setOpen
}: {
    item: TODO_Item;
    updateItem: any;
    setOpen: any;
}) => {
    return (
        <div
            style={{ maxHeight: "calc(60vh)" }}
            className="overflow-y-auto pr-2 text-neutral-300 scrollbar-hide"
        >
            <div className="mb-4 w-full text-center text-xl">
                Todo Edit Form
            </div>
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
                    defaultValue={item.title}
                />
                <label htmlFor="summary">Summary</label>
                <input
                    type="text"
                    name="summary"
                    id="summary"
                    defaultValue={item.summary ?? ""}
                ></input>
                <label htmlFor="description">Description</label>
                <textarea
                    name="description"
                    id="description"
                    defaultValue={
                        typeof item.description != "string"
                            ? JSON.stringify(item.description ?? {})
                            : item.description
                    }
                    className="scrollbar-hide h-96"
                ></textarea>
                <label htmlFor="progress">Progress</label>
                <div className="relative inline-flex flex-row gap-4">
                    <select
                        name="progress"
                        id="progress"
                        defaultValue={item.progress}
                        className="w-full"
                    >
                        <option value="UNSTARTED" className="text-gray-400">
                            Not Started
                        </option>
                        <option value="IN_PROGRESS" className="text-blue-400">
                            In Progress
                        </option>
                        <option value="COMPLETED" className="text-green-400">
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
                        defaultValue={item.visibility}
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
                    defaultValue={dateToDateTime(item.start_time ?? new Date())}
                />
                <label htmlFor="end_date">End Date</label>
                <input
                    type="datetime-local"
                    name="end_date"
                    id="end_date"
                    defaultValue={
                        item.end_time ? dateToDateTime(item.end_time) : ""
                    }
                />
            </div>
            <div className="mt-4 flex justify-center mb-1">
                <button
                    className="rounded-md bg-green-200 px-4 py-2 text-pad-gray-700 transition-all duration-300 hover:scale-110 hover:bg-green-300"
                    onClick={(e) => {
                        e.preventDefault();
                        const title = document.getElementById(
                            "title"
                        ) as HTMLInputElement;
                        const summary = document.getElementById(
                            "summary"
                        ) as HTMLInputElement;
                        const description = document.getElementById(
                            "description"
                        ) as HTMLInputElement;
                        const progress = document.getElementById(
                            "progress"
                        ) as HTMLSelectElement;
                        const visibility = document.getElementById(
                            "visibility"
                        ) as HTMLSelectElement;
                        const start_date = document.getElementById(
                            "start_date"
                        ) as HTMLInputElement;
                        const end_date = document.getElementById(
                            "end_date"
                        ) as HTMLInputElement;
                        console.log("start_date", start_date.value);
                        console.log("end_date", end_date.value);
                        updateItem({
                            id: item.id,
                            title: title.value,
                            summary: summary.value,
                            description: JSON.parse(description.value),
                            status: progress.value as TODO_STATUS,
                            visibility:
                                visibility.value as TODO_Item["visibility"],
                            start_time: new Date(start_date.value),
                            end_time: new Date(end_date.value)
                        });
                        setOpen(false);
                    }}
                >
                    Save
                </button>
            </div>
        </div>
    );
};
export default TodoEditForm;
