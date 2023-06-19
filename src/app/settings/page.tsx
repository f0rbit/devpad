import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { getAPIKeys } from "@/server/api/keys";

export default async function settings() {

	const { data, error } = await getAPIKeys();

	if (error && error.length > 1) {
		return (
		<CenteredContainer>
			<ErrorWrapper message={error} />
		</CenteredContainer>
		)
	}

	return (
		<CenteredContainer>
			<div className="py-4 text-base-text-subtlish">
				<h1 className="mb-2 text-center text-3xl font-bold text-base-text-secondary">Settings</h1>
				<pre>{ JSON.stringify(data) }</pre>
			</div>
		</CenteredContainer>
	);
}
