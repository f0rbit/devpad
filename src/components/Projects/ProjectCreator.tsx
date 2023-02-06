"use client";

import { Project, PROJECT_STATUS } from "@prisma/client";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";
import CenteredContainer from "../CenteredContainer";
import ErrorWrapper from "../ErrorWrapper";

export default function ProjectCreator({ projects }: { projects: Project[] }) {
	const [error, setError] = useState("");
	const [project, setProject] = useState({
		project_id: "",
		name: "",
		status: PROJECT_STATUS.DEVELOPMENT as PROJECT_STATUS,
		icon_url: "",
		description: "",
		link_text: "",
		link_url: "",
		repo_url: ""
	});

	async function submitCreate() {
		const newProject = {
			...project,
			name: project.name.length > 0 ? project.name : project.project_id // sets the name to the project id if it's empty
		};
		// send to an api route
		const response = await fetch("/api/projects/create", { body: JSON.stringify(newProject), method: "POST" });
		const { project_id, error } = await (response.json() as Promise<{ project_id: string; error: string }>);
		if (error) {
			setError(error);
		} else if (project_id) {
			window.location.href = `/project/${project_id}`;
		} else {
			setError("Failed to create project");
		}
	}

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div id="project-create" className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-4">
			<div className="flex w-full flex-row items-center gap-2">
				<div className="flex w-full flex-row items-center gap-2">
					<label htmlFor="project-id" className="w-max min-w-[7rem]">
						Project ID
					</label>
					<div className="relative w-full">
						<input type="text" defaultValue={project.project_id} name="project-id" id="project-id" className="w-full border-1 border-borders-secondary font-mono" onChange={(e) => setProject({ ...project, project_id: e.target.value })} />
						<ProjectIDVerify projectID={project.project_id} projects={projects} />
					</div>
				</div>
				<div className="flex w-max flex-row items-center gap-2">
					<label htmlFor="status">Status</label>
					<select name="status" id="status" className="border-1 border-borders-primary pr-16" defaultValue={project.status} onChange={(e) => setProject({ ...project, status: e.target.value as PROJECT_STATUS })}>
						{Object.values(PROJECT_STATUS).map((status) => {
							return (
								<option key={status} value={status}>
									{status}
								</option>
							);
						})}
					</select>
				</div>
			</div>
			<br />
			<div className="flex w-full flex-row items-center gap-2">
				<div className="flex w-full flex-row items-center gap-2">
					<label htmlFor="name" className="min-w-[7rem]">
						Name
					</label>
					<input type="text" name="name" id="name" className="w-full border-1 border-borders-secondary" placeholder={project.project_id} onChange={(e) => setProject({ ...project, name: e.target.value })} defaultValue={project.name} />
				</div>
				<div className="flex w-full flex-row items-center gap-2">
					<label htmlFor="image" className="min-w-max">
						Icon URL
					</label>
					<input type="text" name="image" id="image" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, icon_url: e.target.value })} defaultValue={project.icon_url} />
				</div>
			</div>
			<div className="flex w-full flex-row items-center gap-2">
				<label htmlFor="description" className="min-w-[7rem]">
					Description
				</label>
				<input name="description" id="description" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, description: e.target.value })} defaultValue={project.description} />
			</div>
			<div className="flex w-full flex-row items-center gap-2">
				<div className="flex w-full flex-row gap-2">
					<label htmlFor="link" className="min-w-[7rem]">
						Link Text
					</label>
					<input type="text" name="link" id="link" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, link_text: e.target.value })} defaultValue={project.link_text} />
				</div>
				<div className="flex w-full flex-row gap-2">
					<label htmlFor="website" className="min-w-max">
						Link URL
					</label>
					<input type="text" name="website" id="website" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, link_url: e.target.value })} defaultValue={project.link_url} />
				</div>
			</div>
			<div className="flex flex-row gap-2">
				<label htmlFor="github" className="min-w-[7rem]">
					GitHub URL
				</label>
				<input type="text" name="github" id="github" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, repo_url: e.target.value })} defaultValue={project.repo_url} />
			</div>
			<div className="mt-2 flex justify-center">
				<button className="w-max rounded-md border-accent-btn-primary-hover bg-accent-btn-primary py-1.5 px-6 font-semibold hover:bg-accent-btn-primary-hover" onClick={submitCreate}>
					Create
				</button>
			</div>
		</div>
	);
}

const ProjectIDVerify = ({ projectID, projects }: { projectID: string; projects: Project[] }) => {
	const isValidProjectID = (id: string) => {
		if (!id || id.length <= 0) return "You need a Project ID!";
		if (projects.find((project) => project.project_id === id)) return "Project ID already exists";
		if (id.toLowerCase() !== id) return "Project ID must be lowercase";
		if (id.includes(" ")) return "Project ID must not contain spaces";
		if (!id.match(/^[a-z0-9-]+$/)) return "Project ID must be URL-safe";
		return "";
	};

	const reason = isValidProjectID(projectID);

	return (
		<div className={`absolute ml-2 flex flex-row items-center gap-2 whitespace-nowrap pt-1 ${!reason ? "text-green-300" : "text-red-300"}`}>
			{!reason ? (
				<>
					<Check />
					<span>Project will be saved under </span>
					<span className="font-mono">project/{projectID}</span>
				</>
			) : (
				<>
					<AlertTriangle className="w-5" />
					<span>{reason}</span>
				</>
			)}
		</div>
	);
};
