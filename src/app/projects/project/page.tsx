import ErrorWrapper from "@/components/ErrorWrapper";
import { Project } from "@prisma/client";
import { NextPage } from "next";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getUserProjects } from "src/utils/prisma/projects";
import { getCurrentUser } from "src/utils/session";

const ProjectPage = async () => {
	const user = await getCurrentUser();

	if (!user)
		return (
			<div className="flex h-screen items-center justify-center">
				<ErrorWrapper message="Obtaining Auth..." />
			</div>
		);

	const projects = await getUserProjects(user.id);

	if (!projects) {
		return (
			<div className="flex h-screen items-center justify-center">
				<ErrorWrapper message="No Projects" />
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-screen flex-col items-center justify-center gap-8">
			<div className="text-3xl">Projects</div>
			<div className="grid w-[60%] grid-cols-3 p-2">
				{projects.map((project, index) => (
					<ProjectCard project={project} key={index} />
				))}
			</div>
		</div>
	);

};

export default ProjectPage;

const ProjectCard = ({ project }: { project: Project }) => {
	if (!project) return <></>;
	console.log(project);
	return (
		<Link href={"/project/" + project.project_id}>
			<div className="flex flex-col flex-wrap items-center justify-center gap-3 rounded-md border-1 border-pad-gray-700 bg-pad-gray-800 px-4 py-2 shadow-sm">
				<div className="text-center text-2xl font-bold">{project.name}</div>
				<div className="text-center text-neutral-300">{project.description}</div>
				<div className="rounded-md border-1 border-pad-gray-600 px-4 py-1 font-bold">{project.status}</div>
			</div>
		</Link>
	);
};
