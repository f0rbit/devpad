"use client";
import { TaskTags } from "@prisma/client";
import { useState } from "react";
import GoalAdder from "./GoalAdder";
import GoalCard from "@/components/Projects/GoalCard";
import { FetchedGoal, FetchedProject } from "@/types/page-link";
import { ChevronLeft } from "lucide-react";
import GenericButton from "../common/GenericButton";
import { UpdateProject } from "@/server/api/projects";

export default function GoalRenderer({ project: initial_project, tags }: { project: FetchedProject; tags: TaskTags[] }) {
	const [project, setProject] = useState(initial_project);
	const [showPrevious, setShowPrevious] = useState(false);

	function addGoal(goal: FetchedGoal) {
		setProject((project) => ({ ...project, goals: [...project.goals, goal] }));
	}

	function updateGoal(goal: FetchedGoal) {
		// setGoals(goals.map((a) => (a.id === goal.id ? goal : a)));
		setProject((project) => ({ ...project, goals: project.goals.map((a) => (a.id === goal.id ? goal : a)) }));
	}

	async function finishProject(version: string) {
		// update the current projects version
		const update_project: UpdateProject = {
			project_id: project.project_id,
			current_version: version,
			deleted: project.deleted,
			description: project.description,
			icon_url: project.icon_url,
			link_text: project.link_text,
			link_url: project.link_url,
			name: project.name,
			repo_url: project.repo_url,
			status: project.status
		};
		// do some kind of fetch request
		const response = await fetch("/api/projects/update", { method: "POST", body: JSON.stringify(update_project) });
		const { data, error } = await (response.json() as Promise<{ data: FetchedProject | null; error: string | null }>);
		if (error || !data) {
			console.error(error ?? "No data returned from server");
			return;
		} else {
			setProject(data);
		}
	}

	const active_goals = project.goals.filter((goal) => goal.deleted == false);

	const previous_goals = active_goals.filter((a) => a.finished_at != null) as (FetchedGoal & { finished_at: string })[];
	previous_goals.sort((a, b) => new Date(b.finished_at).valueOf() - new Date(a.finished_at).valueOf());

	const future_goals = active_goals.filter((a) => a.finished_at == null);
	// sort goals by target time
	const sorted_goals = future_goals.sort((a, b) => new Date(a.target_time).valueOf() - new Date(b.target_time).valueOf());

	return (
		<div className="flex h-max flex-row gap-2">
			{showPrevious && previous_goals.map((goal, index) => <GoalCard key={index} goal={goal} project_id={project.project_id} tags={tags} updateCard={updateGoal} finishProject={finishProject} />)}
			{previous_goals.length > 0 && (
				<GenericButton onClick={() => setShowPrevious(!showPrevious)} title={showPrevious ? "Hide finished goals" : "Show finished goals"}>
					<ChevronLeft className="text-base-text-dark" />
				</GenericButton>
			)}

			{sorted_goals.map((goal, index) => (
				<GoalCard key={index} goal={goal} project_id={project.project_id} tags={tags} updateCard={updateGoal} finishProject={finishProject} />
			))}
			<GoalAdder project_id={project.project_id} addGoal={addGoal} />
		</div>
	);
}
