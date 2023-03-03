"use client";
import { UpdateProject } from "@/server/api/projects";
import { FetchedProject } from "@/types/page-link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import AcceptButton from "../common/AcceptButton";
import GenericButton from "../common/GenericButton";
import { extractUpdateFieldsFromProject } from "src/utils/backend";

export default function ProjectSpecification({ initial_project }: { initial_project: FetchedProject }) {
	const [project, setProject] = useState(initial_project);
	const [specification, setSpecification] = useState(initial_project.specification);
	const [editing, setEditing] = useState(false);

	async function saveProject() {
		const update_project: UpdateProject = {
			...extractUpdateFieldsFromProject(project),
			specification: specification
		};

		setEditing(false);
		setProject((project) => ({ ...project, specification: specification }));

		const response = await fetch("/api/projects/update", { method: "POST", body: JSON.stringify(update_project) });
		const { data, error } = await (response.json() as Promise<{ data: FetchedProject | null; error: string | null }>);
		if (error || !data) {
			console.error(error ?? "No data returned from server");
			return;
		} else {
			setProject(data);
		}
	}

	// either render the specification in markdown, or an editable text area box depending on editing state
	if (editing) {
		return (
			<div>
				<textarea
					placeholder="Detailed Specification"
					className="scrollbar-hide min-h-[16rem] font-mono text-base-text-subtlish"
					value={specification ?? undefined}
					onChange={(e) => {
						setSpecification(e.target.value);
						const element = e.target;
						element.style.height = "inherit";
						element.style.height = element.scrollHeight + "px";
						// el.style.height = el.scrollHeight >= el.clientHeight ? el.scrollHeight + "px" : "12rem";
					}}
				></textarea>
				<div className="flex items-center justify-center gap-2">
					<AcceptButton onClick={() => saveProject()}>Save</AcceptButton>
					<GenericButton
						onClick={() => {
							setSpecification(project.specification);
							setEditing(false);
						}}
					>
						Cancel
					</GenericButton>
				</div>
			</div>
		);
	} else {
		if (project.specification && project.specification?.length > 0) {
			return (
				<div className="group relative h-full">
					<div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100">
						<GenericButton onClick={() => setEditing(true)}>Edit</GenericButton>
					</div>
					<h3 className="mb-1 text-center text-xl text-base-text-secondary">Detailed Specification</h3>
					<ReactMarkdown className="markdown h-max rounded-md border-1 border-borders-primary p-2 text-base-text-subtlish">{project.specification ?? ""}</ReactMarkdown>
				</div>
			);
		} else {
			return (
				<div className="flex justify-center">
					<GenericButton onClick={() => setEditing(true)}>Add Specification</GenericButton>
				</div>
			);
		}
	}
}
