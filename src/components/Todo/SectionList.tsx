import { Search } from "lucide-react";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import CollapseableSection from "./CollapseableSection";
import { SearchBox } from "./SearchBox";
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

// TODO: refactor this file.

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
						className="px-2 flex h-8 items-center justify-center rounded-md bg-gray-600 drop-shadow-md dark:bg-pad-gray-800"
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

const TagLinks = ({ expanded }: { expanded: boolean }) => {
	return (
		<TodoContext.Consumer>
			{({ tags }) => (
				<CollapseableSection
					title={"Tags"}
					links={tags.map((tag) => {
						return {
							title: tag.title,
							description: tag.title,
							url: "tags/" + tag.title.toLowerCase()
						};
					})}
					mobile={!expanded}
				/>
			)}
		</TodoContext.Consumer>
	);
};

export const MainLinkSection = ({ expanded }: { expanded: boolean }) => {
	return (
		<TodoContext.Consumer>
			{({ tags }) => (
				<div className="flex h-full w-full flex-none flex-col gap-1 bg-gray-700 px-4 font-medium dark:bg-base-bg-primary md:w-80 text-gray-400 dark:text-base-text-subtle">
					<SearchBox />
					<FlatLinks />
					<GroupedLinks />
					<CollapseableSection
						title={"Projects"}
						links={projects}
						mobile={!expanded}
					/>
					<TagLinks expanded={expanded} />
				</div>
			)}
		</TodoContext.Consumer>
	);
};
