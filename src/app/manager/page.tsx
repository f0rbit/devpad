import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import WorkItems from "@/components/Work/WorkItems";
import { getAllUserWork } from "@/server/api/work";

export default async function manager() {
	const { data, error } = await getAllUserWork();

	if (error?.length > 0 || !data) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error ?? "An unknown error occurred."} />
			</CenteredContainer>
		);
	}

	return (
		<CenteredContainer>
			<div className="py-4 text-base-text-subtlish">
				<h1 className="mb-2 text-center text-3xl font-bold text-base-text-secondary">Work Items</h1>
				<WorkItems work={data} />
			</div>
		</CenteredContainer>
	);
}
