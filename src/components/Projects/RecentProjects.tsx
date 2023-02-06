import { Project } from "@prisma/client";
import Link from "next/link";
import { use } from "react";
import { getUserProjects } from "src/utils/prisma/projects";
import ErrorWrapper from "../ErrorWrapper";
import { ProjectCard } from "./ProjectCard";

export default function RecentProjects() {
	const { data, error } = use(getUserProjects());
	// if (error?.length > 0) {
	// 	return (
	// 		<div className="flex h-full items-center justify-center">
	// 			<ErrorWrapper message={error} />
	// 		</div>
	// 	);
	// }

	const projects = data.sort((a, b) => b.updated_at.valueOf() - a.updated_at.valueOf()).slice(0, 3);

	// get the 3 most recently updated projects

	// place the 3 most recently updated projects in a grid
	// the most recently updated project should be in the center
	// the other two should be on the left and right
	// the left and right projects should be smaller than the center project
	return (
		<div className="flex flex-col justify-center gap-2 text-center text-[#d9d8e1]">
			<div className="text-3xl font-bold">Recent Projects</div>
			{error?.length > 0 && (
				<div className="flex scale-90 items-center justify-center">
					<ErrorWrapper message={error} />
				</div>
			)}
			<div className="grid h-52 grid-cols-3 gap-2 p-2">
				<div className="origin-right scale-90">
					<RecentProject project={projects[1]} />
				</div>
				<div className="">
					<RecentProject project={projects[0]} />
				</div>
				<div className="origin-left scale-90">
					<RecentProject project={projects[2]} />
				</div>
			</div>
			<div className="flex flex-row justify-center gap-2 text-lg font-semibold">
				<Link href={"/project"}>
					<button className="rounded-xl bg-accent-btn-secondary px-4 py-0.5 hover:bg-accent-btn-secondary-hover">View All</button>
				</Link>
				<Link href={"/create"}>
					<button className="rounded-xl bg-accent-btn-secondary px-4 py-0.5 hover:bg-accent-btn-secondary-hover">Create New</button>
				</Link>
			</div>
		</div>
	);
}

const RecentProject = ({ project }: { project: Project | undefined }) => {
	if (project) {
		return (
			<Link href={"/project/" + project.project_id}>
				<ProjectCard project={project} />
			</Link>
		);
	} else {
		return <div className="h-full w-full border-1 border-borders-primary opacity-50"></div>;
	}
};