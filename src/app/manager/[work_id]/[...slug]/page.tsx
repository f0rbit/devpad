import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import AssessmentOverview from "@/components/Work/AssessmentOverview";
import WeeklySchedule from "@/components/Work/WeeklySchedule";
import { getUserWork } from "@/server/api/work";
import { ParsedClass, ScheduledClass, ScheduleRepeat } from "@/types/page-link";
import { UniversityAssignment, UniversityClass, WORK_TYPE } from "@prisma/client";
import moment from "moment";
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
					<AssignmentOverview university_class={university_class} />
					<div>Readings</div>
					<div>Work Todo</div>
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

const assignments: UniversityAssignment[] = [
	{
		assignment_id: "random_uuid",
		name: "Textual Exercise",
		description: "Helen of Troy analysis",
		due_date: moment().add(10, "days").toDate(),
		created_at: moment().toDate(),
		updated_at: moment().toDate(),
		weight: 0.2,
		finished_at: null,
		class_id: "ancient-literature",
		group: "Textual Exercise",
		owner_id: "cldldcgyx0000r60c3u4wphs7",
		result: null,
		work_id: "2023-sem-1"
	},
	{
		assignment_id: "random_uuid",
		name: "Essay",
		description: "Role of the bard",
		due_date: moment().add(17, "days").toDate(),
		created_at: moment().toDate(),
		updated_at: moment().toDate(),
		weight: 0.3,
		finished_at: null,
		class_id: "ancient-literature",
		group: "Essay",
		owner_id: "cldldcgyx0000r60c3u4wphs7",
		result: null,
		work_id: "2023-sem-1"
	},
	{
		assignment_id: "random_uuid",
		name: "Tutorial",
		description: "Plato's Symposium",
		due_date: moment().add(24, "days").toDate(),
		created_at: moment().toDate(),
		updated_at: moment().toDate(),
		weight: 0.1,
		finished_at: null,
		class_id: "ancient-literature",
		group: "Tutorial",
		owner_id: "cldldcgyx0000r60c3u4wphs7",
		result: null,
		work_id: "2023-sem-1"
	},
	{
		assignment_id: "random_uuid",
		name: "Final Exam",
		description: "Final Exam",
		due_date: moment().add(31, "days").toDate(),
		created_at: moment().toDate(),
		updated_at: moment().toDate(),
		weight: 0.4,
		finished_at: null,
		class_id: "ancient-literature",
		group: "Final Exam",
		owner_id: "cldldcgyx0000r60c3u4wphs7",
		result: null,
		work_id: "2023-sem-1"
	}
];

function AssignmentOverview({ university_class }: { university_class: ParsedClass }) {
	return (
		<div className="relative my-2 mt-4 flex flex-col gap-4">
			<h2 className="text-center text-2xl font-semibold text-base-text-primary">Assignments</h2>
			<div className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-2 pb-2 pr-2">
				<Assignments assignments={university_class.assignments} />
			</div>
		</div>
	);
}

function Assignments({ assignments }: { assignments: UniversityAssignment[] }) {
	return (
		<div className="flex flex-wrap justify-center gap-2 ">
			{assignments.map((assignment) => (
				<div className="w-full max-w-[30%] rounded-md border-1 border-borders-primary bg-base-accent-primary py-2 pl-2 pr-4">
					<div className="-mt-1 flex flex-col gap-0">
						<div className="flex flex-row items-center gap-2 text-lg font-medium text-base-text-secondary">
							<span>{assignment.name}</span>
							<span className="text-sm text-base-text-dark">{assignment.weight * 100 + "%"}</span>
						</div>
						<div className="text-sm text-base-text-subtle">{assignment.description}</div>
					</div>
					<div>
						<div className="text-sm text-base-text-subtlish">{moment(assignment.due_date).calendar({ sameElse: "DD/MM/yyyy" })}</div>
					</div>
				</div>
			))}
		</div>
	);
}
