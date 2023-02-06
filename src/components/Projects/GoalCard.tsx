"use client";
import { ProjectGoal } from "@prisma/client";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { dateToDateAndTime, dateToDateTime } from "src/utils/dates";
import CenteredContainer from "../CenteredContainer";
import ErrorWrapper from "../ErrorWrapper";

export default function GoalCard({ goal, project_id }: { goal: ProjectGoal | null; project_id: string }) {
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
			// window.location.href = `/project/${project_id}`;
			location?.reload();
		} else {
			setError("Failed to create project");
		}
	}

	async function saveGoal() {
		console.log("save goal!");
	}

	if (error) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="w-96 rounded-md border-1 border-borders-secondary bg-base-accent-primary">
			{isEditing == false && goal ? (
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-2 border-b-1 border-borders-secondary p-2">
						<div className="text-2xl font-semibold text-base-text-subtlish">{goal?.name}</div>
						<div className="text-base text-base-text-subtle">{goal?.target_time ? dateToDateAndTime(new Date(goal?.target_time)).replace(" ", " @ ") : ""}</div>
						<div className="text-sm text-base-text-subtle">{goal?.description ?? "null"}</div>
					</div>
					<div className="flex items-center justify-center gap-2">
						<button className="flex flex-row gap-2 rounded-md border-1 border-borders-secondary py-1 px-4 hover:bg-base-accent-secondary" onClick={() => setShowTasks(!showTasks)}>
							{showTasks ? <ChevronUp /> : <ChevronDown />}
							Show Tasks
						</button>
						<button className="w-24 rounded-md bg-accent-btn-primary px-4 py-1 font-semibold hover:bg-accent-btn-primary-hover" onClick={() => setIsEditing(!isEditing)}>
							Edit
						</button>
					</div>
				</div>
			) : (
				// this is the add goal card
				<div className="flex flex-col gap-2 p-2">
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
							onChange={(e) => setEditingGoal({ ...editingGoal, target_time: e.target.valueAsDate ?? new Date() })}
							defaultValue={dateToDateTime(editingGoal.target_time)}
						/>
					</div>
					<div className="flex h-full w-full items-center justify-center gap-2 py-1">
						{isEditing && (
							<button
								className="w-24 rounded-md bg-base-accent-secondary px-4 py-1 font-semibold hover:bg-base-accent-tertiary border-1 border-borders-secondary"
								onClick={() => {
									setIsEditing(false);
									setEditingGoal({
										name: goal?.name ?? "",
										description: goal?.description ?? "",
										target_time: goal?.target_time ? new Date(goal?.target_time) : new Date()
									});
								}}
							>
								Cancel
							</button>
						)}
						<button
							className="w-24 rounded-md bg-accent-btn-primary px-4 py-1 font-semibold hover:bg-accent-btn-primary-hover"
							onClick={() => {
								if (isEditing) {
									saveGoal();
								} else {
									createGoal();
								}
							}}
						>
							{isEditing ? "Save" : "Create"}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
