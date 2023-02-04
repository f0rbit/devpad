import { Project } from "@prisma/client";
import Link from "next/link";

export const ProjectCard = ({ project }: { project: Project }) => {
	if (!project) return <></>;
	return (
		<div className="flex h-full w-full flex-col flex-wrap items-center justify-center gap-3 transition-colors duration-500 rounded-md border-1 border-borders-primary bg-base-accent-primary px-4 py-2 text-base-text-subtle shadow-sm hover:bg-base-accent-secondary">
			<div className="text-center text-2xl font-semibold text-base-text-secondary">{project.name}</div>
			<div className="text-center">{project.description}</div>
			<div className="rounded-md border-1 border-borders-primary bg-base-accent-primary px-4 py-1 font-bold mt-auto">{project.status}</div>
		</div>
	);
};
