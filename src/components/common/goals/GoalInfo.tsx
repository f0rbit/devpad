import { FetchedGoal } from "@/types/page-link";
import { Check } from "lucide-react";
import moment from "moment";
import VersionIndicator from "../VersionIndicator";

function GoalTime({ goal }: { goal: FetchedGoal }) {
	const finished = goal.finished_at != null;
	if (finished) {
		return (
			<div className="flex flex-row items-center gap-1">
				<Check className="mt-0.5 w-4 text-green-300" />
				<div className="text-base text-base-text-subtle">{moment(goal?.finished_at).calendar({ sameElse: "DD/MM/yyyy" })}</div>
			</div>
		);
	}
	return <div className="text-base text-base-text-subtle">{moment(goal?.target_time).calendar({ sameElse: "DD/MM/yyyy" })}</div>;
}

export default function GoalInfo({ goal }: { goal: FetchedGoal }) {
	return (
		<div className="flex h-full flex-col gap-2 p-2">
			<div className="flex flex-row items-center gap-2">
				<div className="text-2xl font-semibold text-base-text-subtlish">{goal?.name}</div>
				{goal.target_version && <VersionIndicator version={goal.target_version} />}
			</div>
			<GoalTime goal={goal} />
			<div className="text-sm text-base-text-subtle">{goal?.description ?? "null"}</div>
		</div>
	);
}
