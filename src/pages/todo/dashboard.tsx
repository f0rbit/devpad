import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import TodoNavbar from "@/components/Todo/TodoNavbar";
import { TaskTags } from "@prisma/client";
import React, { Context, useCallback, useContext, useEffect } from "react";
import { Dispatch, SetStateAction, useState } from "react";
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
};

export const TodoContext: Context<TodoContextType> = React.createContext({} as TodoContextType);

const DashboardMainSection = ({ mobile, showList }: { mobile: boolean, showList: boolean }) => {
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
	const { data: temp_tags } = trpc.tags.get_tags.useQuery();
	const [tags, setTags] = useState(undefined as TaskTags[] | undefined);

	useEffect(() => {
		if (temp_tags && !tags) {
			setTags(temp_tags);
		}
	}, [temp_tags, tags, setTags]);

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
		setTags
	};

	return (
		<TodoContext.Provider value={value}>
			<div className="h-screen min-h-full overflow-hidden bg-gray-700 dark:bg-pad-gray-900">
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
