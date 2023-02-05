import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import ProjectCreator from "@/components/Projects/ProjectCreator";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProjects } from "src/utils/prisma/projects";

export default async function HomePage() {
	const { data, error} = await getUserProjects();

	if (error?.length > 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={error} />
			</div>
		);
	}

	// async function createProject(project: CreateProjectType) {
	// 	const owner_id = (await getCurrentUser())?.id;
	// 	if (!owner_id) return null;
	// 	return (await prisma?.project.create({
	// 		data: {
	// 			...project,
	// 			owner_id: owner_id,

	// 		}
	// 	}))?.project_id ?? null;
	// }

	return (
		<CenteredContainer>
			<TitleInjector title="Create Project" />
			<div className="flex w-full flex-col justify-center gap-2 pt-8 text-center text-base-text-secondary">
				<ProjectCreator projects={data} data-superjson />
			</div>
		</CenteredContainer>
	);
}
