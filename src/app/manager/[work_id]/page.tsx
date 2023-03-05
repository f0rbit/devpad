import CenteredContainer from "@/components/common/CenteredContainer";
import ErrorWrapper from "@/components/common/ErrorWrapper";
import GenericButton from "@/components/common/GenericButton";
import WeeklySchedule from "@/components/Work/WeeklySchedule";
import { getUserWork } from "@/server/api/work";
import { FetchedWork, ScheduledClass, ScheduledClasses } from "@/types/page-link";
import { WORK_TYPE } from "@prisma/client";
import Link from "next/link";
import { getSession } from "src/utils/session";

export default async function WorkPage({ params }: { params: { work_id: string } }) {
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
			// render university page
			return (
				<CenteredContainer>
					<UniversityPage data={data} />
				</CenteredContainer>
			);
		case WORK_TYPE.WORK:
			// render a work page
			break;
		case WORK_TYPE.GENERIC:
		default:
		// render the generic page
	}

	return (
		<CenteredContainer>
			<ErrorWrapper message={"An unknown error occurred."} />
		</CenteredContainer>
	);
}

function UniversityPage({ data }: { data: FetchedWork }) {
	const schedule = data.classes.flatMap((university_class) => {
		return (
			university_class.schedule?.map((schedule) => {
				return {
					...schedule,
					class_id: university_class.class_id,
					class_name: university_class.name,
					class_department: university_class.class_department,
					class_number: university_class.class_number
				};
			}) ?? []
		);
	}) as ScheduledClass[];

	return (
		<>
			<div className="my-4 flex flex-col items-center justify-center gap-1">
				<h1 className="text-3xl font-bold text-base-text-primary">{data.name}</h1>
				<div className="-mt-1 -mb-2 text-xs text-base-text-dark">{data.type}</div>
				<p className="text-base-text-subtlish">{data.description}</p>
			</div>
			<div className={"grid flex-wrap justify-items-center gap-2 " + (data.classes.length % 3 == 0 ? "grid-cols-3" : "grid-cols-2")}>
				{data.classes.map((university_class, index) => {
					return (
						<Link href={"/manager/" + data.work_id + "/" + university_class.class_id} className="contents w-full">
							<GenericButton key={index} style="flex w-full flex-col gap-1">
								<h2 className="text-left text-xl text-base-text-secondary">{university_class.name}</h2>
								<pre className="-mt-2 text-xs text-base-text-dark">{university_class.class_id}</pre>
								<div className="text-base-text-subtlish">
									<span>{university_class.class_department}</span>
									<span> </span>
									<span>{university_class.class_number}</span>
								</div>
								<p className="w-full truncate text-sm text-base-text-subtle">{university_class.description}</p>
							</GenericButton>
						</Link>
					);
				})}
			</div>
			{schedule && (
				<div className="relative my-2 mt-4 flex flex-col gap-4">
					<h2 className="text-center text-2xl font-semibold text-base-text-primary">Schedule</h2>
					<div className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-2 pb-2 pr-2">
						<WeeklySchedule classes={schedule} />
					</div>
				</div>
			)}
		</>
	);
}
