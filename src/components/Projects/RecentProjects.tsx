import { Project } from "@prisma/client";
import Link from "next/link";
import { ProjectCard } from "./ProjectCard";
import PrimaryButton from "../common/PrimaryButton";
import GenericButton from "../common/GenericButton";
import { FetchedProject } from "@/types/page-link";

export default function RecentProjects({ projects }: { projects: FetchedProject[] }) {
	const recent = projects.sort((a, b) => b.updated_at.valueOf() - a.updated_at.valueOf()).slice(0, 3);

	// get the 3 most recently updated projects

	// place the 3 most recently updated projects in a grid
	// the most recently updated project should be in the center
	// the other two should be on the left and right
	// the left and right projects should be smaller than the center project
	return (
		<div className="flex flex-col justify-center gap-2 text-center text-[#d9d8e1]">
			<div className="text-3xl font-bold">Recent Projects</div>
			<div className="grid h-max min-h-[13rem] grid-cols-3 gap-2 p-2">
				<div className="origin-right scale-90">
					<RecentProject project={recent[1]} />
				</div>
				<div className="">
					<RecentProject project={recent[0]} />
				</div>
				<div className="origin-left scale-90">
					<RecentProject project={recent[2]} />
				</div>
			</div>
			<div className="flex flex-row justify-center gap-2 text-lg font-semibold">
				<Link href={"projects/project"}>
					<GenericButton>View All</GenericButton>
				</Link>
				<Link href={"projects/create"}>
					<PrimaryButton>Create New</PrimaryButton>
				</Link>
			</div>
		</div>
	);
}

const RecentProject = ({ project }: { project: Project | undefined }) => {
	if (project) {
		return (
			<Link href={"projects/project/" + project.project_id}>
				<ProjectCard project={project} />
			</Link>
		);
	} else {
		return <div className="h-full w-full border-1 border-borders-primary opacity-50"></div>;
	}
};
