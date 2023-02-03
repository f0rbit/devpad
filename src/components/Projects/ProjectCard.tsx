import { Project } from "@prisma/client";
import Link from "next/link";

export const ProjectCard = ({ project }: { project: Project }) => {
	if (!project) return <></>;
	return (
		<div className="flex h-full w-full flex-col flex-wrap items-center justify-center gap-3 rounded-md border-1 border-[#5c5c65] bg-[#323236] px-4 py-2 text-[#a8a7b2] shadow-sm hover:bg-[#47474d]">
			<div className="text-center text-2xl font-bold">{project.name}</div>
			<div className="text-center text-[#78777f]">{project.description}</div>
			<div className="rounded-md border-1 border-[#5c5c65] bg-[#323236] px-4 py-1 font-bold mt-auto">{project.status}</div>
		</div>
	);
};
