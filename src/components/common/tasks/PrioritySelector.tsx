import { TaskPriority } from "@/types/page-link";

export default function PrioritySelector({ select, selected }: { select: (priority: TaskPriority | string) => void; selected?: TaskPriority }) {
	const selectable = Object.values(TaskPriority);
	return (
		<div className="flex w-full flex-row items-center justify-center gap-2">
			{selectable.map((priority, index) => (
				<button
					className={
						"flex w-full items-center justify-center rounded-md border-1 border-gray-300 bg-gray-100 px-4 py-1 dark:border-borders-primary dark:bg-transparent " +
						(selected == priority ? "bg-white dark:border-borders-secondary dark:bg-base-accent-secondary" : "")
					}
					onClick={() => select(priority)}
					key={index}
				>
					<span className="capitalize">{priority.toLowerCase()}</span>
				</button>
			))}
		</div>
	);
}
