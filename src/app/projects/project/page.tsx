import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import Link from "next/link";
import { getUserProjects } from "src/utils/prisma/projects";
import { getCurrentUser } from "src/utils/session";

const ProjectPage = async () => {
	const { error, data } = await getUserProjects();

	if (error?.length > 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={error} />
			</div>
		);
	}

	const projects = data;

	return (
		<div className="flex flex-col justify-center gap-8 pt-8">
			<TitleInjector title="Projects" />
			<CenteredContainer>
				<div className="text-3xl text-center">Projects</div>
				<div className="grid grid-cols-3 p-2 gap-2">
					{projects.map((project, index) => (
						<Link href={"/project/" + project.project_id} key={index}>
							<ProjectCard project={project}/>
						</Link>
					))}
				</div>
			</CenteredContainer>
		</div>
	);

};

export default ProjectPage;
