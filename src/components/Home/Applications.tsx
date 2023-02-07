import ProjectManagerPhoto from "@/public/app_photos/project-manager.png";
import TrelloBoardPhoto from "@/public/app_photos/trello_board.png";
import TodoIcon from "@/public/todo-logo.png";
import ProjectIcon from "@/public/app_photos/manager-icon.png";
import UniTimetable from "@/public/app_photos/mytimetable.png";
import JobManagerIcon from "@/public/app_photos/job-manager.png";
import Image, { StaticImageData } from "next/image";
import { Application, ApplicationVersion } from "@/types/applications";

const getIcon = (path: StaticImageData, alt: string) => {
	return <Image src={path} width={96} height={96} alt={alt} />;
};

const APPLICATIONS: Application[] = [
	{
        index: 0,
		version: ApplicationVersion.IN_DEVELOPMENT,
		icon: getIcon(TodoIcon, "Todo App Icon"),
		title: "TODO",
		description: "Automatically import TODOs from github source code. Set urgency and dates for deadlines. Apply tags in different scopes and groupings. Log changes and generate a timeline history.",
		images: [TrelloBoardPhoto],
		link: "/todo"
	},
	{
        index: 1,
		version: ApplicationVersion.NOT_STARTED,
		icon: getIcon(ProjectIcon, "Project Manager Icon"),
		title: "Project Organiser",
		description: "Manages multiple TODO items at once. Schedule times for goals and achievements. Keep track of project versioning. In-built project progress tracker and history viewer",
		images: [ProjectManagerPhoto],
		link: "/projects"
	},
	{
        index: 2,
		version: ApplicationVersion.NOT_STARTED,
		icon: getIcon(JobManagerIcon, "Work Manager Icon"),
		title: "Work Manager",
		description:
			"This application manages repetitive schedules and assignments, for a Job or for Education. Schedule repeated meetings/classes, schedule time off and breaks. Track classes and meetings, write down notes in a built-in notepad and link to projects and todo items.",
		images: [UniTimetable],
		link: "/manager"
	},
	{
        index: 3,
		version: ApplicationVersion.NOT_STARTED,
		icon: getIcon(ProjectIcon, "Calendar Icon"),
		title: "Calendar",
		description: "Schedule meetings, keep track of birthdays. Schedule reminders, and remind you before the reminder. Hold ideas for birthday gifts and setup automatic birthday reminders. Keep a hold of tickets and scheduled event information",
		images: [],
		link: "/calendar"
	},
	{
        index: 4,
		version: ApplicationVersion.NOT_STARTED,
		icon: getIcon(ProjectIcon, "Diary Icon"),
		title: "Diary",
		description:
			"Offers a comprehensive timeline. Shows a history of TODO completions, keep track of commitment and visual feedback on staying on track. See upcoming project & job dates, go back in time and see your history. Store life events and link files and images. See all your git commits together, and configure a custom media timeline.",
		images: [],
		link: "/diary"
	}
];

export default APPLICATIONS;
