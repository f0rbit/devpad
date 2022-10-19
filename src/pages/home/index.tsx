import CenteredContainer from '@/components/CenteredContainer';
import HomeLayout from '@/components/layouts/HomeLayout';
import { NextPage } from 'next';
import HomeNavBar from '@/components/Home/HomeNavBar';
import ApplicationCard from '@/components/Home/ApplicationCard';
import ProjectManagerPhoto from '@/public/app_photos/project-manager.png';
import TrelloBoardPhoto from '@/public/app_photos/trello_board.png';
import TodoIcon from '@/public/todo-logo.png';
import ProjectIcon from '@/public/app_photos/manager-icon.png';
import Image from 'next/image';

const home: NextPage = () => {
    return (
        <HomeLayout title={'Home Page'}>
            <CenteredContainer>
                <HomeNavBar noicon={false} />
                <div className="relative mt-24 flex flex-row flex-nowrap">
                    <div className="relative left-0 flex w-24 justify-center">
                        <div className="h-full w-1 rounded-full bg-pad-purple-500"></div>
                    </div>
                    <div className="">
                        <ApplicationCard
                            reverse={false}
                            version={'In Development'}
                            icon={
                                <Image
                                    src={TodoIcon}
                                    width={96}
                                    height={96}
                                    alt={'Todo App Icon'}
                                />
                            }
                            title={'TODO'}
                            description={
                                'Automatically import TODOs from github source code. Set urgency and dates for deadlines. Apply tags in different scopes and groupings. Log changes and generate a timeline history.'
                            }
                            images={[TrelloBoardPhoto]}
                        />
                        <ApplicationCard
                            reverse={true}
                            version={'Not Started'}
                            icon={
                                <Image
                                    src={ProjectIcon}
                                    width={96}
                                    height={96}
                                    alt={'Project Manager Icon'}
                                />
                            }
                            title={'Project Organiser'}
                            description={
                                'Manages multiple TODO items at once. Schedule times for goals and achievements. Keep track of project versioning. In-built project progress tracker and history viewer'
                            }
                            images={[ProjectManagerPhoto]}
                        />
                        <ApplicationCard
                            reverse={false}
                            version={'Not Started'}
                            icon={
                                <Image
                                    src={ProjectIcon}
                                    width={96}
                                    height={96}
                                    alt={'Work Manager Icon'}
                                />
                            }
                            title={'Work Manager'}
                            description={
                                'This application manages repetitive schedules and assignments, for a Job or for Education. Schedule repeated meetings/classes, schedule time off and breaks. Track classes and meetings, write down notes in a built-in notepad and link to projects and todo items.'
                            }
                            images={[ProjectManagerPhoto]}
                        />
                    </div>
                </div>
            </CenteredContainer>
        </HomeLayout>
    );
};

export default home;
