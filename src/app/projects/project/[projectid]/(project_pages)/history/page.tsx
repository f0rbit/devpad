import CenteredContainer from "@/components/CenteredContainer";
import ErrorWrapper from "@/components/ErrorWrapper";
import InDevelopment from "@/components/layouts/InDevelopment";
import { getProjectHistory } from "@/server/api/projects";
import { getSession } from "src/utils/session";

export default async function HistoryPage({ params }: { params: { projectid: string } }) {
	const { projectid } = params;
	const session = await getSession();
	if (!session) return (
		<CenteredContainer>
			<ErrorWrapper message={"You must be signed in!"}/>
		</CenteredContainer>

	)
	const { data, error } = await getProjectHistory(projectid, session);

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	return (
		<div className="w-full h-full flex justify-center items-center">
			<pre>{JSON.stringify(data, null, 2)}</pre>
		</div>
	);
}
