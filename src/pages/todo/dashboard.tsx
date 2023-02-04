import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import TodoNavbar from "@/components/Todo/TodoNavbar";
import { TaskTags } from "@prisma/client";
import Head from "next/head";
import React, { Context, useCallback, useContext, useEffect } from "react";
import { Dispatch, SetStateAction, useState } from "react";
import { FetchedTask, trpc } from "src/utils/trpc";

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
};

export const TodoContext: Context<TodoContextType> = React.createContext({} as TodoContextType);

const DashboardMainSection = ({ mobile, showList }: { mobile: boolean; showList: boolean }) => {
	if (mobile) return showList ? <MainLinkSection expanded={false} /> : <ListRenderer />;
	return (
		<>
			{showList && <MainLinkSection expanded={true} />}
			<ListRenderer />
		</>
	);
};

const Dashboard = () => {
	const [showList, setShowList] = useState(true);
	const [selectedSection, setSelectedSection] = useState("current");
	const [searchQuery, setSearchQuery] = useState("");
	const { data } = trpc.data.getItemsAndTags.useQuery();
	const [tags, setTags] = useState(undefined as TaskTags[] | undefined);
	const [items, setItems] = useState(undefined as FetchedTask[] | undefined)

	useEffect(() => {
		if (data?.tags && !tags) {
			setTags(data?.tags);
		}
		if (data?.items && !items) {
			setItems(data?.items);
		}
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
		setItems
	};

	return (
		<TodoContext.Provider value={value}>
			<Head>
				<title>Todo | Dashboard</title>
			</Head>
			<div className="h-screen min-h-full overflow-hidden bg-gray-700 dark:bg-base-bg-primary">
				<div>
					<TodoNavbar />
				</div>
				<div className="block h-full w-full md:hidden">
					<DashboardMainSection mobile={true} showList={showList} />
				</div>
				<div className="hidden h-full w-full md:block">
					<div className="flex h-full w-full flex-row">
						<DashboardMainSection mobile={false} showList={showList} />
					</div>
				</div>
			</div>
		</TodoContext.Provider>
	);
};

export default Dashboard;
