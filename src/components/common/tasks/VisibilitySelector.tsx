import VisiblityIcon from "@/components/Todo/VisibilityIcon";
import { TASK_VISIBILITY } from "@prisma/client";

export default function VisibilitySelector({ select, selected }: { select: (visibility: TASK_VISIBILITY) => void; selected?: TASK_VISIBILITY }) {
	const selectable = Object.values(TASK_VISIBILITY).filter((visibility) => visibility != TASK_VISIBILITY.DELETED && visibility != TASK_VISIBILITY.ARCHIVED);
	return (
		<div className="flex flex-row items-center justify-center gap-2">
			{selectable.map((visibility, index) => (
				<button
					className={
						"flex w-full items-center justify-center rounded-md border-1 border-gray-300 bg-gray-100 px-4 py-1 dark:border-borders-primary dark:bg-none " + (selected == visibility ? "bg-white dark:border-borders-secondary dark:bg-base-accent-secondary" : "")
					}
					onClick={() => select(visibility)}
					key={index}
					title={visibility}
				>
					<VisiblityIcon visibility={visibility} />
				</button>
			))}
		</div>
	);
}
