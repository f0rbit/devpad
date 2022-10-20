import CenteredContainer from "@/components/CenteredContainer";
import HomeLayout from "@/components/layouts/HomeLayout";
import { NextPage } from "next";
import HomeNavBar from "@/components/Home/HomeNavBar";
import ApplicationCard from "@/components/Home/ApplicationCard";
import ProjectManagerPhoto from "@/public/app_photos/project-manager.png";
import TrelloBoardPhoto from "@/public/app_photos/trello_board.png";
import TodoIcon from "@/public/todo-logo.png";
import ProjectIcon from "@/public/app_photos/manager-icon.png";
import UniTimetable from "@/public/app_photos/mytimetable.png";
import JobManagerIcon from "@/public/app_photos/job-manager.png";
import Image from "next/image";

const home: NextPage = () => {
    const getSubDomain = (sub: string) => {
        const host =
            typeof window != "undefined"
                ? window.location.hostname
                : "localhost:3000";
        const protocol =
            typeof window != "undefined" ? window.location.protocol : "http";
        return protocol + "://" + sub + "." + host;
    };
    return (
        <HomeLayout title={"Home Page"}>
            <div className="relative mt-24 mb-12 flex flex-row flex-nowrap">
                <div className="relative left-0 hidden w-24 justify-center lg:flex ">
                    <div
                        style={{ height: "calc(100% - 30px)" }}
                        className="w-1 rounded-full bg-pad-purple-500"
                    ></div>
                </div>
                <div className="">
                    <ApplicationCard
                        reverse={false}
                        version={"In Development"}
                        icon={
                            <Image
                                src={TodoIcon}
                                width={96}
                                height={96}
                                alt={"Todo App Icon"}
                            />
                        }
                        title={"TODO"}
                        description={
                            "Automatically import TODOs from github source code. Set urgency and dates for deadlines. Apply tags in different scopes and groupings. Log changes and generate a timeline history."
                        }
                        images={[TrelloBoardPhoto]}
                        link={getSubDomain("todo")}
                    />
                    <ApplicationCard
                        reverse={true}
                        version={"Not Started"}
                        icon={
                            <Image
                                src={ProjectIcon}
                                width={96}
                                height={96}
                                alt={"Project Manager Icon"}
                            />
                        }
                        title={"Project Organiser"}
                        description={
                            "Manages multiple TODO items at once. Schedule times for goals and achievements. Keep track of project versioning. In-built project progress tracker and history viewer"
                        }
                        images={[ProjectManagerPhoto]}
                        link={getSubDomain("projects")}
                    />
                    <ApplicationCard
                        reverse={false}
                        version={"Not Started"}
                        icon={
                            <Image
                                src={JobManagerIcon}
                                width={96}
                                height={96}
                                alt={"Work Manager Icon"}
                            />
                        }
                        title={"Work Manager"}
                        description={
                            "This application manages repetitive schedules and assignments, for a Job or for Education. Schedule repeated meetings/classes, schedule time off and breaks. Track classes and meetings, write down notes in a built-in notepad and link to projects and todo items."
                        }
                        images={[UniTimetable]}
                        link={getSubDomain("manager")}
                    />
                    <ApplicationCard
                        reverse={true}
                        version={"Not Started"}
                        icon={
                            <Image
                                src={ProjectIcon}
                                width={96}
                                height={96}
                                alt={"Calendar Icon"}
                            />
                        }
                        title={"Calendar"}
                        description={
                            "Schedule meetings, keep track of birthdays. Schedule reminders, and remind you before the reminder. Hold ideas for birthday gifts and setup automatic birthday reminders. Keep a hold of tickets and scheduled event information"
                        }
                        images={[]}
                        link={getSubDomain("calendar")}
                    />
                    <ApplicationCard
                        reverse={false}
                        version={"Not Started"}
                        icon={
                            <Image
                                src={ProjectIcon}
                                width={96}
                                height={96}
                                alt={"Diary Icon"}
                            />
                        }
                        title={"Diary"}
                        description={
                            "Offers a comprehensive timeline. Shows a history of TODO completions, keep track of commitment and visual feedback on staying on track. See upcoming project & job dates, go back in time and see your history. Store life events and link files and images. See all your git commits together, and configure a custom media timeline."
                        }
                        images={[]}
                        link={getSubDomain("diary")}
                    />
                </div>
            </div>
        </HomeLayout>
    );
};

export default home;
