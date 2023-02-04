"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const RouteLinks = () => {
	const pathname = usePathname();
	if (!pathname) return null;

	const links = pathname.split("/").map((path, i) => ({
		href: pathname
			.split("/")
			.slice(0, i + 1)
			.join("/"),
		text: path ?? "?"
	}));

	return (
		<>
			{links.map((link, i) => {
				const final = i === links.length - 1;
				return (
					<span key={i} className="text-base-text-dark group">
						<Link href={link.href}>
							<span className={`cursor-pointer hover:underline ${final ? "text-base-text-subtle " : ""} hover:text-blue-300`}>{link.text}</span>
						</Link>
						{!final && <span className="group-hover:text-blue-400" key={i + 0.5}>/</span>}
					</span>
				);
			})}
		</>
	);
};
