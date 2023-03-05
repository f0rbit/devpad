import BaseLayout, { SidebarContext } from "@/components/layouts/BaseLayout";
import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import { FetchedProject, FetchedTask } from "@/types/page-link";
import { Project, TaskTags } from "@prisma/client";
import { useSession } from "next-auth/react";
import Head from "next/head";
import React, { Context, Dispatch, SetStateAction, useCallback, useContext, useEffect, useState } from "react";
import { trpc } from "src/utils/trpc";

type TodoContextType = {
	showList: boolean;
	setShowList: Dispatch<SetStateAction<boolean>>;
	selectedSection: string;
	setSelectedSection: Dispatch<SetStateAction<string>>;
	toggleList: () => void;
	searchQuery: string;
	setSearchQuery: Dispatch<SetStateAction<string>>;
	tags: TaskTags[];
	setTags: Dispatch<SetStateAction<TaskTags[] | undefined>>;
	items: FetchedTask[];
	setItems: Dispatch<SetStateAction<FetchedTask[] | undefined>>;
	projects: FetchedProject[];
	loading: boolean;
};

export const TodoContext: Context<TodoContextType> = React.createContext({} as TodoContextType);

const DashboardMainSection = ({ mobile }: { mobile: boolean }) => {
	const { open } = useContext(SidebarContext);
	if (mobile) return open ? <MainLinkSection expanded={false} /> : <ListRenderer />;
	return (
		<>
			{open && <MainLinkSection expanded={true} />}
			<ListRenderer />
		</>
	);
};

const Dashboard = () => {
	const [showList, setShowList] = useState(true);
	const [selectedSection, setSelectedSection] = useState("todo");
	const [searchQuery, setSearchQuery] = useState("");
	const { data } = trpc.data.getItemsAndTags.useQuery();
	const [tags, setTags] = useState(undefined as TaskTags[] | undefined);
	const [items, setItems] = useState(undefined as FetchedTask[] | undefined);
	const [projects, setProjects] = useState(undefined as FetchedProject[] | undefined);
	const { data: session } = useSession();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (data?.tags && !tags) {
			setTags(data?.tags);
		}
		if (data?.items && !items) {
			setItems(data?.items);
		}
		if (data?.projects && !projects) {
			setProjects(data?.projects);
		}
		if (data) setLoading(false);
	}, [data, tags, setTags, items, setItems]);

	const toggleList = useCallback(() => {
		setShowList((prev) => !prev);
	}, [setShowList]);

	const value: TodoContextType = {
		showList,
		setShowList,
		selectedSection,
		setSelectedSection,
		toggleList,
		searchQuery,
		setSearchQuery,
		tags: tags ?? [],
		setTags,
		items: items ?? [],
		setItems,
		projects: projects ?? [],
		loading: loading
	};

	return (
		<TodoContext.Provider value={value}>
			<Head>
				<title>Todo | Dashboard</title>
			</Head>
			<BaseLayout session={session}>
				<div className="block h-full w-full md:hidden">
					<DashboardMainSection mobile={true} />
				</div>
				<div className="hidden h-full w-full md:block">
					<div className="flex h-full w-full flex-row">
						<DashboardMainSection mobile={false} />
					</div>
				</div>
			</BaseLayout>
		</TodoContext.Provider>
	);
};

export default Dashboard;
