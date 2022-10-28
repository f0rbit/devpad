import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import TodoNavbar from "@/components/Todo/TodoNavbar";
import { TODO_Tags } from "@prisma/client";
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
	tags: TODO_Tags[];
	setTags: Dispatch<SetStateAction<TODO_Tags[] | undefined>>;
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
	var { data: _tags } = trpc.todo.getTags.useQuery();
	const [tags, setTags] = useState(undefined as TODO_Tags[] | undefined);

	const toggleList = () => {
		setShowList(!showList);
	};

	if (_tags && !tags) {
		setTags(_tags);
	}

	const tagsOrEmpty = tags || ([] as TODO_Tags[]);
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
				tags: tagsOrEmpty,
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
