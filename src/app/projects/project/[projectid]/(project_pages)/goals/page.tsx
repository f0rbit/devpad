import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import GoalAdder from "@/components/Projects/GoalAdder";
import GoalCard from "@/components/Projects/GoalCard";
import GoalRenderer from "@/components/Projects/GoalRenderer";
import { getProjectGoals } from "@/server/api/projects";
import { getUserTags } from "@/server/api/tags";
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
	const { data: project_data, error: project_error } = await getProjectGoals(projectid, session);
	const { data: tags_data, error: tags_error } = await getUserTags(session);

	const error = project_error ?? tags_error;

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-max p-4">
			<GoalRenderer goals={project_data} project_id={projectid} tags={tags_data} />
		</div>
	);
}
