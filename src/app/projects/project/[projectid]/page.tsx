import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import GoalInfo from "@/components/common/goals/GoalInfo";
import ProgressIndicator from "@/components/common/goals/ProgressIndicator";
import VersionIndicator from "@/components/common/VersionIndicator";
import GoalCard from "@/components/Projects/GoalCard";
import { ProjectCard } from "@/components/Projects/ProjectCard";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getProjectHistory, getUserProject } from "@/server/api/projects";
import { FetchedGoal, FetchedProject } from "@/types/page-link";
import { Action, TASK_VISIBILITY } from "@prisma/client";
import { getTaskProgress, getTasksProgress } from "src/utils/backend";
import { getSession } from "src/utils/session";

export default async function Page({ params }: { params: { projectid: string } }) {
	const { projectid } = params;

	const { data, error } = await getUserProject(projectid);
	const session = await getSession();

	if (!session) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={"Invalid Session!"} />
			</div>
		);
	}
	const history = await getProjectHistory(projectid, session);

	if (error?.length > 0 || history.error?.length > 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={error ?? history?.error} />
			</div>
		);
	}
	const project = data;

	if (!project) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message="Project not found" />
			</div>
		);
	}
	return (
		<div className="pt-4" style={{ width: "calc(100vw - 18rem)" }}>
			<TitleInjector title={project.name} />
			<CenteredContainer>
				<ProjectOverview project={data} history={history.data} />
			</CenteredContainer>
		</div>
	);
}

function ProjectOverview({ project, history }: { project: FetchedProject; history: Action[] }) {
	return (
		<div className="flex w-full flex-col gap-2 px-4 ">
			<div className="flex flex-row items-center justify-center gap-2">
				<h1 className="text-3xl font-semibold text-base-text-primary">{project.name}</h1>
				{project.current_version && <VersionIndicator version={project.current_version} />}
			</div>
			<div className="text-center text-base-text-subtlish">{project.description}</div>
			<textarea placeholder="Detailed Specification" className="scrollbar-hide h-48 text-base-text-subtlish"></textarea>
			<div className="flex w-full flex-col gap-1">
				<div className="text-center text-xl text-base-text-secondary">Goals Overview</div>
				<div>
					<GoalsOverview goals={project.goals} />
				</div>
			</div>
			<div className="flex w-full flex-col gap-1">
				<div className="text-center text-xl text-base-text-secondary">Recent Activity</div>
				<div>
					<RecentActivity history={history} />
				</div>
			</div>
		</div>
	);
}

function RecentActivity({ history }: { history: Action[] }) {
	return <pre>{JSON.stringify(history, null, 2)}</pre>;
}

function GoalsOverview({ goals }: { goals: FetchedGoal[] }) {
	const active_goals = goals.filter((goal) => goal.deleted == false);

	const previous_goals = active_goals.filter((a) => a.finished_at != null) as (FetchedGoal & { finished_at: string })[];
	previous_goals.sort((a, b) => new Date(b.finished_at).valueOf() - new Date(a.finished_at).valueOf());

	const future_goals = active_goals.filter((a) => a.finished_at == null);
	// sort goals by target time
	const sorted_goals = future_goals.sort((a, b) => new Date(a.target_time).valueOf() - new Date(b.target_time).valueOf());

	return (
		<div className="scrollbar-hide flex flex-row items-stretch gap-2 overflow-x-auto rounded-md border-1 border-borders-primary p-2">
			{previous_goals?.length > 0 && <div>Completed Goals: {previous_goals.length}</div>}
			{sorted_goals?.map((goal, key) => (
				<div key={key} className="h-full min-w-[24rem]">
					<GoalInfo goal={goal} />
					<ProgressIndicator progress={goal.tasks.length <= 0 ? 1 : getTasksProgress(goal.tasks.filter((task) => task.visibility != TASK_VISIBILITY.DELETED))} />
				</div>
			))}
		</div>
	);
}
