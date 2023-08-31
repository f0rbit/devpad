import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import { getProject } from "@/server/api/projects";
import { getUserTags } from "@/server/api/tags";
import { Newspaper } from "lucide-react";
import { getSession } from "src/utils/session";

export default async function RoadmapPage({ params }: { params: { projectid: string }}) {
    const { projectid } = params;
	const session = await getSession();
	if (!session)
		return (
			<CenteredContainer>
				<ErrorWrapper message={"You must be signed in!"} />
			</CenteredContainer>
		);
	const { data: project, error: project_error } = await getProject(projectid, session);
	const { data: tags_data, error: tags_error } = await getUserTags(session);

	const error = project_error ?? tags_error;

	if (error?.length > 0) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error} />
			</CenteredContainer>
		);
	}

	if (!project) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={"Error fetching project"} />
			</CenteredContainer>
		);
	}

	return (
		<div className="flex h-full w-max p-4">
			<pre>{JSON.stringify(project, null, 2)}</pre>
            <CenteredContainer>
                <div className="styled-input flex flex-col items-center justify-center gap-1 rounded-md border-1 border-borders-secondary pt-1 pb-2">
                    <div className="mb-2 w-full border-b-1 border-b-borders-secondary pb-1 text-center font-semibold text-base-text-primary">Project Settings</div>
                    <div className="flex w-full flex-col gp-2 px-2 text-base-text-subtlish">
                        <div className="flex flex-row items-center gap-2">
                            <Newspaper className="w-5" />
                            <input type="text" placeholder="Description" className="flex-1 rounded-md border-1 border-borders-secondary p-2" />
                        </div>
                    </div>
                </div>
            </CenteredContainer>
		</div>
	);
}
