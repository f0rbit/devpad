import { TODO_Item, TODO_STATUS } from "@prisma/client";
import StatusIcon from "./StatusIcon";

const TodoEditForm = ({item, updateItem, setOpen}: {item: TODO_Item, updateItem: any, setOpen: any}) => {
    return (
        <div style={{maxHeight: "calc(60vh)"}} className="text-neutral-300 overflow-y-auto pr-2">
            <div className="text-xl text-center w-full mb-4">Todo Edit Form</div>
            <div style={{gridTemplateColumns: "1fr 7fr", width: "calc(100vw - 90px)"}} className="flex flex-col md:grid gap-2 md:max-w-[500px] xl:max-w-[700px]" id="edit-todo">
                <label htmlFor="title">Title</label>
                <input type="text" name="title" id="title" defaultValue={item.title} />
                <label htmlFor="summary">Summary</label>
                <input type="text" name="summary" id="summary" defaultValue={item.summary ?? ""} ></input>
                <label htmlFor="description">Description</label>
                <textarea name="description" id="description" defaultValue={JSON.stringify(item.description ?? {}, null, 4)} className="h-96 scrollbar-hide"></textarea>
                <label htmlFor="progress">Progress</label>
                <select name="progress" id="progress" defaultValue={item.progress}>
                    <option value="UNSTARTED" className="text-gray-400">Not Started</option>
                    <option value="IN_PROGRESS" className="text-blue-400">In Progress</option>
                    <option value="COMPLETED" className="text-green-400">Done</option>
                </select>
                <label htmlFor="Visiblity">Visibility</label>
                <select name="visibility" id="visibility" defaultValue={item.visibility}>
                    <option value="PRIVATE">Private</option>
                    <option value="PUBLIC">Public</option>
                    <option value="HIDDEN">Hidden</option>
                    <option value="DRAFT">Draft</option>
                    <option value="ARCHIVED">Archived</option>
                </select>

            </div>
            <div className="flex justify-center mt-4">
                <button className="bg-green-200 rounded-md px-4 py-2 text-pad-gray-700 hover:bg-green-300 hover:scale-110 transition-all duration-300" onClick={(e) => {
                    e.preventDefault();
                    const title = document.getElementById("title") as HTMLInputElement;
                    const summary = document.getElementById("summary") as HTMLInputElement;
                    const description = document.getElementById("description") as HTMLInputElement;
                    const progress = document.getElementById("progress") as HTMLSelectElement;
                    const visibility = document.getElementById("visibility") as HTMLSelectElement;
                    console.log(progress.value);
                    console.log(item.progress);
                    updateItem({
                        id: item.id,
                        title: title.value,
                        summary: summary.value,
                        description: JSON.parse(description.value),
                        status: progress.value as TODO_STATUS,
                        visibility: visibility.value as TODO_Item["visibility"]
                    });
                    setOpen(false);
                }}>Save</button>
            </div>
        </div>
    )
}
export default TodoEditForm;