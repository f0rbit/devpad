"use client";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { CreateItemOptions, FetchedGoal, FetchedTask, LoadedTask } from "@/types/page-link";
import { TaskTags, TASK_VISIBILITY } from "@prisma/client";
import { ChevronDown, ChevronUp, Pencil, Save, Trash, X } from "lucide-react";
import moment from "moment";
import { useState } from "react";
import { dateToDateTime } from "src/utils/dates";
import DeleteButton from "../common/DeleteButton";
import GenericButton from "../common/GenericButton";
import PrimaryButton from "../common/PrimaryButton";
import TaskCard from "../common/TaskCard";
import TaskEditor from "../common/TaskEditor";
import TodoCreator from "../common/TodoCreator";
import GenericModal from "../GenericModal";
import { TODO_LAYOUT } from "../Todo/ListLayout";

type GoalCardProps = {
	goal: FetchedGoal | null;
	project_id: string;
	tags: TaskTags[];
	cancel?: () => void;
	create?: (goal: FetchedGoal) => void;
	deleteCard?: (id: string) => void;
};

export default function GoalCard({ goal, project_id, cancel, create, deleteCard, tags }: GoalCardProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [showTasks, setShowTasks] = useState(false);
	const [editingGoal, setEditingGoal] = useState({
		name: goal?.name ?? "",
		description: goal?.description ?? "",
		target_time: goal?.target_time ? new Date(goal?.target_time) : new Date()
	});
	const [error, setError] = useState("");
	const [tasks, setTasks] = useState((goal?.tasks ?? []) as LoadedTask[]);
	const [editingTask, setEditingTask] = useState(null as FetchedTask | null);

	async function createGoal() {
		const goal = {
			name: editingGoal.name,
			description: editingGoal.description,
			target_time: editingGoal.target_time.toISOString(),
			project_id
		};

		const response = await fetch("/api/projects/goal/create", { body: JSON.stringify(goal), method: "POST" });
		const { data, error } = await (response.json() as Promise<{ data: FetchedGoal | null; error: string }>);
		if (error) {
			setError(error);
		} else if (data) {
			create?.(data);
		} else {
			setError("Failed to create goal");
		}
	}

	async function createTask(task: CreateItemOptions) {
		task.goal_id = goal?.id;
		task.project_id = project_id;
		const response = await fetch("/api/tasks/create", { body: JSON.stringify(task), method: "POST" });
		const { data, error } = await (response.json() as Promise<{ data: FetchedTask | null; error: string }>);
		if (error) {
			setError(error);
		} else if (data) {
			console.log({ data });
			setTasks([...tasks, data]);
		} else {
			setError("failed to create task");
		}
	}

	async function saveTask(task: LoadedTask) {
		// update local ui first
		task.network_status = { loading: true, error: "" };
		setTasks(tasks.map((t) => (t.id == task.id ? task : t)));
		// update task in database
		const response = await fetch("/api/tasks/update", { body: JSON.stringify(task), method: "POST" });
		const { data, error } = await (response.json() as Promise<{ data: LoadedTask | null; error: string }>);
		if (error) {
			task.network_status = { loading: false, error };
			setError(error);
		} else if (data) {
			// replace task in local ui with received task from db (should be the same)
			data.network_status = { loading: false, error: "" };
			setTasks(tasks.map((t) => (t.id == data.id ? data : t)));
			setTimeout(() => {
				// if there are fast updates, then this will break.
				data.network_status = undefined;
				setTasks(tasks.map((t) => (t.id == data.id ? data : t)));
			}, 2000);
		} else {
			task.network_status = { loading: false, error: "Failed to save task" };
			setError("failed to save task");
		}
	}

	async function deleteTask(task: FetchedTask) {
		const id = task.id;
		task.visibility = TASK_VISIBILITY.DELETED;
		// update local ui first
		setTasks(tasks.map((t) => (t.id == id ? task : t)));
		// delete task with id from database
		const response = await fetch("/api/tasks/delete", { body: JSON.stringify({ id }), method: "POST" });
		const { success, error } = await (response.json() as Promise<{ success: boolean; error: string }>);
		if (error) {
			setError(error);
		} else if (success) {
			// do nothing as the task has already been removed from the local ui
		} else {
			setError("Failed to delete task");
		}
	}

	async function saveGoal() {
		console.log("save goal!");
	}

	async function deleteGoal() {
		if (!goal?.id) {
			setError("Invalid Goal ID: " + goal?.id ?? "null");
			return;
		}
		const response = await fetch("/api/projects/goal/delete", { body: JSON.stringify({ goal_id: goal?.id }), method: "POST" });
		const { success, error } = await (response.json() as Promise<{ success: boolean; error: string }>);
		if (error) {
			setError(error);
		} else if (success) {
			deleteCard?.(goal?.id);
		} else {
			setError("Failed to delete goal");
		}
	}

	if (error) {
		setTimeout(() => setError(""), 5000);
		return (
			<div className="flex w-96 items-center justify-center">
				<ErrorWrapper message={error} />
			</div>
		);
	}

	return (
		<>
			<div className="fixed z-50">
				<GenericModal
					open={editingTask != null}
					setOpen={(open) => {
						if (!open) setEditingTask(null);
					}}
				>
					{editingTask && <TaskEditor task={editingTask} tags={tags} close={() => setEditingTask(null)} saveTask={saveTask} deleteTask={deleteTask} />}
				</GenericModal>
			</div>
			<div className="styled-input relative w-96 rounded-md border-1 border-borders-secondary bg-base-accent-primary pb-2">
				{isEditing == false && goal ? (
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-2 border-b-1 border-borders-secondary p-2">
							<div className="text-2xl font-semibold text-base-text-subtlish">{goal?.name}</div>
							<div className="text-base text-base-text-subtle">{moment(goal?.target_time).calendar()}</div>
							<div className="text-sm text-base-text-subtle">{goal?.description ?? "null"}</div>
						</div>
						<div className="flex items-center justify-center gap-2">
							<button className="flex flex-row gap-2 rounded-md border-1 border-borders-secondary py-1 px-4 hover:bg-base-accent-secondary" onClick={() => setShowTasks(!showTasks)}>
								{showTasks ? <ChevronUp /> : <ChevronDown />}
								Show Tasks
							</button>
							<PrimaryButton onClick={() => setIsEditing(!isEditing)}>
								<Pencil className="w-4" />
							</PrimaryButton>
						</div>
					</div>
				) : (
					// this is the add goal card
					<div className="flex flex-col gap-2 p-2 pb-0">
						<input
							type="text"
							placeholder="Name"
							className="w-full rounded-md border-1 border-borders-secondary bg-base-accent-secondary py-1 px-2 text-base-text-secondary placeholder-base-text-dark"
							onChange={(e) => setEditingGoal({ ...editingGoal, name: e.target.value })}
							defaultValue={editingGoal.name}
						/>
						<input
							type="text"
							placeholder="Description"
							className="w-full rounded-md border-1 border-borders-secondary bg-base-accent-secondary py-1 px-2 text-base-text-subtlish placeholder-base-text-dark"
							onChange={(e) => setEditingGoal({ ...editingGoal, description: e.target.value })}
							defaultValue={editingGoal.description}
						/>
						<div className="flex flex-row items-center gap-2">
							<div className="min-w-max text-base-text-subtle">Target Date</div>
							<input
								type="datetime-local"
								placeholder="Due Date"
								className="w-full rounded-md border-1 border-borders-secondary bg-base-accent-secondary py-1 px-2 text-base-text-secondary placeholder-base-text-dark"
								onChange={(e) => setEditingGoal({ ...editingGoal, target_time: new Date(e.target.value) })}
								defaultValue={dateToDateTime(editingGoal.target_time) ?? undefined}
							/>
						</div>
						<div className="flex h-full w-full items-center justify-center gap-2 py-1">
							<GenericButton
								title="Cancel"
								style="flex justify-center font-semibold"
								onClick={() => {
									if (cancel) cancel();
									setIsEditing(false);
									setEditingGoal({
										name: goal?.name ?? "",
										description: goal?.description ?? "",
										target_time: goal?.target_time ? new Date(goal?.target_time) : new Date()
									});
								}}
							>
								<X className="w-4" />
							</GenericButton>
							<PrimaryButton
								onClick={() => {
									isEditing ? saveGoal() : createGoal();
								}}
								title={isEditing ? "Save" : "Create"}
								style="font-semibold"
							>
								{isEditing ? <Save className="w-4" /> : "Create"}
							</PrimaryButton>
							<div className="relative">{isEditing && <DeleteGoalButton deleteGoal={deleteGoal} />}</div>
						</div>
					</div>
				)}
				{showTasks && (
					<div className="absolute top-[105%] flex w-full flex-col gap-2">
						{tasks
							?.filter((task) => task.visibility != TASK_VISIBILITY.ARCHIVED && task.visibility != TASK_VISIBILITY.DELETED)
							?.map((task, index) => (
								<TaskCard
									task={task}
									layout={TODO_LAYOUT.GRID}
									onEdit={() => {
										setEditingTask(task);
									}}
									setItemStatus={() => {}}
									key={index}
								/>
							))}
						<TodoCreator onCreate={createTask} />
					</div>
				)}
			</div>
		</>
	);
}

function DeleteGoalButton({ deleteGoal }: { deleteGoal: () => void }) {
	const [isDeleting, setIsDeleting] = useState(false);
	return (
		<>
			<DeleteButton
				title="Delete"
				style="flex justify-center"
				onClick={() => {
					setIsDeleting(!isDeleting);
				}}
			>
				<Trash className="w-4" />
			</DeleteButton>
			{isDeleting && (
				<div className="absolute top-[120%] -right-[75%] flex flex-col gap-2 rounded-md border-1 border-borders-secondary bg-base-accent-primary p-2">
					<div className="flex flex-row items-center gap-2">
						<div className="min-w-max text-base-text-subtle">Are you sure?</div>
					</div>
					<div className="flex h-full w-full items-center justify-center gap-2 py-1">
						<button
							title="Cancel"
							className="flex justify-center rounded-md border-1 border-borders-secondary px-4 py-1 font-semibold hover:bg-base-accent-secondary"
							onClick={() => {
								setIsDeleting(false);
							}}
						>
							<X className="w-4" />
						</button>
						<button
							title="Delete"
							className="flex justify-center rounded-md border-1 border-red-400 px-4 py-1 font-semibold text-red-400 transition-all duration-500 hover:border-red-300 hover:bg-red-400 hover:text-red-100"
							onClick={() => {
								deleteGoal();
								setIsDeleting(false);
							}}
						>
							<Trash className="w-4" />
						</button>
					</div>
				</div>
			)}
		</>
	);
}
