"use client"
import HomeButton from "@/components/Projects/HomeButton";
import { RouteLinks } from "@/components/Projects/RouteLinks";
import { UserSection } from "@/components/Projects/UserSection";
import { Bell, Menu, Settings } from "lucide-react";
import { Session } from "next-auth";
import Link from "next/link";
import React, { useContext } from "react";
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

const MenuButton = () => {
	const { open, setOpen } = useContext(SidebarContext);
	return (
		<button onClick={() => setOpen(!open)}>
			<Menu />
		</button>
	);
};
