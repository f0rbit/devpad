import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import GoalInfo from "@/components/common/goals/GoalInfo";
import ProgressIndicator from "@/components/common/goals/ProgressIndicator";
import HistoryAction from "@/components/common/history/HistoryAction";
import VersionIndicator from "@/components/common/VersionIndicator";
import ProjectSpecification from "@/components/Projects/ProjectSpecification";
import TitleInjector from "@/components/Projects/TitleInjector";
import { getProjectHistory, getUserProject } from "@/server/api/projects";
import { FetchedGoal, FetchedProject } from "@/types/page-link";
import { Action, TASK_VISIBILITY } from "@prisma/client";
import moment from "moment";
import { getTasksProgress } from "src/utils/backend";
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
		<div className="overflow-y-auto pt-4" style={{ width: "calc(100vw - 18rem)", maxHeight: "calc(100vh - 65px)" }}>
			<TitleInjector title={project.name} />
			<CenteredContainer>
				<ProjectOverview project={data} history={history.data} />
			</CenteredContainer>
		</div>
	);
}

function ProjectOverview({ project, history }: { project: FetchedProject; history: Action[] }) {
	return (
		<div className="mb-4 flex w-full flex-col gap-2 px-4 ">
			<div className="flex flex-row items-center justify-center gap-2">
				<h1 className="text-3xl font-semibold text-base-text-primary">{project.name}</h1>
				{project.current_version && <VersionIndicator version={project.current_version} />}
			</div>
			<div className="text-center text-base-text-subtlish">{project.description}</div>
			<ProjectSpecification initial_project={project} />
			<div className="flex w-full flex-col gap-1">
				<div className="text-center text-xl text-base-text-secondary">Goals Overview</div>
				<div>
					<GoalsOverview goals={project.goals} />
				</div>
			</div>
			<div className="flex w-full flex-col gap-1">
				<div className="text-center text-xl text-base-text-secondary">Recent Activity</div>
				<div className="scrollbar-hide max-h-[16rem] overflow-y-auto rounded-md border-1 border-borders-primary p-2">
					<RecentActivity history={history} />
				</div>
			</div>
		</div>
	);
}

function RecentActivity({ history }: { history: Action[] }) {
	// take the most recent 4 actions
	const recent = history.sort((a, b) => new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf());
	const most_recent = recent.at(0);
	if (recent.length == 0 || !most_recent) return <div className="text-center text-base-text-subtlish">No recent activity</div>;
	// get the day of the most recent activity
	const most_recent_day = moment(most_recent.created_at);
	console.log(most_recent_day);

	// get the actions that are on the recent day, keeping them sorted by time
	const recent_actions = recent.filter((a) => moment(a.created_at).isSame(most_recent_day, "day"));
	console.log({ recent_actions });

	return (
		<div className=" relative flex flex-col justify-center gap-2">
			{recent_actions.map((action, key) => (
				// <HistoryAction key={key} action={action} drawIcon={false} className="px-2" />
				<div className="flex flex-row items-center gap-4" key={key}>
					<time dateTime={action.created_at.toUTCString()} className="w-max min-w-[10rem] text-right text-sm text-base-text-subtle">
						{moment(action.created_at).calendar()}
					</time>
					<summary className="contents appearance-none text-lg text-base-text-secondary">{action.description}</summary>
				</div>
			))}
		</div>
	);
	// return <pre>{JSON.stringify(history, null, 2)}</pre>;
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
			{previous_goals?.length > 0 && (
				<div className="flex min-w-[6rem] flex-col items-center justify-center rounded-md border-1 border-borders-secondary p-2 pt-0">
					<h5 className="text-2xl font-bold text-base-text-subtlish">{previous_goals.length}</h5>
					<caption className="text-sm text-base-text-subtle">Completed</caption>
				</div>
			)}
			{sorted_goals?.map((goal, key) => (
				<div key={key} className="h-full min-w-[24rem] rounded-md border-1 border-borders-secondary p-2 pt-0">
					<GoalInfo goal={goal} />
					<ProgressIndicator progress={goal.tasks.length <= 0 ? 1 : getTasksProgress(goal.tasks.filter((task) => task.visibility != TASK_VISIBILITY.DELETED))} />
				</div>
			))}
		</div>
	);
}
