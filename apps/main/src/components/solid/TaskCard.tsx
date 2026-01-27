import type { Project, TaskWithDetails, UpsertTag } from "@devpad/schema";
import Calendar from "lucide-solid/icons/calendar";
import CalendarClock from "lucide-solid/icons/calendar-clock";
import CalendarX2 from "lucide-solid/icons/calendar-x-2";
import Circle from "lucide-solid/icons/circle";
import CircleCheck from "lucide-solid/icons/circle-check";
import CircleDot from "lucide-solid/icons/circle-dot";
import Link from "lucide-solid/icons/link";
import Target from "lucide-solid/icons/target";
import Square from "lucide-solid/icons/square";
import SquareCheck from "lucide-solid/icons/square-check";
import SquareDot from "lucide-solid/icons/square-dot";
import { For, createSignal, onMount } from "solid-js";
import { getApiClient } from "@/utils/api-client";
import { TagBadge } from "@/components/solid/TagEditor";
import { advanceTaskProgress, formatDueDate, getPriorityClass, getProgressIconType, isPastDue, isProgressClickable } from "@/utils/task-status";

interface Props {
	task: TaskWithDetails;
	project: Project | null;
	user_tags: UpsertTag[];
	view?: "list" | "grid";
	class?: string;
	update?: (id: string, updates: any) => void;
	draw_project?: boolean;
}

const GoalInfo = ({ goal_id }: { goal_id: string }) => {
	const [goalName, setGoalName] = createSignal<string | null>(null);

	onMount(async () => {
		try {
			const apiClient = getApiClient();
			const { goal, error } = await apiClient.goals.find(goal_id);
			if (!error && goal) {
				setGoalName(goal.name);
			}
		} catch (error) {
			console.error("Failed to fetch goal:", error);
		}
	});

	if (!goalName()) return null;

	return (
		<div style="display: flex; align-items: center; gap: 3px;" title={`Goal: ${goalName()}`}>
			<Target size={14} />
			<span style={{ "font-size": "small", color: "var(--text-secondary)" }}>{goalName()}</span>
		</div>
	);
};

export const TaskCard = (props: Props) => {
	const { task: fetched_task, project, user_tags } = props;
	const { task, tags } = fetched_task;

	if (!task) {
		return <div>Task not found</div>;
	}

	const project_name = project?.name ?? null;
	const priority_class = getPriorityClass(task.priority, !!task.end_time);

	const tag_list = tags
		.map(tag_id => {
			return user_tags.find(tag => tag.id === tag_id) ?? null;
		})
		.filter(Boolean) as UpsertTag[];

	const Clock = () => {
		const end_time = task.end_time;
		if (!end_time) return <Calendar />;
		if (isPastDue(end_time)) return <CalendarX2 />;
		return <CalendarClock />;
	};

	const progress = async () => {
		await advanceTaskProgress(task.id, task.owner_id, task.progress, newProgress => props.update?.(task.id, { progress: newProgress }));
	};

	const has_linked = !!fetched_task.codebase_tasks;

	// Only apply card styling in grid view
	const cardClass = props.view === "grid" ? "card" : "";
	const containerClass = cardClass ? `${cardClass} flex-col` : "flex-col";

	return (
		<div class={containerClass} style={{ gap: "3px", height: "100%" }}>
			<div>
				<span class="progress-icon">
					<TaskProgress progress={task.progress} onClick={progress} type="box" />
				</span>
				<span>
					<a href={`/todo/${task.id}`} class="task-title">
						{task.title}
					</a>
				</span>
			</div>
			{task.summary && <p class="task-summary">{task.summary}</p>}
			<div style={{ height: "100%" }} />
			<div class="flex-col" style={{ "font-size": "small", gap: "6px" }}>
				{tag_list.length > 0 && (
					<span class="flex-row">
						<For each={tag_list}>{tag => tag.render && <TagBadge name={() => tag.title} colour={() => tag.color ?? null} />}</For>
					</span>
				)}
				<span class={`flex-row ${priority_class}`}>
					{has_linked && (
						<div style="display: flex;" title="This task is linked to a codebase">
							<Link />
						</div>
					)}
					<Clock />
					<DueDate date={task.end_time} />
					{task.goal_id && <GoalInfo goal_id={task.goal_id} />}
					{project_name && props.draw_project && (
						<a href={`/project/${project_name}/tasks`}>
							<span style={{ "font-size": "small", color: "var(--text-tertiary)" }}>
								{" - "}
								{project_name}
							</span>
						</a>
					)}
				</span>
			</div>
		</div>
	);
};

const DueDate = ({ date }: { date: string | null }) => {
	return <span>{formatDueDate(date)}</span>;
};

export function TaskProgress({ progress, onClick, type }: { progress: TaskWithDetails["task"]["progress"]; onClick: () => void; type: "box" | "circle" }) {
	const iconType = getProgressIconType(progress, type);
	const clickable = isProgressClickable(progress);

	// Map icon types to components
	const IconComponent = (() => {
		switch (iconType) {
			case "Square":
				return Square;
			case "SquareDot":
				return SquareDot;
			case "SquareCheck":
				return SquareCheck;
			case "Circle":
				return Circle;
			case "CircleDot":
				return CircleDot;
			case "CircleCheck":
				return CircleCheck;
			default:
				return Square;
		}
	})();

	if (clickable) {
		return (
			<a role="button" onClick={onClick}>
				<IconComponent />
			</a>
		);
	}

	return (
		<div class="priority-low">
			<IconComponent />
		</div>
	);
}
