"use client";
import { ProjectGoal } from "@prisma/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import GoalCard from "@/components/Projects/GoalCard";
import { FetchedGoal } from "@/types/page-link";

export default function GoalAdder({ project_id, addGoal }: { project_id: string; addGoal: (goal: FetchedGoal) => void }) {
	const [isEditing, setIsEditing] = useState(false);

	if (isEditing) {
		return (
			<GoalCard
				goal={null}
				project_id={project_id}
				cancel={() => setIsEditing(false)}
				create={(goal) => {
					setIsEditing(false);
					addGoal(goal);
				}}
				tags={[]}
				updateCard={() => {}}
				finishProject={() => {}}
			/>
		);
	} else {
		return (
			<button className="flex min-h-[10rem] w-96 items-center justify-center rounded-md border-1 border-borders-secondary text-base-text-dark" onClick={() => setIsEditing(true)}>
				<Plus />
			</button>
		);
	}
}
