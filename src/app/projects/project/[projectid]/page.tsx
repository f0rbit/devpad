import ErrorWrapper from "@/components/ErrorWrapper";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProject } from "src/utils/prisma/projects";
import { getCurrentUser } from "src/utils/session";

export default async function Page({ params }: { params: { projectid: string } }) {
	const { projectid } = params;

	const user = await getCurrentUser();

	if (!user)
		return (
			<div className="flex items-center justify-center">
				<ErrorWrapper message="Obtaining Auth..." />
			</div>
		);

	const project = await getUserProject(user.id, projectid);

	if (!project) {
		return (
			<div className="flex items-center justify-center">
				<ErrorWrapper message="Project Not Found!" />
			</div>
		);
	}

	return (
		<div className="w-full h-full pt-4">
			<TitleInjector title={project.name} />
			<div className="w-96">
				<ProjectCard project={project} />
			</div>
		</div>
	);
}
