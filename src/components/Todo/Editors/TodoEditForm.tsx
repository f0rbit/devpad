import { FetchedTask, Module } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import GenericTodoUpdateForm from "./GenericTodoUpdateForm";

export const TodoEditForm = ({ item, updateItem, setOpen, deleteItem, addModule, tags }: { item: FetchedTask; updateItem: any; setOpen: any; deleteItem: any; addModule: (module: Module) => void, tags: TaskTags[] | undefined }) => {
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
				const title = document.getElementById("title") as HTMLInputElement;

				// const description = document.getElementById(
				// 	"description"
				// ) as HTMLInputElement;
				const progress = document.getElementById("progress") as HTMLSelectElement;
				const visibility = document.getElementById("visibility") as HTMLSelectElement;

				// get module data
				const modules = getModuleInput(item);

				// end date could be null
				updateItem(
					{
						id: item.id,
						title: title.value,
						// description: JSON.parse(description.value),
						progress: progress.value as TASK_PROGRESS,
						visibility: visibility.value as TASK_VISIBILITY
					},
					modules
				);
				setOpen(false);
			}}
			addModule={addModule}
			tags={tags}
			saveTags={(tagIDs: string[]) => {
				updateItem(
					{
						...item,
						tags: tagIDs
					},
					[]
				);
				setOpen(false);
			}}
		/>
	);
};

export default TodoEditForm;

const getModuleInput = (item: FetchedTask) => {
	const inputs = [];
	// for each module
	for (const module of item.modules) {
		// get the input
		const input = document.getElementById(`module-${module.id}`) as HTMLInputElement;

		if (!input) continue;

		// add it to the array
		inputs.push({
			type: module.type,
			data: transformInput(module.type as Module, input.value)
		});
	}
	return inputs;
};

const transformInput = (module: Module, value: string) => {
	switch (module) {
		case Module.SUMMARY:
			return { summary: value };
		case Module.DESCRIPTION:
			return { description: [
				{"markdown": { "text": value } }
			]}
		case Module.START_DATE:
		case Module.END_DATE:
			return { date: new Date(value)}
		case Module.PRIORITY:
			return { priority: parseInt(value) }
		default:
			return value;
	}
};

