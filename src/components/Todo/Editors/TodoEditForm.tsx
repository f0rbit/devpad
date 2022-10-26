import { TODO_Item, TODO_STATUS, TODO_VISBILITY } from "@prisma/client";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoEditForm = ({
    item,
    updateItem,
    setOpen,
    deleteItem
}: {
    item: TODO_Item;
    updateItem: any;
    setOpen: any;
    deleteItem: any;
}) => {
    return (
        <GenericTodoUpdateForm
            item={item}
            title={"Edit Form"}
            buttonText={"Save"}
            onDeleteClick={() => {
                deleteItem({ id: item.id });
                setOpen(false);
            }}
            onClick={() => {
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
                    visibility: visibility.value as TODO_VISBILITY,
                    start_time: new Date(start_date.value),
                    end_time: new Date(end_date.value)
                });
                setOpen(false);
            }}
        />
    );
};

export default TodoEditForm;
