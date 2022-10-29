import { TASK_PROGRESS } from "@prisma/client";
import { CheckSquare, MoreHorizontal, Square } from "lucide-react";

const StatusIcon = ({ status }: { status: TASK_PROGRESS }) => {
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

export default StatusIcon;
