import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProjects } from "@/server/api/projects";
import Link from "next/link";

const ProjectPage = async () => {
	const { error, data } = await getUserProjects({ includeDeleted: false });

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
						<Link href={"/projects/project/" + project.project_id} key={index}>
							<ProjectCard project={project}/>
						</Link>
					))}
				</div>
			</CenteredContainer>
		</div>
	);

};

export default ProjectPage;

