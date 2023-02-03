import ErrorWrapper from "@/components/ErrorWrapper";
import TitleInjector from "@/components/Projects/TitleInjector";
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
		<div className="flex flex-col justify-center gap-8 mt-8">
			<TitleInjector title="Projects" />
			<div className="text-3xl text-center">Projects</div>
			<div className="grid grid-cols-3 p-2">
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
