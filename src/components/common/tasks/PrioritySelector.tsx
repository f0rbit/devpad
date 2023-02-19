import { TaskPriority } from "@/types/page-link";

export default function PrioritySelector({ select, selected }: { select: (priority: TaskPriority | string) => void; selected?: TaskPriority }) {
	const selectable = Object.values(TaskPriority);
	return (
		<div className="flex flex-row items-center justify-center gap-2 w-full">
			{selectable.map((priority, index) => (
				<button
					className={"flex w-full items-center justify-center rounded-md border-1 border-borders-primary px-4 py-1 " + (selected == priority ? "border-borders-secondary bg-base-accent-secondary" : "")}
					onClick={() => select(priority)}
					key={index}
				>
					<span className="capitalize">{priority.toLowerCase()}</span>
				</button>
			))}
		</div>
	);
}