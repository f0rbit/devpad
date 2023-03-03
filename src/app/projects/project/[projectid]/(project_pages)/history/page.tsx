import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import HistoryAction from "@/components/common/history/HistoryAction";
import { getProjectHistory } from "@/server/api/projects";
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
			<div className="relative border-l-4 border-borders-secondary">
				{data.map((action, index) => (
					<HistoryAction key={index} action={action} drawIcon={true} className={"pl-6"} />
				))}
			</div>
		</div>
	);
}
