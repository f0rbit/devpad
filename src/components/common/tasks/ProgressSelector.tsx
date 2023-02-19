import { TaskStatus } from "@/components/Todo/StatusIcon";
import { TASK_PROGRESS } from "@prisma/client";

export default function ProgressSelector({ select, selected }: { select: (progress: TASK_PROGRESS) => void; selected?: TASK_PROGRESS }) {
	const selectable = Object.values(TASK_PROGRESS);
	return (
		<div className="flex flex-row items-center justify-center gap-2">
			{selectable.map((progress, index) => (
				<button
					className={"flex w-full items-center justify-center rounded-md border-1 border-borders-primary px-4 py-1 " + (selected == progress ? "border-borders-secondary bg-base-accent-secondary" : "")}
					onClick={() => select(progress)}
					key={index}
					title={progress}
				>
					<TaskStatus status={progress} />
				</button>
			))}
		</div>
	);
}
