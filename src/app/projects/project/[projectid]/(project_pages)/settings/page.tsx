import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import ProjectCreator from "@/components/Projects/ProjectCreator";
import { getProject } from "@/server/api/projects";
import { getUserTags } from "@/server/api/tags";
import { Newspaper } from "lucide-react";
import { getSession } from "src/utils/session";

export default async function RoadmapPage({ params }: { params: { projectid: string }}) {
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
		<CenteredContainer>
            <div className="flex w-full flex-col justify-center gap-2 pt-8 text-center text-base-text-secondary">
				<ProjectCreator projects={[ project ]} data-superjson mode="edit" />
			</div>
		</CenteredContainer>
	);
}
