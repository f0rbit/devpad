"use client";
import { ProjectGoal } from "@prisma/client";
import { ChevronDown, ChevronUp, Pencil, Save, Trash, X } from "lucide-react";
import moment from "moment";
import { useState } from "react";
import { dateToDateTime } from "src/utils/dates";
import ErrorWrapper from "@/components/common/ErrorWrapper";

export default function GoalCard({ goal, project_id, cancel, create, deleteCard }: { goal: ProjectGoal | null; project_id: string; cancel?: () => void; create?: (goal: ProjectGoal) => void, deleteCard?: (id: string) => void }) {
	const [isEditing, setIsEditing] = useState(false);
	const [showTasks, setShowTasks] = useState(false);
	const [editingGoal, setEditingGoal] = useState({
		name: goal?.name ?? "",
		description: goal?.description ?? "",
		target_time: goal?.target_time ? new Date(goal?.target_time) : new Date()
	});
	const [error, setError] = useState("");

	async function createGoal() {
		const goal = {
			name: editingGoal.name,
			description: editingGoal.description,
			target_time: editingGoal.target_time.toISOString(),
			project_id
		};

		const response = await fetch("/api/projects/goal/create", { body: JSON.stringify(goal), method: "POST" });
		const { data, error } = await (response.json() as Promise<{ data: ProjectGoal | null; error: string }>);
		if (error) {
			setError(error);
		} else if (data) {
			create?.(data);
		} else {
			setError("Failed to create project");
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
		const { success, error } = await (response.json() as Promise<{ success: boolean, error: string }>);
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
		<div className="w-96 rounded-md border-1 border-borders-secondary bg-base-accent-primary pb-2">
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
						<button className="flex justify-center rounded-md bg-accent-btn-primary px-4 py-1 font-semibold hover:bg-accent-btn-primary-hover" onClick={() => setIsEditing(!isEditing)}>
							<Pencil className="w-4" />
						</button>
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
							onChange={(e) => setEditingGoal({ ...editingGoal, target_time: new Date(e.target.value)})}
							defaultValue={dateToDateTime(editingGoal.target_time)}
						/>
					</div>
					<div className="flex h-full w-full items-center justify-center gap-2 py-1">
						<button
							title="Cancel"
							className="flex justify-center rounded-md border-1 border-borders-secondary px-4 py-1 font-semibold hover:bg-base-accent-secondary"
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
						</button>
						<button
							title={isEditing ? "Save" : "Create"}
							className="flex justify-center rounded-md bg-accent-btn-primary px-4 py-1 font-semibold hover:bg-accent-btn-primary-hover"
							onClick={() => {
								if (isEditing) {
									saveGoal();
								} else {
									createGoal();
								}
							}}
						>
							{isEditing ? <Save className="w-4" /> : "Create"}
						</button>
						<div className="relative">{isEditing && <DeleteGoalButton deleteGoal={deleteGoal} />}</div>
					</div>
				</div>
			)}
		</div>
	);
}

function DeleteGoalButton({ deleteGoal }: { deleteGoal: () => void }) {
	const [isDeleting, setIsDeleting] = useState(false);
	return (
		<>
			<button
				title="Delete"
				className="flex justify-center rounded-md border-1 border-red-400 px-4 py-1 font-semibold text-red-400 transition-all duration-500 hover:border-red-300 hover:bg-red-400 hover:text-red-100"
				onClick={() => {
					setIsDeleting(!isDeleting);
				}}
			>
				<Trash className="w-4" />
			</button>
			{isDeleting && (
			<div className="absolute top-[120%] -right-[75%] flex flex-col gap-2 p-2 bg-base-accent-primary border-borders-secondary border-1 rounded-md">
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
