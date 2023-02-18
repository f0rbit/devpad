import TodoCreator from "@/components/common/TodoCreator";
import { CreateItemOptions } from "@/types/page-link";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoCreateForm = ({
	createItem,
	setOpen
}: {
	createItem: (item: CreateItemOptions) => void;
	setOpen: (open: boolean) => void;
}) => {
	return (
		// <GenericTodoUpdateForm
		// 	title={"Create Item"}
		// 	buttonText={"Create"}
		// 	onClick={() => {
		// 		const title = document.getElementById(
		// 			"title"
		// 		) as HTMLInputElement;
			
		// 		// const description = document.getElementById(
		// 		// 	"description"
		// 		// ) as HTMLInputElement;
		// 		const progress = document.getElementById(
		// 			"progress"
		// 		) as HTMLSelectElement;
		// 		const visibility = document.getElementById(
		// 			"visibility"
		// 		) as HTMLSelectElement;
			
		// 		createItem({
		// 			title: title.value,
		// 			// description: JSON.parse(description.value),
		// 			progress: progress.value as TASK_PROGRESS,
		// 			visibility: visibility.value as TASK_VISIBILITY,
		// 		});
		// 		setOpen(false);
		// 	}}
		// />
		<TodoCreator onCreate={(item) => {
			createItem(item);
			setOpen(false)
		}}/>
	);
};

export default TodoCreateForm;
