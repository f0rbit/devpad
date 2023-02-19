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
	const deleteItem = trpc.tasks.deleteItem.useMutation();
	const updateItem = trpc.tasks.updateItem.useMutation();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const setItemStatus = async (status: TASK_PROGRESS) => {
		saveTask({ ... initial_item, progress: status });
	};

	async function saveTask(task: LoadedTask) {
		task.network_status = { error: "", loading: true };
		set_item(task);
		const data = await updateItem.mutateAsync({ item: task });
		if (data.error) {
			task.network_status = { error: data.error, loading: false };
			set_item(task);
		} else if (data.data) {	
			const item = data.data as LoadedTask;
			// data.data is the item as a FetchedTask
			item.network_status = { error: "", loading: false };
			set_item(item);
			setTimeout(() => {
				set_item({ ...item, network_status: undefined } as LoadedTask);
			}, 2000);
		}
	}

	async function deleteTask(task: LoadedTask) {
		const { success, error } = await deleteItem.mutateAsync({ id: task.id });
		if (error) {
			console.error(error);
		} else if (success) {
			set_item({ ...task, visibility: TASK_VISIBILITY.DELETED } as FetchedTask);
		}
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
