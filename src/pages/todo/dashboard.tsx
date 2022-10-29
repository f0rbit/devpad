import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import TodoNavbar from "@/components/Todo/TodoNavbar";
import { TaskTags } from "@prisma/client";
import React, { Context, useReducer } from "react";
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

export const TodoContext: Context<TodoContextType> = React.createContext(
	{} as TodoContextType
);

const DashboardMainSection = ({ mobile }: { mobile: boolean }) => {
	return (
		<TodoContext.Consumer>
			{({ showList }) => {
				const objects = [];
				if (mobile) {
					if (showList) {
						objects.push(
							<MainLinkSection key={0} expanded={false} />
						);
					} else {
						objects.push(<ListRenderer key={1} />);
					}
				} else {
					if (showList)
						objects.push(
							<MainLinkSection key={0} expanded={true} />
						);
					objects.push(<ListRenderer key={1} />);
				}
				return objects;
			}}
		</TodoContext.Consumer>
	);
};

const Dashboard = () => {
	const [showList, setShowList] = useState(true);
	const [selectedSection, setSelectedSection] = useState("current");
	const [searchQuery, setSearchQuery] = useState("");
	var { data: temp_tags } = trpc.tags.get_tags.useQuery();
	const [tags, setTags] = useState(undefined as TaskTags[] | undefined);

	const toggleList = () => {
		setShowList(!showList);
	};

	// will set tags to the data gotten from trpc if tags is empty
	// i think this is incorrect?
	// TODO: investigate this.
	if (temp_tags && !tags) {
		setTags(temp_tags);
	}

	const tags_or_empty = tags || ([] as TaskTags[]);
	return (
		<TodoContext.Provider
			value={{
				showList,
				setShowList,
				selectedSection,
				setSelectedSection,
				toggleList,
				searchQuery,
				setSearchQuery,
				tags: tags_or_empty,
				setTags
			}}
		>
			<div className="h-screen min-h-full overflow-hidden ">
				<div className="">
					<TodoNavbar />
				</div>
				<div className="block h-full w-full md:hidden">
					<DashboardMainSection mobile={true} />
				</div>
				<div className="hidden h-full w-full md:block">
					<div className="flex h-full w-full flex-row">
						<DashboardMainSection mobile={false} />
					</div>
				</div>
			</div>
		</TodoContext.Provider>
	);
};

export default Dashboard;
