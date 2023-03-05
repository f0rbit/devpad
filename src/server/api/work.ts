import { assessmentWeightValidator, FetchedWork, scheduleValidator } from "@/types/page-link";
import { UniversityClass, Work } from "@prisma/client";
import { Session } from "next-auth";
import { decode } from "punycode";
import { getErrorMessage } from "src/utils/backend";
import { getCurrentUser } from "src/utils/session";

export async function getAllUserWork(): Promise<{ data: FetchedWork[]; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const projects = await prisma?.work.findMany({ where: { owner_id: user.id }, include: { classes: true } });
		if (!projects) return { data: [], error: "No work jobs found!" };
		return { data: projects.map((work) => decodeWork(work)), error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}

export function decodeWork(work: Work & { classes: UniversityClass[] }): FetchedWork {
	return {
		...work,
		classes: work.classes?.map((class_) => {
			return {
				...class_,
				weights: assessmentWeightValidator.parse(class_.weights),
				schedule: scheduleValidator.parse(class_.schedule)
			};
		})
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
			include: {
				classes: true
			}
		});
		if (!work) return { data: null, error: "Work Job not found!" };
		return { data: decodeWork(work), error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}
