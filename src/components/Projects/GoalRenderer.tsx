"use client";
import { ProjectGoal, TaskTags } from "@prisma/client";
import { useState } from "react";
import GoalAdder from "./GoalAdder";
import GoalCard from "@/components/Projects/GoalCard";
import { FetchedGoal } from "@/types/page-link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import GenericButton from "../common/GenericButton";

export default function GoalRenderer({ goals: initial_goals, project_id, tags }: { goals: FetchedGoal[]; project_id: string, tags: TaskTags[] }) {
	const [goals, setGoals] = useState(initial_goals);
	const [showPrevious, setShowPrevious] = useState(false);
	
	function addGoal(goal: FetchedGoal) {
		setGoals([...goals, goal]);
	}

	function deleteGoal(id: string) {
		setGoals(goals.filter((goal) => goal.id !== id));
	}

	const previous_goals = goals.filter((a) => a.finished_at != null);
	// sort previous goals by finished time
	// @ts-ignore - ignore the date to string conversion error
	previous_goals.sort((a, b) => new Date(b.finished_at).valueOf() - new Date(a.finished_at).valueOf());

	const future_goals = goals.filter((a) => a.finished_at == null);


	// sort goals by target time
	const sorted_goals = future_goals.sort((a, b) => new Date(a.target_time).valueOf() -  new Date(b.target_time).valueOf());

	return (
		<div className="flex h-max flex-row gap-2">
			{showPrevious && previous_goals.map((goal, index) => <GoalCard key={index} goal={goal} project_id={project_id} deleteCard={deleteGoal} tags={tags} />)}
			{previous_goals.length > 0 && (
				<GenericButton
					onClick={() => setShowPrevious(!showPrevious)}
					title={showPrevious ? "Hide finished goals" : "Show finished goals"}
				>
					<ChevronLeft className="text-base-text-dark"/>
				</GenericButton>
			)}

			{sorted_goals.map((goal, index) => (
				<GoalCard key={index} goal={goal} project_id={project_id} deleteCard={deleteGoal} tags={tags} />
			))}
			<GoalAdder project_id={project_id} addGoal={addGoal} />
		</div>
	);
}
