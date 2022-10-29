import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { FetchedTask } from "src/utils/trpc";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoEditForm = ({
	item,
	updateItem,
	setOpen,
	deleteItem
}: {
	item: FetchedTask;
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
				// const description = document.getElementById(
				// 	"description"
				// ) as HTMLInputElement;
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
				// end date could be null
				updateItem({
					id: item.id,
					title: title.value,
					summary: summary.value,
					// description: JSON.parse(description.value),
					progress: progress.value as TASK_PROGRESS,
					visibility: visibility.value as TASK_VISIBILITY,
					start_time: new Date(start_date.value),
					end_time: end_date?.value ? new Date(end_date.value) : null
				});
				setOpen(false);
			}}
		/>
	);
};

export default TodoEditForm;
