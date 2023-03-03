import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import GoalRenderer from "@/components/Projects/GoalRenderer";
import { getProject } from "@/server/api/projects";
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
	const { data: project, error: project_error } = await getProject(projectid, session);
	const { data: tags_data, error: tags_error } = await getUserTags(session);

	const error = project_error ?? tags_error;

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	if (!project) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={"Error fetching project"} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-max p-4">
			<GoalRenderer project={project} tags={tags_data} />
		</div>
	);
}
