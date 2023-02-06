import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import GoalAdder from "@/components/Projects/GoalAdder";
import GoalCard from "@/components/Projects/GoalCard";
import GoalRenderer from "@/components/Projects/GoalRenderer";
import { getProjectGoals } from "@/server/api/projects";
import { getSession } from "src/utils/session";

export default async function GoalsPage({ params }: { params: { projectid: string } }) {
	const { projectid } = params;
	const session = await getSession();
	if (!session)
		return (
			<CenteredContainer>
				<ErrorWrapper message={"You must be signed in!"} />
			</CenteredContainer>
		);
	const { data, error } = await getProjectGoals(projectid, session);

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-max p-4">
			<GoalRenderer goals={data} project_id={projectid} />
		</div>
	);
}
