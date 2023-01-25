import { Module } from "@/types/page-link";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { FetchedTask } from "src/utils/trpc";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoEditForm = ({
	item,
	updateItem,
	setOpen,
	deleteItem,
	addModule,
}: {
	item: FetchedTask;
	updateItem: any;
	setOpen: any;
	deleteItem: any;
	addModule: (module: Module) => void;
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
			
			
				// const description = document.getElementById(
				// 	"description"
				// ) as HTMLInputElement;
				const progress = document.getElementById(
					"progress"
				) as HTMLSelectElement;
				const visibility = document.getElementById(
					"visibility"
				) as HTMLSelectElement;
			
		
				// end date could be null
				updateItem({
					id: item.id,
					title: title.value,
					// description: JSON.parse(description.value),
					progress: progress.value as TASK_PROGRESS,
					visibility: visibility.value as TASK_VISIBILITY,
				});
				setOpen(false);
			}}
			addModule={addModule}
		/>
	);
};

export default TodoEditForm;
