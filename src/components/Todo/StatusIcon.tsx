import { TASK_PROGRESS } from "@prisma/client";
import { CheckSquare, MoreHorizontal, Square } from "lucide-react";

function StatusIcon({ status }: { status: TASK_PROGRESS }) {
	switch (status) {
		case TASK_PROGRESS.COMPLETED:
			return <CheckSquare className="w-5" />;
		case TASK_PROGRESS.IN_PROGRESS:
			return (
				<div className="relative w-5">
					<Square className="relative w-full" />
					<MoreHorizontal className="absolute top-0 w-5 scale-75" />
				</div>
			);
		case TASK_PROGRESS.UNSTARTED:
			return <Square className="w-5" />;
	}
};

export function TaskStatus ({ status }: { status: TASK_PROGRESS}) {
	return <div className={getStatusColour(status) + " fill-current"}>
		<StatusIcon status={status} />
	</div>
}


function getStatusColour(status: TASK_PROGRESS) {
	switch (status) {
		case TASK_PROGRESS.COMPLETED:
			return "text-green-300";
		case TASK_PROGRESS.IN_PROGRESS:
			return "text-pad-purple-500";
		case TASK_PROGRESS.UNSTARTED:
			return "text-base-text-subtle";
	}
}