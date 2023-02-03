import { Bell, Home, Settings } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { getSession } from "src/utils/session";
import { PageTitle } from "./PageTitle";
import { RouteLinks } from "./RouteLinks";
import { UserSection } from "./UserSection";

export default function ProjectsBar() {
	const session = use(getSession());
	return (
		<nav>
			<div className="flex h-16 flex-row items-center gap-4 bg-[#323236] px-4 pr-8 text-3xl text-[#78777f]">
				<div>
					<Link href={"/"}>
						<Home />
					</Link>
				</div>
				<div id="title" className="font-bold text-[#d9d8e1] font-poppins">
					Home
				</div>
				<div className="text-xl">{">"}</div>
				<div className="text-base">
					<RouteLinks />
				</div>
				<div className="mx-auto" />
				<div>
					<Bell />
				</div>
				<div>
					<Link href={"settings"}>
						<Settings />
					</Link>
				</div>
				<div className="flex items-center">
					<UserSection session={session} />
				</div>
			</div>
		</nav>
	);
}
