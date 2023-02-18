import { FetchedTask, getModuleData, Module } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS } from "@prisma/client";
import { CalendarClock, Edit2, Newspaper, Tags } from "lucide-react";
import moment from "moment";
import { MouseEventHandler } from "react";
import { hoverLinkClass } from "../HoverLink";
import { TODO_LAYOUT } from "../Todo/ListLayout";
import { TaskStatus } from "../Todo/StatusIcon";
import TodoTag from "../Todo/TodoTag";
import VisiblityIcon from "../Todo/VisibilityIcon";

type TaskCardProps = {
	task: FetchedTask;
	setItemStatus: (status: TASK_PROGRESS) => void;
	onEdit: MouseEventHandler<HTMLButtonElement>;
	layout: TODO_LAYOUT;
};

export default function TaskCard({ task, setItemStatus, onEdit, layout }: TaskCardProps) {
	return (
		<div
			className={
				"group relative w-full rounded-md border-1 border-borders-primary px-4 py-2 transition-colors duration-300 dark:bg-base-bg-primary dark:text-base-text-subtle hover:dark:bg-base-accent-primary " + (layout == TODO_LAYOUT.LIST ? "flex flex-wrap gap-4" : "")
			}
		>
			<div className="inline-flex items-center gap-2 align-middle">
				<TodoStatus status={task.progress} update_progress={setItemStatus} id={task.id} />
				<h1 className="text-2xl font-medium text-base-text-secondary">{task.title}</h1>
			</div>
			<EndTime endTime={getModuleData(task, Module.END_DATE)} />
			<TodoTags tags={task?.tags} />
			<SummaryText module={getModuleData(task, Module.SUMMARY)} />
			<div className={"duration-400 absolute right-2 flex flex-row items-center justify-center gap-2 align-middle text-gray-400 transition-opacity group-hover:opacity-50 md:opacity-0 " + (layout == TODO_LAYOUT.GRID ? "bottom-2" : "bottom-[25%]")}>
				<span title={task.visibility[0]?.toUpperCase() + task.visibility.toLowerCase().substring(1)}>
					<VisiblityIcon visibility={task.visibility} />
				</span>
				<button className={hoverLinkClass} title="Edit" onClick={onEdit}>
					<Edit2 />
				</button>
			</div>
		</div>
	);
}


const EndTime = ({ endTime }: { endTime: { date: Date } }) => {
	if (!endTime || !endTime.date) return <></>;
	const { date: timestamp } = endTime;
	const date = new Date(timestamp);
	return (
		<div className="flex flex-wrap items-center gap-2 align-middle text-sm">
			<CalendarClock className="min-w-5 w-5" />
			<span>{moment(date).calendar()}</span>
		</div>
	);
};

const TodoTags = ({ tags }: { tags: TaskTags[] }) => {
	if (!tags || tags.length <= 0) return <></>;
	return (
		<div className="flex items-center gap-2 align-middle">
			<span>
				<Tags className="w-5" />
			</span>
			<span className="flex flex-wrap gap-1">
				{tags.map((tag, index) => {
					return <TodoTag key={index} tag={tag} />;
				})}
			</span>
		</div>
	);
};

const SummaryText = ({ module }: { module: { summary: string } }) => {
	if (!module || !module.summary) return <></>;
	return (
		<div className="flex items-center gap-2 align-middle">
			<span>
				<Newspaper className="w-5" />
			</span>

			<span className="font-mono text-sm">{module.summary}</span>
		</div>
	);
};

const getNextStatus = (status: TASK_PROGRESS) => {
	switch (status) {
		case "COMPLETED":
			return TASK_PROGRESS.COMPLETED;
		case "UNSTARTED":
			return TASK_PROGRESS.IN_PROGRESS;
		case "IN_PROGRESS":
			return TASK_PROGRESS.COMPLETED;
	}
};

export const TodoStatus = ({ status, update_progress, id }: { status: TASK_PROGRESS; update_progress?: (status: TASK_PROGRESS) => void; id: string }) => {
	const next_status = getNextStatus(status);
	return (
		<button
			onClick={(e) => {
				e.preventDefault();
				update_progress?.(next_status);
			}}
			title={"Change status to " + next_status}
		>
			<TaskStatus status={status} />
		</button>
	);
};