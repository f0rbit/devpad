import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import RecentProjects from "@/components/Projects/RecentProjects";
import TitleInjector from "@/components/Projects/TitleInjector";
import Link from "next/link";
import { getUserProjects } from "src/utils/prisma/projects";

export default async function HomePage() {
	return (
		<CenteredContainer>
			<TitleInjector title="Home" />
			<div className="pt-8 flex w-full flex-col justify-center gap-2 text-center text-base-text-primary">
				<RecentProjects />
				<div className="text-3xl font-bold">Weekly Tasks</div>
				<div className="h-96 w-full rounded-xl border-1 border-borders-primary bg-base-accent-primary"></div>
			</div>
		</CenteredContainer>
	);
}