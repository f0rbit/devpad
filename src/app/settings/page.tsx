import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { getAPIKeys } from "@/server/api/keys";
import { getCurrentUser } from "src/utils/session";
import { SettingsPage } from "./client";

export default async function settings() {
	const user = await getCurrentUser();

	if (!user || !user.id) {
		return (
			<CenteredContainer>
				<ErrorWrapper message="You must be logged in to view this page." />
			</CenteredContainer>
		);
	}

	const { data, error } = await getAPIKeys();

	if (error && error.length > 1) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	if (!data || !user?.id) {
		return (
			<CenteredContainer>
				<ErrorWrapper message="An unknown error occurred." />
			</CenteredContainer>
		);
	}

	return <SettingsPage initial_tags={data} user_id={user?.id} />;
}
