"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ProjectsBar({ title }: { title: string }) {
	return (
		<nav>
			<div className="flex h-16 flex-row items-center gap-4 bg-slate-600 px-4 text-3xl">
				<div>🏠</div>
				<div>{title}</div>
				<div className="text-base">
					<RouteLinks />
				</div>
				<div className="mx-auto" />
				<div>🔔</div>
				<div>⚙</div>
				<div>User</div>
			</div>
		</nav>
	);
}

const RouteLinks = () => {
	const pathname = usePathname();
	if (!pathname) return null;

	const links = pathname.split("/").map((path, i) => ({
		href: pathname
			.split("/")
			.slice(0, i + 1)
			.join("/"),
		text: i == 0 ? "home" : path ?? "?"
	}));

	return (
		<>
			{links.map((link, i) => (
				<span key={i}>
					<Link href={link.href}>
						<span className="cursor-pointer text-blue-500 hover:underline">{link.text}</span>
					</Link>
					{i < links.length - 1 && <span key={i + 0.5}>/</span>}
				</span>
			))}
		</>
	);
};
