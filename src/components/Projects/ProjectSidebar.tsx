"use client";

import { BookOpen, Map, Milestone, Scroll, Trash } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type ProjectLink = {
	name: string;
	link: string;
	icon: JSX.Element;
};

const PROJECT_LINKS: ProjectLink[] = [
	{
		name: "Overview",
		link: "",
		icon: <BookOpen />
	},
	{
		name: "Goals",
		link: "/goals",
		icon: <Milestone />
	},
	{
		name: "Roadmap",
		link: "/roadmap",
		icon: <Map />
	},
	{
		name: "History",
		link: "/history",
		icon: <Scroll />
	}
];

export default function ProjectSidebar() {
	const [expanded, setExpanded] = useState(false);

	const pathname = usePathname();
	// extract the first two strings of the path
	const path = pathname?.split("/").slice(1, 3).join("/");
	

	return (
		<div className="flex h-full justify-center pt-4 text-lg">
			<div className="flex w-full flex-col gap-4 px-8">
				{PROJECT_LINKS.map((link, index) => {
					return (
						<Link href={path + link.link} key={index}>
							<div className="flex w-full flex-row items-center gap-4 rounded-md border-1 border-borders-primary py-1 px-4 font-poppins transition-colors duration-500 hover:bg-borders-primary">
								<div className="text-base-text-secondary">{link.icon}</div>
								<div className="font-bold text-base-text-secondary">{link.name}</div>
							</div>
						</Link>
					);
				})}
				<div className="mt-auto mb-4">
					<DeleteButton project_id={pathname?.split("/").at(2)}/>
				</div>
			</div>
		</div>
	);
}

function DeleteButton({ project_id }: { project_id: string | undefined }) {
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState("");
	
	async function deleteProject() {
		if (!project_id) return;
		// send request off to api to delete the project
		// api endpoint is api/projects/delete
		const response = await fetch("/api/projects/delete", { method: "POST", body: JSON.stringify({ project_id }) });
		const { success, error } = await (response.json() as Promise<{ success: boolean; error: string }>);
		if (error) {
			setError(error);
		} else if (success) {
			// redirect to home page
			window.location.href = "/";
		} else {
			setError("Failed to delete project");
		}
	}

	if (error) return <div className="text-red-400">{error}</div>;

	return (
		<div className="relative">
			<button className="flex w-full flex-row items-center gap-4 rounded-md border-1 border-red-400 py-1 px-4 font-poppins text-red-400 transition-colors duration-500 hover:border-red-300 hover:bg-red-400 hover:text-red-100" onClick={() => setExpanded(!expanded)}>
				<Trash />
				<div className="font-bold">Delete</div>
			</button>
			{expanded && (
				<div className="absolute bottom-[120%] left-0 w-max rounded-md border-1 border-borders-primary bg-base-bg-primary p-4 text-base">
					<div className="font-bold text-base-text-secondary">Are you sure?</div>
					<div className="text-base-text-secondary">This action cannot be undone.</div>
					<div className="mt-4 flex flex-row gap-4">
						<button className="flex w-full h-full flex-row items-center gap-2 rounded-md border-1 border-red-400 py-1 px-4 font-poppins text-red-400 transition-colors duration-500 hover:border-red-300 hover:bg-red-400 hover:text-red-100" onClick={() => {
							deleteProject();
						}}>
							<Trash />
							<div className="font-bold">Delete</div>
						</button>
						<button
							className="flex w-full h-full flex-row items-center gap-4 rounded-md border-1 border-borders-primary py-1 px-4 font-poppins text-base-text-secondary transition-colors duration-500 hover:border-borders-primary hover:bg-borders-primary hover:text-base-text-primary"
							onClick={() => setExpanded(!expanded)}
						>
							<div className="font-bold">Cancel</div>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
