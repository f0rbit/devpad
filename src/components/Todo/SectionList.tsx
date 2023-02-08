import { TaskTags } from "@prisma/client";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo";
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

// TODO: refactor this file.

const FlatLinks = () => {
	const { selectedSection } = useContext(TodoContext);
	return (
		<div className="mt-2 hidden flex-col gap-1 md:flex">
			{links.map((link, index) => {
				return (
					<div key={index} className={"h-8 " + (selectedSection == link.url ? "text-pad-purple-400" : "")}>
						<SectionLink link={link} mobile={false} selected={selectedSection == link.url} />
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
					<div key={index} className="flex h-8 items-center justify-center rounded-md bg-gray-600 px-2 drop-shadow-md dark:bg-pad-gray-800">
						<SectionLink link={link} mobile={true} selected={selectedSection == link.url} />
					</div>
				);
			})}
		</div>
	);
};

const TagLinks = ({ expanded, tags }: { expanded: boolean; tags: TaskTags[] }) => {
	return (
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
	);
};

export const MainLinkSection = ({ expanded }: { expanded: boolean }) => {
	return (
		<TodoContext.Consumer>
			{({ tags, projects }) => (
				<div className="flex h-full w-full flex-none flex-col gap-1 bg-gray-700 px-4 pt-4 font-medium text-gray-400 dark:bg-base-bg-primary dark:text-base-text-subtle md:w-80">
					<SearchBox />
					<FlatLinks />
					<GroupedLinks />
					<CollapseableSection
						title={"Projects"}
						links={projects.map((project) => {
							return {
								title: project.name,
								description: project.project_id,
								url: "projects/" + project.project_id.toLowerCase()
							};
						})}
						mobile={!expanded}
					/>
					<TagLinks expanded={expanded} tags={tags} />
				</div>
			)}
		</TodoContext.Consumer>
	);
};
