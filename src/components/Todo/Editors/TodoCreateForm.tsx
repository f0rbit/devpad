import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoCreateForm = ({
	createItem,
	setOpen
}: {
	createItem: any;
	setOpen: any;
}) => {
	return (
		<GenericTodoUpdateForm
			title={"Create Item"}
			buttonText={"Create"}
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
				createItem({
					title: title.value,
					summary: summary.value,
					// description: JSON.parse(description.value),
					progress: progress.value as TASK_PROGRESS,
					visibility: visibility.value as TASK_VISIBILITY,
					start_time: new Date(start_date.value),
					end_time: new Date(end_date.value)
				});
				setOpen(false);
			}}
		/>
	);
};

export default TodoCreateForm;
