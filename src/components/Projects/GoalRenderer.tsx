"use client"
import { ProjectGoal } from "@prisma/client";
import { useState } from "react";
import GoalAdder from "./GoalAdder";
import GoalCard from "./GoalCard";

export default function GoalRenderer({ goals: initial_goals, project_id }: { goals: ProjectGoal[]; project_id: string }) {
    const [goals, setGoals] = useState(initial_goals)

    function addGoal(goal: ProjectGoal) {
        setGoals([...goals, goal]);
    }

	function deleteGoal(id: string) {
		setGoals(goals.filter(goal => goal.id !== id));
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
