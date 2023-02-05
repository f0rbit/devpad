"use client";

import { CreateProjectType } from "@/types/page-link";
import { Project, PROJECT_STATUS } from "@prisma/client";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";

export default function ProjectCreator({ projects }: { projects: Project[] }) {
	const [projectID, setProjectID] = useState("");
	const [projectStatus, setProjectStatus] = useState(PROJECT_STATUS.DEVELOPMENT as PROJECT_STATUS);
	const [projectName, setProjectName] = useState("");
	const [projectImage, setProjectImage] = useState("");
	const [projectDescription, setProjectDescription] = useState("");
	const [projectLinkText, setProjectLinkText] = useState("");
	const [projectLinkURL, setProjectLinkURL] = useState("");
	const [projectGitHubURL, setProjectGitHubURL] = useState("");


	async function submitCreate() {
		const project: CreateProjectType = {
			name: projectName?.length > 0 ? projectName : projectID,
			project_id: projectID,
			description: projectDescription,
			icon_url: projectImage,
			link_text: projectLinkText,
			link_url: projectLinkURL,
			repo_url: projectGitHubURL,
			status: projectStatus
		};
		// send to an api route
		const response = await fetch("/api/projects/create", { body: JSON.stringify(project), method: "POST" });
		const { project_id, error } = await (response.json() as Promise<{project_id: string, error: string}>);
		if (error) {
			throw new Error(error);
		} else if (project_id) {
			// redirect to project/${project_id}
			window.location.href = `/project/${project_id}`;
		} else {
			throw new Error("Failed to create project");
		}
	}

	return (
		<div id="project-create" className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-4">
			<div className="flex w-full flex-row items-center gap-2">
				<div className="flex w-full flex-row items-center gap-2">
					<label htmlFor="project-id" className="w-max min-w-[7rem]">
						Project ID
					</label>
					<div className="relative w-full">
						<input type="text" defaultValue={projectID} name="project-id" id="project-id" className="w-full border-1 border-borders-secondary font-mono" onChange={(e) => setProjectID(e.target.value)} />
						<ProjectIDVerify projectID={projectID} projects={projects} />
					</div>
				</div>
				<div className="flex w-max flex-row items-center gap-2">
					<label htmlFor="status">Status</label>
					<select name="status" id="status" className="border-1 border-borders-primary pr-16" defaultValue={projectStatus} onChange={(e) => setProjectStatus(e.target.value as PROJECT_STATUS)}>
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
					<input type="text" name="name" id="name" className="w-full border-1 border-borders-secondary" placeholder={projectID} onChange={(e) => setProjectName(e.target.value)} defaultValue={projectName} />
				</div>
				<div className="flex w-full flex-row items-center gap-2">
					<label htmlFor="image" className="min-w-max">
						Icon URL
					</label>
					<input type="text" name="image" id="image" className="w-full border-1 border-borders-secondary" onChange={(e) => setProjectImage(e.target.value)} defaultValue={projectImage} />
				</div>
			</div>
			<div className="flex w-full flex-row items-center gap-2">
				<label htmlFor="description" className="min-w-[7rem]">
					Description
				</label>
				<input name="description" id="description" className="w-full border-1 border-borders-secondary" onChange={(e) => setProjectDescription(e.target.value)} defaultValue={projectDescription} />
			</div>
			<div className="flex w-full flex-row items-center gap-2">
				<div className="flex w-full flex-row gap-2">
					<label htmlFor="link" className="min-w-[7rem]">
						Link Text
					</label>
					<input type="text" name="link" id="link" className="w-full border-1 border-borders-secondary" onChange={(e) => setProjectLinkText(e.target.value)} defaultValue={projectLinkText} />
				</div>
				<div className="flex w-full flex-row gap-2">
					<label htmlFor="website" className="min-w-max">
						Link URL
					</label>
					<input type="text" name="website" id="website" className="w-full border-1 border-borders-secondary" onChange={(e) => setProjectLinkURL(e.target.value)} defaultValue={projectLinkURL} />
				</div>
			</div>
			<div className="flex flex-row gap-2">
				<label htmlFor="github" className="min-w-[7rem]">
					GitHub URL
				</label>
				<input type="text" name="github" id="github" className="w-full border-1 border-borders-secondary" onChange={(e) => setProjectGitHubURL(e.target.value)} defaultValue={projectGitHubURL} />
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
		if (id?.length <= 0) return { valid: false, reason: "You need a Project ID!" };
		// check for existing project
		if (projects.find((project) => project.project_id === id)) {
			return { valid: false, reason: "Project ID already exists" };
		}
		// return id.toLowerCase() === id && !id.includes(" ");
		if (id.toLowerCase() !== id) {
			return { valid: false, reason: "Project ID must be lowercase" };
		}
		if (id.includes(" ")) {
			return { valid: false, reason: "Project ID must not contain spaces" };
		}
		// check if url-safe
		if (!id.match(/^[a-z0-9-]+$/)) {
			return { valid: false, reason: "Project ID must be URL-safe" };
		}
		return { valid: true, reason: "" };
	};

	const { valid, reason } = isValidProjectID(projectID);

	return (
		<div className={`absolute ml-2 flex flex-row items-center gap-2 pt-1 whitespace-nowrap ${valid ? "text-green-300" : "text-red-300"}`}>
			{valid ? (
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
