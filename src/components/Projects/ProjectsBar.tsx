"use client"
import ApplicationSelector from "@/components/ApplicationSelector";
import HomeButton from "@/components/Projects/HomeButton";
import { RouteLinks } from "@/components/Projects/RouteLinks";
import { UserSection } from "@/components/Projects/UserSection";
import { Bell, Settings, SidebarClose, SidebarOpen } from "lucide-react";
import { Session } from "next-auth";
import Link from "next/link";
import { useContext } from "react";
import { SidebarContext } from "../layouts/BaseLayout";

export default function ProjectsBar({ session } : { session: Session | null}) {
	return (
		<nav>
			<div className="flex h-16 flex-row items-center gap-4 bg-base-bg-primary px-4 text-2xl text-base-text-subtle">
				<MenuButton />
				<div>
					<HomeButton />
				</div>
				
				<div className="flex-row items-center gap-1 hidden md:flex ">
					<div id="title" className="text-xl font-bold text-base-text-secondary text-center">
						Home
					</div>
					<div className="text-xl hidden md:block">{">"}</div>
					<div className="text-base hidden md:block">
						<RouteLinks />
					</div>
				</div>

				<div className="mx-auto" />
				<ApplicationSelector />
				{/* <div>
					<Boxes />
				</div> */}
				<div title="Notifications">
					<Bell />
				</div>
				<div title="Settings">
					<Link href={"settings"}>
						<Settings />
					</Link>
				</div>
				<div className="flex items-center" title="User Section">
					<UserSection session={session} />
				</div>
			</div>
		</nav>
	);
}

const MenuButton = () => {
	const { open, setOpen } = useContext(SidebarContext);
	return (
		<button onClick={() => setOpen(!open)} className="pt-0.5" title={open ? "Close Sidebar" : "Open Sidebar"}>
			{open ? <SidebarClose /> : <SidebarOpen />}
		</button>
	);
};
