"use client";
import ApplicationSelector from "@/components/common/ApplicationSelector";
import HomeButton from "@/components/Projects/HomeButton";
import { RouteLinks } from "@/components/Projects/RouteLinks";
import { UserSection } from "@/components/Projects/UserSection";
import { Bell, ChevronRight, Settings, SidebarClose, SidebarOpen } from "lucide-react";
import { Session } from "next-auth";
import Link from "next/link";
import { useContext } from "react";
import { SidebarContext } from "../layouts/BaseLayout";

export default function ProjectsBar({ session }: { session: Session | null }) {
	return (
		<nav>
			<div className="flex h-16 flex-row items-center gap-4 bg-gray-100 px-4 text-2xl text-base-text-subtle dark:bg-base-bg-primary">
				<MenuButton />
				<div>
					<HomeButton />
				</div>

				<div className="hidden flex-row items-center gap-1 md:flex ">
					<div id="title" className="text-center text-xl font-bold text-base-text-subtle dark:text-base-text-secondary">
						Home
					</div>
					<div className="hidden text-xl md:block">
						<ChevronRight className="w-5" />
					</div>
					<div className="hidden text-base md:block">
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
