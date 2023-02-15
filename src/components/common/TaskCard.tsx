import { FetchedTask, getModuleData, Module } from "@/types/page-link";
import { EndTime, SummaryText, TodoStatus } from "../Todo/TodoCard";

export default function TaskCard({ task }: { task: FetchedTask }) {
	return (
		<div className="rounded-md border-1 border-borders-primary p-2 text-base-text-subtle">
			<div className="inline-flex items-center gap-2 align-middle">
				<TodoStatus status={task.progress} id={task.id} />
				<h1 className="text-xl text-base-text-secondary font-bold">{task.title}</h1>
			</div>
			<EndTime endTime={getModuleData(task, Module.END_DATE)} />
			<SummaryText module={getModuleData(task, Module.SUMMARY)} />
		</div>
	);
}
