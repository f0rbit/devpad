import { assessmentWeightValidator, FetchedClass, FetchedWork, ParsedClass, scheduleValidator } from "@/types/page-link";
import { UniversityClass, Work } from "@prisma/client";
import { Session } from "next-auth";
import { decode } from "punycode";
import { getErrorMessage } from "src/utils/backend";
import { getCurrentUser } from "src/utils/session";

const WorkInclude = { classes: { include: { assignments: true } } };

export async function getAllUserWork(): Promise<{ data: FetchedWork[]; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const projects = await prisma?.work.findMany({ where: { owner_id: user.id }, include: WorkInclude });
		if (!projects) return { data: [], error: "No work jobs found!" };
		return { data: projects.map((work) => decodeWork(work)), error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}

export function decodeWork(work: Work & { classes: FetchedClass[] }): FetchedWork {
	return { ...work, classes: work.classes?.map(decodeClass) };
}

export function decodeClass(university_class: FetchedClass) {
	return {
		...university_class,
		weights: assessmentWeightValidator.parse(university_class.weights),
		schedule: scheduleValidator.parse(university_class.schedule)
	};
}

export async function getUserWork(work_id: string, session?: Session): Promise<{ data: FetchedWork | null; error: string }> {
	const user = session?.user ?? (await getCurrentUser());
	if (!user || !user.id) return { data: null, error: "Not logged in!" };
	try {
		const work = await prisma?.work.findUnique({
			where: {
				owner_id_work_id: {
					owner_id: user.id,
					work_id
				}
			},
			include: WorkInclude
		});
		if (!work) return { data: null, error: "Work Job not found!" };
		return { data: decodeWork(work), error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}
