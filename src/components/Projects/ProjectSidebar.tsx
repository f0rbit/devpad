"use client";

import { BookOpen, Map, Milestone, Scroll } from "lucide-react";
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
    const path = pathname?.split("/").slice(0, 3).join("/");

	return (
		<div className="flex h-full justify-center pt-4 text-lg">
			<div className="flex w-full flex-col gap-4 px-8">
				{PROJECT_LINKS.map((link, index) => {
					return (
						<Link href={path + link.link} key={index}>
							<div className="flex w-full flex-row items-center gap-4 rounded-md border-1 border-[#5c5c65] hover:bg-[#47474d] py-1 px-4 font-poppins">
								<div className="rounded-full text-[#d9d8e1]">{link.icon}</div>
								<div className="font-bold text-[#d9d8e1]">{link.name}</div>
							</div>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
