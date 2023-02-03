import ErrorWrapper from "@/components/ErrorWrapper";
import TitleInjector from "@/components/Projects/TitleInjector";
import { Project } from "@prisma/client";
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
		<div className="w-full h-full">
			<TitleInjector title={project.name} />
			<ProjectRenderer project={project} />
		</div>
	);
}

export function ProjectRenderer({ project }: { project: Project })  {
	if (!project) return <></>;
	return (
		<div className="flex flex-col flex-wrap items-center justify-center gap-3 rounded-md border-1 border-pad-gray-700 bg-pad-gray-800 px-4 py-2 shadow-sm">
			<div className="text-center text-2xl font-bold">{project.name}</div>
			<div className="text-center text-neutral-300">{project.description}</div>
			<div className="rounded-md border-1 border-pad-gray-600 px-4 py-1 font-bold">{project.status}</div>
		</div>
	);
};

