"use client"

import ProjectsBar from "@/components/Projects/ProjectsBar";
import { Session } from "next-auth";
import React, { Dispatch, SetStateAction, useState } from "react";
import { unknown } from "zod";

export const SidebarContext = React.createContext({
    open: false,
    setOpen: unknown as Dispatch<SetStateAction<boolean>>,
});

export default function BaseLayout({ children, session }: { children: React.ReactNode, session: Session | null}) {
    const [open, setOpen] = useState(false);
	return (
		<div className="flex h-full min-h-screen w-screen flex-row">
			<div className="flex w-full flex-col bg-base-bg-primary">
                <SidebarContext.Provider value={{ open, setOpen }}>
                    <div className="h-max border-b-1 border-b-borders-primary">
                        <ProjectsBar session={session} />
                    </div>
                    <div className="h-full">
                        {children}
                    </div>
                </SidebarContext.Provider>
			</div>
		</div>
	);
}
