import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import RecentProjects from "@/components/Projects/RecentProjects";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getUserProjects } from "@/server/api/projects";
import { FetchedProject, FetchedTask, getModuleData, Module } from "@/types/page-link";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import moment from "moment";
import Link from "next/link";

export default async function HomePage() {
	const { data, error } = await getUserProjects({ includeDeleted: false });

	if (error?.length > 0 || !data) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error ?? "An unknown error occurred."} />
			</CenteredContainer>
		);
	}

	return (
		<CenteredContainer>
			<TitleInjector title="Home" />
			<div className="flex w-full flex-col justify-center gap-2 pt-8 text-center text-base-text-primary">
				<RecentProjects projects={data} />
				<div className="text-3xl font-bold">Weekly Tasks</div>
				<WeeklyTasks projects={data} />
			</div>
		</CenteredContainer>
	);
}

function WeeklyTasks({ projects }: { projects: FetchedProject[] }) {
	const weekly = new Map<FetchedProject, FetchedTask[]>();
	projects.forEach((project) => {
		weekly.set(
			project,
			project.goals.flatMap((goal) => goal.tasks.filter((task) => task.progress != TASK_PROGRESS.COMPLETED && task.visibility != TASK_VISIBILITY.DELETED && dueWithinWeek(task)))
		);
	});
	return (
		<div className="h-96 w-full rounded-xl border-1 border-borders-primary bg-base-accent-primary p-2">
			<div className="scrollbar-hide flex max-h-full max-w-full gap-2 overflow-auto">
				{Array.from(weekly.entries())
					.filter(([_project, tasks]) => tasks?.length > 0)
					.map(([project, tasks], index) => {
						return (
							<Link key={index} href={"/projects/project/" + project.project_id + "/goals"}>
								<div key={index} className="flex h-max min-w-[12rem] flex-shrink-0 flex-col gap-2 rounded-md border-1 border-borders-secondary px-4 py-1.5 transition-all duration-500 hover:bg-base-accent-secondary">
									<h3 className="text-xl font-semibold text-base-text-secondary">{project.name}</h3>
									<div className="flex h-max max-w-[24rem] flex-col justify-start gap-1 text-left text-base-text-subtlish">
										{tasks.map((task) => (
											<div key={task.id} className="flex flex-row items-center gap-2 text-left">
												<div className="w-max min-w-[6rem] text-xs text-base-text-subtle">{moment(getDueDate(task)).calendar({ sameElse: "DD/MM/yyyy" })}</div>
												<div>{task.title}</div>
											</div>
										))}
									</div>
								</div>
							</Link>
						);
					})}
			</div>
		</div>
	);
}

function dueWithinWeek(task: FetchedTask) {
	const now = new Date();
	const due = new Date(getDueDate(task));
	return now.valueOf() - due.valueOf() < 7 * 24 * 60 * 60 * 1000;
}

function getDueDate(task: FetchedTask): string {
	return getModuleData(task, Module.END_DATE)?.date;
}
