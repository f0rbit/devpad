import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import GoalCard from "@/components/Projects/GoalCard";
import { getProjectGoals } from "@/server/api/projects";
import { getSession } from "src/utils/session";

export default async function GoalsPage({ params }: { params: { projectid: string } }) {
	const { projectid } = params;
	const session = await getSession();
	if (!session)
		return (
			<CenteredContainer>
				<ErrorWrapper message={"You must be signed in!"} />
			</CenteredContainer>
		);
	const { data, error } = await getProjectGoals(projectid, session);

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-full p-4">
			{/* <pre>{JSON.stringify(data, null, 2)}</pre> */}
			<div className="flex flex-row gap-2 h-max">
				{data.map((project, index) => (
					<GoalCard key={index} goal={project} project_id={projectid} />
				))}
				<GoalCard goal={null} project_id={projectid} />
			</div>
		</div>
	);
}
