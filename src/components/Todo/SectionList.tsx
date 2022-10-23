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
    return (
        <div className="hidden md:flex flex-col gap-1 mt-2">
            {links.map((link, index) => {
                return (
                    <div key={index} className="h-8">
                        <SectionLink link={link} mobile={false}/>
                    </div>
                );
            })}
        </div>
    );
};
const GroupedLinks = () => {
    return (
        <div className="grid grid-cols-2 md:hidden gap-2 mt-4 mb-2">
            {links.map((link, index) => {
                return (
                    <div key={index} className="h-8 bg-gray-300 dark:bg-pad-gray-800 rounded-md flex justify-center items-center drop-shadow-md">
                        <SectionLink link={link} mobile={true} />
                    </div>
                );
            })}
        </div>
    );
};

export const MainLinkSection = ({expanded}: { expanded: boolean }) => {
    console.log(expanded);
    return (
        <div className="flex h-full w-full flex-col gap-1 bg-gray-200 dark:bg-pad-gray-900 px-4 md:w-64 font-medium">
            <FlatLinks />
            <GroupedLinks />
            <CollapseableSection title={"Projects"} links={projects} mobile={!expanded}/>
            <CollapseableSection title={"Tags"} links={tags} mobile={!expanded}/>
        </div>
    );
};
