// src/pages/_app.tsx
import "../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import type { AppType } from "next/app";
import { trpc } from "../utils/trpc";
import React, { Dispatch, SetStateAction, useEffect, useState } from "react";
import { unknown } from "zod";
import { Project } from "@prisma/client";

export const LoginContext = React.createContext({
	loginOpen: false,
	setLoginOpen: unknown as Dispatch<SetStateAction<boolean>>
});

export const ProjectsContext = React.createContext({
	projects: [] as Project[],
	setProjects: unknown as Dispatch<SetStateAction<Project[]>>,
	fetched: false,
	setFetched: unknown as Dispatch<SetStateAction<boolean>>
});

const MyApp: AppType<{ session: Session | null }> = ({ Component, pageProps: { session, ...pageProps } }) => {
	const [loginOpen, setLoginOpen] = useState(false);
	const [projects, setProjects] = useState([] as Project[]);
	const [fetched, setFetched] = useState(false);

	// fetch projects
	const { data } = trpc.projects.getProjects.useQuery();

	useEffect(() => {
		if (data && !fetched) {
			setProjects(data);
			setFetched(true);
		}
	}, [data, fetched, setProjects, setFetched]);

	return (
		<SessionProvider>
			<LoginContext.Provider value={{ loginOpen, setLoginOpen }}>
				<ProjectsContext.Provider value={{ projects, setProjects, fetched, setFetched }}>
					<Component {...pageProps} />
				</ProjectsContext.Provider>
			</LoginContext.Provider>
		</SessionProvider>
	);
};

export default trpc.withTRPC(MyApp);
