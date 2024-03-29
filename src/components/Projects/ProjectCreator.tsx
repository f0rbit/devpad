"use client";

import { Project, PROJECT_STATUS, TASK_VISIBILITY } from "@prisma/client";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";
import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { FetchedProject } from "@/types/page-link";
import { UpdateProject } from "@/server/api/projects";
import { extractUpdateFieldsFromProject } from "src/utils/backend";

const DEFAULT_PROJECT = {
    project_id: "",
    name: "",
    status: PROJECT_STATUS.DEVELOPMENT as PROJECT_STATUS,
    icon_url: "",
    description: "",
    link_text: "",
    link_url: "",
    repo_url: "",
    visibility: TASK_VISIBILITY.PRIVATE as TASK_VISIBILITY
}

export default function ProjectCreator({ projects, mode }: { projects: Project[], mode: "create" | "edit" }) {
    const [error, setError] = useState("");
    const [project, setProject] = useState(mode == "create" || !projects[0] ? DEFAULT_PROJECT : extractUpdateFieldsFromProject(projects[0]));

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
            window.location.href = `/projects/project/${project_id}`;
        } else {
            setError("Failed to create project");
        }
    }

    async function submitUpdate() {
        const response = await fetch("/api/projects/update", { body: JSON.stringify(project), method: "POST" });
        const { data: updated_project, error } = await (response.json() as Promise<{ data: FetchedProject, error: string }>);
        if (error) {
            setError(error);
        } else if (updated_project) {
            window.location.href = `/projects/project/${project.project_id}`;
        } else {
            setError("Failed to update project");
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
        <div className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-4 styled-input">
            <div className="flex w-full flex-row items-center gap-2">
                <div className="flex w-full flex-row items-center gap-2">
                    <label htmlFor="project-id" className="w-max min-w-[7rem]">
                        Project ID
                    </label>
                    <div className="relative w-full">
                        {mode == "create" ? <>
                            <input type="text" defaultValue={project.project_id} name="project-id" id="project-id" className="w-full border-1 border-borders-secondary font-mono" onChange={(e) => setProject({ ...project, project_id: e.target.value })} />
                            <ProjectIDVerify projectID={project.project_id} projects={projects} /></> : <p className="font-mono w-full text-left">{project.project_id}</p>}
                    </div>
                </div>
                <div className="flex w-max flex-row items-center gap-2">
                    <label htmlFor="status">Status</label>
                    <select name="status" id="status" className="border-1 border-borders-primary pr-16 w-max" defaultValue={project.status} onChange={(e) => setProject({ ...project, status: e.target.value as PROJECT_STATUS })}>
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
            {mode == "create" && <br />}
            <div className="flex w-full flex-row items-center gap-2">
                <div className="flex w-full flex-row items-center gap-2">
                    <label htmlFor="name" className="min-w-[7rem]">
                        Name
                    </label>
                    <input type="text" name="name" id="name" className="w-full border-1 border-borders-secondary" placeholder={project.project_id} onChange={(e) => setProject({ ...project, name: e.target.value })} defaultValue={project.name ?? undefined} />
                </div>
                <div className="flex w-full flex-row items-center gap-2">
                    <label htmlFor="image" className="min-w-max">
                        Icon URL
                    </label>
                    <input type="text" name="image" id="image" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, icon_url: e.target.value })} defaultValue={project.icon_url ?? undefined} />
                </div>
            </div>
            <div className="flex w-full flex-row items-center gap-2">
                <label htmlFor="description" className="min-w-[7rem]">
                    Description
                </label>
                <input name="description" id="description" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, description: e.target.value })} defaultValue={project.description ?? undefined} />
            </div>
            <div className="flex w-full flex-row items-center gap-2">
                <div className="flex w-full flex-row gap-2">
                    <label htmlFor="link" className="min-w-[7rem]">
                        Link Text
                    </label>
                    <input type="text" name="link" id="link" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, link_text: e.target.value })} defaultValue={project.link_text ?? undefined} />
                </div>
                <div className="flex w-full flex-row gap-2">
                    <label htmlFor="website" className="min-w-max">
                        Link URL
                    </label>
                    <input type="text" name="website" id="website" className="w-full border-1 border-borders-secondary" onChange={(e) => setProject({ ...project, link_url: e.target.value })} defaultValue={project.link_url ?? undefined} />
                </div>
            </div>
            <div className="flex flex-row gap-2 items-center w-full">
                <div className="flex flex-row gap-2 w-full">
                    <label htmlFor="github" className="min-w-[7rem]">
                        GitHub URL
                    </label>
                    <input type="text" name="github" id="github" className="w-full border-1 border-borders-secondary w-full" onChange={(e) => setProject({ ...project, repo_url: e.target.value })} defaultValue={project.repo_url ?? undefined} />
                </div>
                <div className="flex flex-row gap-2 items-center">
                    <label htmlFor="visiblity">Visiblity</label>
                    <select name="visibility" id="visibility" className="border-1 border-borders-primary pr-16 w-max" defaultValue={project.visibility} onChange={(e) => setProject({ ...project, visibility: e.target.value as TASK_VISIBILITY })}>
                        {Object.values(TASK_VISIBILITY).map((vis) => (<option key={vis} value={vis}>{vis}</option>))}
                    </select>
                </div>
            </div>
            <div className="mt-2 flex justify-center">
                <button className="w-max rounded-md border-accent-btn-primary-hover bg-accent-btn-primary py-1.5 px-6 font-semibold hover:bg-accent-btn-primary-hover" onClick={() => mode == "create" ? submitCreate() : submitUpdate()}>
                    {mode == "create" ? "Create" : "Update"}
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
