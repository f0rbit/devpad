import type { Project } from "../../server/projects";
import type { Task } from "../../server/tasks";

import { CalendarClock } from "lucide-solid";

interface Props {
	task: Task;
	project: Project;
	from: string;
}

export const TaskCard = (props: Props) => {
	const { task: fetched_task, project, from } = props;
	const { task } = fetched_task;

	if (!task) {
		return <div>Task not found</div>;
	}

	const project_name = project?.name || "No project";
	const priority_class = `priority-${task.priority?.toLowerCase() ?? "low"}`;

	console.log(task);

	return (
		<div>
			<div style={{"font-size": "small"}}>
				<span class='date-highlighted'><FormattedDate date={task.updated_at} /></span>
				{" - "}
				<span>{project_name}</span>
			</div>
			<a href={`/todo/${task.id}?from=${from}`}>{task.title}</a>
			<p>{task.summary}</p>
			<div class={`flex-row ${priority_class}`} style={{"font-size": "small"}}>
				<span class="flex-row"><CalendarClock /><DueDate date={task.end_time} /></span>
			</div>
		</div>
	);
};


const FormattedDate = ({ date }: { date: string | null }) => {
	if (!date) return <span>No date</span>;
	// format like November 1, 2024
	// use Intl.DateTimeFormat to format date
	// return as <span class='date'>November 1</span><span class='year'>, 2024</span>
	const options = { month: "long", day: "numeric" } as const;

	return (
		<>
			<span class="date">{new Intl.DateTimeFormat("en-US", options).format(new Date(date))}</span>
			<span class="year">, {new Date(date).getFullYear()}</span>
		</>
	);
}

const DueDate = ({ date }: { date: string | null }) => {
	// if no date, return <span>No due date</span>
	// otherwise, if within 1 hour say "x minutes"
	// if within 2 days say "x hours"
	// if within 2 weeks say "x days"
	// otherwise say "November 1, 2024"
	// use Intl.DateTimeFormat to format date
	if (!date) return <span>No due date</span>;
	const now = new Date();
	const due = new Date(date);

	const diff = due.getTime() - now.getTime();
	const diffSeconds = diff / 1000;
	const diffMinutes = diffSeconds / 60;
	const diffHours = diffMinutes / 60;
	const diffDays = diffHours / 24;

	if (diffMinutes < 60) return <span>{Math.round(diffMinutes)} minutes</span>;
	if (diffHours < 48) return <span>{Math.round(diffHours)} hours</span>;
	if (diffDays < 14) return <span>{Math.round(diffDays)} days</span>;

	const options = { month: "long", day: "numeric" } as const;
	return (
		<>
			<span>{new Intl.DateTimeFormat("en-US", options).format(due)}</span>
			<span>, {due.getFullYear()}</span>
		</>
	);
}

