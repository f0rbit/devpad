import ErrorWrapper from "@/components/ErrorWrapper";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProject } from "src/utils/prisma/projects";
import { getCurrentUser } from "src/utils/session";

export default async function Page({ params }: { params: { projectid: string } }) {
	const { projectid } = params;

	const { data, error } = await getUserProject(projectid);

	if (error?.length > 0) {
		return (
			<div className="flex items-center justify-center">
				<ErrorWrapper message={error} />
			</div>
		);
	}
	const project = data;

	if (!project) {
		return (
			<div className="flex items-center justify-center">
				<ErrorWrapper message="Project not found" />
			</div>
		);
	}
	return (
		<div className="h-full w-full pt-4">
			<TitleInjector title={project.name} />
			<div className="w-96">
				<ProjectCard project={project} />
			</div>
		</div>
	);
}