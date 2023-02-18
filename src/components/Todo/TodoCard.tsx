import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { FetchedTask, Module } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { useState } from "react";
import { trpc } from "src/utils/trpc";
import TaskCard from "../common/TaskCard";
import GenericModal from "../GenericModal";
import { TODO_LAYOUT } from "./ListLayout";

type ItemInput = {
	title: string;
	progress: TASK_PROGRESS;
	visibility: TASK_VISIBILITY;
};

const TodoCard = ({ initial_item, layout, set_item, tags }: { initial_item: FetchedTask; layout: TODO_LAYOUT; set_item: (item: FetchedTask) => void; tags: TaskTags[] | undefined }) => {
	const update_item = trpc.tasks.updateItem.useMutation();
	const delete_item = trpc.tasks.deleteItem.useMutation();
	const add_module = trpc.tasks.addModule.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TASK_PROGRESS) => {
		const new_item: ItemInput = { title: initial_item.title, visibility: initial_item.visibility, progress: status };
		update_item.mutate({ item: new_item, id: initial_item.id }, { onSuccess: (data) => set_item(data as FetchedTask) });
	};

	const updateItem = (item: ItemInput, modules: { type: string; data: string }[]) => {
		update_item.mutate(
			{ id: initial_item.id, item, modules },
			{
				onSuccess: (data) => {
					set_item(data as FetchedTask);
				}
			}
		);
	};

	const deleteCard = async ({ id }: { id: string }) => {
		await delete_item.mutate(
			{ id },
			{
				onSuccess: (success) => {
					if (success) {
						set_item({
							...initial_item,
							visibility: TASK_VISIBILITY.DELETED
						});
					}
				}
			}
		);
	};

	const addModule = (module: Module) => {
		// add the module to the item
		add_module.mutate(
			{ task_id: initial_item.id, module_type: module },
			{
				onSuccess: (data) => {
					set_item(data as FetchedTask);
				}
			}
		);
	};

	if (initial_item.visibility == TASK_VISIBILITY.DELETED) return null;

	// list item
	return (
		<>
			<div className="absolute">
				<GenericModal open={editModalOpen} setOpen={setEditModalOpen}>
					<TodoEditForm item={initial_item} updateItem={updateItem} setOpen={setEditModalOpen} deleteItem={deleteCard} addModule={addModule} tags={tags} />
				</GenericModal>
			</div>
			<TaskCard
				task={initial_item}
				layout={layout}
				onEdit={(e) => {
					e.preventDefault();
					setEditModalOpen(true);
				}}
				setItemStatus={setItemStatus}
			/>
		</>
	);
};



export default TodoCard;
