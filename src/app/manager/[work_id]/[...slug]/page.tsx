import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import AssessmentOverview from "@/components/Work/AssessmentOverview";
import ClassInterface from "@/components/Work/ClassInterface";
import WeeklySchedule from "@/components/Work/WeeklySchedule";
import { getUserWork } from "@/server/api/work";
import { ParsedClass } from "@/types/page-link";
import { WORK_TYPE } from "@prisma/client";
import { getSession } from "src/utils/session";

export default async function SubWorkPage({ params }: { params: { work_id: string; slug: any } }) {
	const { work_id } = params;

	const session = await getSession();

	if (!session) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorWrapper message={"Invalid Session!"} />
			</div>
		);
	}

	const { data, error } = await getUserWork(work_id, session);

	if (error?.length > 0 || !data) {
		return (
			<CenteredContainer>
				<ErrorWrapper message={error ?? "An unknown error occurred."} />
			</CenteredContainer>
		);
	}

	switch (data.type) {
		case WORK_TYPE.UNIVERSITY:
			// first argument of slug is the class id
			const class_id = params.slug[0];
			const university_class = data.classes.find((c) => c.class_id === class_id);
			if (!university_class) {
				return (
					<CenteredContainer>
						<ErrorWrapper message={"Invalid Class ID!"} />
					</CenteredContainer>
				);
			}

			return (
				<CenteredContainer>
					<h1 className="my-4 text-center text-3xl font-semibold text-base-text-primary">
						<span>{university_class.class_department + " " + university_class.class_number}</span>
						<span> - </span>
						<span>{university_class.name}</span>
					</h1>
					<AssessmentOverview university_class={university_class} />
					{/* <div>Schedule</div> */}
					<ScheduleOverview university_class={university_class} />
					<div>Assignments</div>
					{/* <AssignmentOverview university_class={university_class} />
					<div>Readings</div>
					<div>Work Todo</div> */}
					<ClassInterface initial_class={university_class} />
				</CenteredContainer>
			);
		default:
			return <pre>{JSON.stringify(params, null, 2)}</pre>;
	}
}

function ScheduleOverview({ university_class }: { university_class: ParsedClass }) {
	const schedule = university_class.schedule;

	if (!schedule) {
		return <div>No Schedule</div>;
	}
	return (
		<div className="relative my-2 mt-4 flex flex-col gap-4">
			<h2 className="text-center text-2xl font-semibold text-base-text-primary">Schedule</h2>
			<div className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-2 pb-2 pr-2">
				<WeeklySchedule classes={schedule} />
			</div>
		</div>
	);
}
