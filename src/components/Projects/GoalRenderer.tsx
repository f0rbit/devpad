"use client";
import { ProjectGoal } from "@prisma/client";
import { useState } from "react";
import GoalAdder from "./GoalAdder";
import GoalCard from "@/components/Projects/GoalCard";
import { FetchedGoal } from "@/types/page-link";

export default function GoalRenderer({ goals: initial_goals, project_id }: { goals: FetchedGoal[]; project_id: string }) {
	const [goals, setGoals] = useState(initial_goals);

	function addGoal(goal: FetchedGoal) {
		setGoals([...goals, goal]);
	}

	function deleteGoal(id: string) {
		setGoals(goals.filter((goal) => goal.id !== id));
	}

	return (
		<div className="flex h-max flex-row gap-2">
			{goals.map((goal, index) => (
				<GoalCard key={index} goal={goal} project_id={project_id} deleteCard={deleteGoal} />
			))}
			<GoalAdder project_id={project_id} addGoal={addGoal} />
		</div>
	);
}
