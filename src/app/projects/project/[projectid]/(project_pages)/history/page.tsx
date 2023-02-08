import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { getProjectHistory } from "@/server/api/projects";
import { Action, ACTION_TYPE } from "@prisma/client";
import { Flag, Unlink } from "lucide-react";
import moment from "moment";
import { getSession } from "src/utils/session";

export default async function HistoryPage({ params }: { params: { projectid: string } }) {
	const { projectid } = params;
	const session = await getSession();
	if (!session)
		return (
			<CenteredContainer>
				<ErrorWrapper message={"You must be signed in!"} />
			</CenteredContainer>
		);
	const { data, error } = await getProjectHistory(projectid, session);

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-full justify-center pt-4">
			<HistoryRenderer data={data} />
		</div>
	);
}

const HistoryRenderer = ({ data }: { data: Action[] }) => {
	return (
		<div className="relative border-l-4 border-borders-secondary">
			{data.map((action, index) => {
				const { icon, color } = getIcon(action.type);
				return (
					<>
						<div className="absolute -left-[22px] -mt-0.5 flex origin-top scale-75 items-center justify-center rounded-full bg-base-bg-primary p-1">
							<div className={" rounded-full px-2 py-1 " + color}>
								{icon}
							</div>
						</div>
						<div className="pl-6">
							<div>
								<div className="text-lg font-semibold text-base-text-primary">{action.description}</div>
								<div className="text-base-text-subtle">{moment(action.created_at).calendar()}</div>
							</div>
						</div>
					</>
				);
			})}
		</div>
	);
};

function getIcon(type: ACTION_TYPE) {
	switch (type) {
		case ACTION_TYPE.CREATE_GOAL:
			return { icon: <Flag className="w-4" />, color: "bg-green-200 text-green-600" };
		case ACTION_TYPE.UPDATE_GOAL:
			return { icon: <Flag className="w-4" />, color: "bg-base-bg-primary" };
		case ACTION_TYPE.DELETE_GOAL:
			return { icon: <Flag className="w-4" />, color: "bg-red-300" };
		default:
			return { icon: <Unlink />, color: "bg-base-bg-primary" };
	}
}
