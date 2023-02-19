import TodoEditForm from "@/components/Todo/Editors/TodoEditForm";
import { FetchedTask, LoadedTask, Module } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { useState } from "react";
import { trpc } from "src/utils/trpc";
import TaskCard from "../common/TaskCard";
import TaskEditor from "../common/TaskEditor";
import GenericModal from "../GenericModal";
import { TODO_LAYOUT } from "./ListLayout";

type ItemInput = {
	title: string;
	progress: TASK_PROGRESS;
	visibility: TASK_VISIBILITY;
};

const TodoCard = ({ initial_item, layout, set_item, tags }: { initial_item: FetchedTask; layout: TODO_LAYOUT; set_item: (item: FetchedTask) => void; tags: TaskTags[] | undefined }) => {
	const update_item = trpc.tasks.updateOldItem.useMutation();
	// const delete_item = trpc.tasks.deleteItem.useMutation();
	// const add_module = trpc.tasks.addModule.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = (status: TASK_PROGRESS) => {
		const new_item: ItemInput = { title: initial_item.title, visibility: initial_item.visibility, progress: status };
		update_item.mutate({ item: new_item, id: initial_item.id }, { onSuccess: (data) => set_item(data as FetchedTask) });
	};

	async function saveTask(task: LoadedTask) {

	}

	async function deleteTask(task: LoadedTask) {

	}

	if (initial_item.visibility == TASK_VISIBILITY.DELETED) return null;

	// list item
	return (
		<>
			<div className="fixed z-50">
				<GenericModal
					open={editModalOpen}
					setOpen={setEditModalOpen}
				>
					<TaskEditor task={initial_item} tags={tags} close={() => setEditModalOpen(false)} saveTask={saveTask} deleteTask={deleteTask} />
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
