import ListRenderer from "@/components/Todo/ListRenderer";
import { MainLinkSection } from "@/components/Todo/SectionList";
import TodoNavbar from "@/components/Todo/TodoNavbar";
import { NextPage } from "next";
import React, { Context } from "react";
import { Dispatch, SetStateAction, useState } from "react";

type TodoContextType = {
	showList: boolean;
	setShowList: Dispatch<SetStateAction<boolean>>;
	selectedSection: string;
	setSelectedSection: Dispatch<SetStateAction<string>>;
	toggleList: () => void;
	searchQuery: string;
	setSearchQuery: Dispatch<SetStateAction<string>>;
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

const Dashboard: NextPage = () => {
	const [showList, setShowList] = useState(true);
	const [selectedSection, setSelectedSection] = useState("current");
	const [searchQuery, setSearchQuery] = useState("");

	const toggleList = () => {
		setShowList(!showList);
	};

	return (
		<TodoContext.Provider
			value={{
				showList,
				setShowList,
				selectedSection,
				setSelectedSection,
				toggleList,
				searchQuery,
				setSearchQuery
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
