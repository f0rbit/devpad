import { FetchedTask, getModuleData, Module } from "@/types/page-link";
import { TASK_PROGRESS } from "@prisma/client";
import { Edit2 } from "lucide-react";
import { MouseEventHandler } from "react";
import { hoverLinkClass } from "../HoverLink";
import { TODO_LAYOUT } from "../Todo/ListLayout";
import { EndTime, SummaryText, TodoStatus, TodoTags } from "../Todo/TodoCard";
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
