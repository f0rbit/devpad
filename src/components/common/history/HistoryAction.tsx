import { Action, ACTION_TYPE } from "@prisma/client";
import { AlertCircle, Briefcase, CheckSquare, Flag } from "lucide-react";
import moment from "moment";

export default function HistoryAction({ action, drawIcon, className }: { action: Action; drawIcon: boolean; className?: string }) {
	const { icon, color } = getIcon(action.type);
	return (
		<>
			{drawIcon && (
				<div className="absolute -left-[26px] -mt-0.5 flex origin-top scale-75 items-center justify-center rounded-full bg-base-bg-primary p-1">
					<div className={" rounded-full px-2 py-1 " + color}>{icon}</div>
				</div>
			)}
			<div className={className}>
				<div className="text-lg font-semibold text-base-text-primary">{action.description}</div>
				<div className="text-base-text-subtle">{moment(action.created_at).calendar({ sameElse: "DD/MM/yyyy" })}</div>
			</div>
		</>
	);
}

function getIcon(type: ACTION_TYPE) {
	const width = "w-6";
	const create = "text-green-200";
	const remove = "text-red-300";
	switch (type) {
		case ACTION_TYPE.CREATE_GOAL:
			return { icon: <Flag className={width} />, color: create };
		case ACTION_TYPE.UPDATE_GOAL:
			return { icon: <Flag className={width} />, color: "" };
		case ACTION_TYPE.DELETE_GOAL:
			return { icon: <Flag className={width} />, color: remove };
		case ACTION_TYPE.CREATE_TASK:
			return { icon: <CheckSquare className={width} />, color: create };
		case ACTION_TYPE.UPDATE_TASK:
			return { icon: <CheckSquare className={width} />, color: "" };
		case ACTION_TYPE.DELETE_TASK:
			return { icon: <CheckSquare className={width} />, color: remove };
		case ACTION_TYPE.CREATE_PROJECT:
			return { icon: <Briefcase className={width} />, color: create };
		case ACTION_TYPE.UPDATE_PROJECT:
			return { icon: <Briefcase className={width} />, color: "" };
		case ACTION_TYPE.DELETE_PROJECT:
			return { icon: <Briefcase className={width} />, color: remove };
		default:
			return { icon: <AlertCircle className={width} />, color: "" };
	}
}
