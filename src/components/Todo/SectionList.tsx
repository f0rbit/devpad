import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import CollapseableSection from "./CollapseableSection";
import SectionLink, { SectionLinkType } from "./SectionItem";

const links: SectionLinkType[] = [
	{
		title: "Current",
		description: "Current tasks",
		icon: "⏱",
		url: "current"
	},
	{
		title: "Recent",
		description: "Recently created tasks",
		icon: "📝",
		url: "recent"
	},
	{
		title: "Upcoming",
		description: "Upcoming tasks",
		icon: "📅",
		url: "upcoming"
	},
	{
		title: "Urgent",
		description: "Urgent tasks",
		icon: "🚨",
		url: "urgent"
	}
];

const projects: SectionLinkType[] = [
	{
		title: "Project 1",
		description: "Project 1",
		url: "projects/project_1"
	},
	{
		title: "Project 2",
		description: "Project 2",
		url: "projects/project_2"
	},
	{
		title: "Project 3",
		description: "Project 3",
		url: "projects/project_3"
	}
];

const tags: SectionLinkType[] = [
	{
		title: "Tag 1",
		description: "Tag 1",
		url: "tags/tag_1"
	},
	{
		title: "Tag 2",
		description: "Tag 2",
		url: "tags/tag_2"
	}
];

const FlatLinks = () => {
	const { selectedSection } = useContext(TodoContext);
	return (
		<div className="mt-2 hidden flex-col gap-1 md:flex">
			{links.map((link, index) => {
				return (
					<div
						key={index}
						className={
							"h-8 " +
							(selectedSection == link.url
								? "text-pad-purple-400"
								: "")
						}
					>
						<SectionLink
							link={link}
							mobile={false}
							selected={selectedSection == link.url}
						/>
					</div>
				);
			})}
		</div>
	);
};
const GroupedLinks = () => {
	const { selectedSection } = useContext(TodoContext);
	return (
		<div className="mt-4 mb-2 grid grid-cols-2 gap-2 md:hidden">
			{links.map((link, index) => {
				return (
					<div
						key={index}
						className="flex h-8 items-center justify-center rounded-md bg-gray-300 drop-shadow-md dark:bg-pad-gray-800"
					>
						<SectionLink
							link={link}
							mobile={true}
							selected={selectedSection == link.url}
						/>
					</div>
				);
			})}
		</div>
	);
};

export const MainLinkSection = ({ expanded }: { expanded: boolean }) => {
	return (
		<div className="flex h-full w-full flex-col gap-1 bg-gray-200 px-4 font-medium dark:bg-pad-gray-900 md:w-64">
			<FlatLinks />
			<GroupedLinks />
			<CollapseableSection
				title={"Projects"}
				links={projects}
				mobile={!expanded}
			/>
			<CollapseableSection
				title={"Tags"}
				links={tags}
				mobile={!expanded}
			/>
		</div>
	);
};
