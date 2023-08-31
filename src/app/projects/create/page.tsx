import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import ProjectCreator from "@/components/Projects/ProjectCreator";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProjects } from "@/server/api/projects";

export default async function CreateProjectPage() {
	const { data, error} = await getUserProjects({ includeDeleted: true });

	if (error?.length > 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={error} />
			</div>
		);
	}

	return (
		<CenteredContainer>
			<TitleInjector title="Create Project" />
			<div className="flex w-full flex-col justify-center gap-2 pt-8 text-center text-base-text-secondary">
				<ProjectCreator projects={data} data-superjson mode="create" />
			</div>
		</CenteredContainer>
	);
}
