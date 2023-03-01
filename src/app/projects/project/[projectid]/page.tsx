import ErrorWrapper from "@/components/common/ErrorWrapper";
import VersionIndicator from "@/components/common/VersionIndicator";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProject } from "@/server/api/projects";
import { FetchedProject } from "@/types/page-link";

export default async function Page({ params }: { params: { projectid: string } }) {
	const { projectid } = params;

	const { data, error } = await getUserProject(projectid);

	if (error?.length > 0) {
		return (
			<div className="flex items-center justify-center h-full">
				<ErrorWrapper message={error} />
			</div>
		);
	}
	const project = data;

	if (!project) {
		return (
			<div className="flex items-center justify-center h-full">
				<ErrorWrapper message="Project not found" />
			</div>
		);
	}
	return (
		<div className="h-full w-full pt-4">
			<TitleInjector title={project.name} />
			<div className="flex justify-center">
				<ProjectOverview project={data} />
			</div>
		</div>
	);
}

function ProjectOverview({ project }: { project: FetchedProject }) {
	return (
		<div className="flex flex-col gap-2 2xl:w-1/2 lg:w-2/3 w-full px-4">
			<div className="flex flex-row gap-2 items-center">
				<h1 className="text-3xl font-semibold">{project.name}</h1>
				{project.current_version && <VersionIndicator version={project.current_version} />}
			</div>
			<div>
				<textarea placeholder="Detailed Specification"></textarea>
			</div>
			<div>
				Goals Overview
			</div>
			<div>
				Recent Activity
			</div>
		</div>
	);
}
