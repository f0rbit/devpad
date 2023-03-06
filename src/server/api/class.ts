import { FetchedClass, ParsedClass, UpdateUniversityClassAssignment } from "@/types/page-link";
import { ACTION_TYPE, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";
import { logger } from "src/utils/loggers";
import { createAction } from "./action";
import { decodeClass } from "./work";

export async function updateUniversityClass(university_class: ParsedClass, session: Session): Promise<{ data: ParsedClass | null; error: string | null }> {
	logger.debug("updateUniversityClass", { university_class, session });
	if (!session?.user?.id) return { data: null, error: "You must be signed in to update a university class." };
	try {
		const old_class = (await prisma?.universityClass.findUnique({
			where: {
				work_id_class_id_owner_id: {
					class_id: university_class.class_id,
					owner_id: session?.user?.id,
					work_id: university_class.work_id
				}
			},
			include: { assignments: true }
		})) as FetchedClass | null;
		if (!old_class) return { data: null, error: "Class could not be found." };
		const updatedClass =
			(await prisma?.universityClass.update({
				where: {
					work_id_class_id_owner_id: {
						class_id: university_class.class_id,
						owner_id: session?.user?.id,
						work_id: university_class.work_id
					}
				},
				data: {
					...university_class,
					updated_at: new Date(),
					schedule: university_class.schedule as Prisma.JsonArray,
					assignments: {
						upsert: university_class.assignments?.map((assignment) => ({
							where: {
								assignment_id: assignment.assignment_id == "new" ? randomUUID() : assignment.assignment_id
							},
							create: {
								name: assignment.name,
								due_date: assignment.due_date,
								weight: assignment.weight,
								description: assignment.description,
								finished_at: assignment.finished_at,
								group: assignment.group,
								result: assignment.result
							},
							update: {
								name: assignment.name,
								due_date: assignment.due_date,
								weight: assignment.weight,
								description: assignment.description,
								finished_at: assignment.finished_at,
								group: assignment.group,
								result: assignment.result
							}
						}))
					}
				},
				include: { assignments: true }
			})) ?? null;
		if (!updatedClass) return { data: null, error: "Class could not be updated." };
		const new_class = updatedClass as FetchedClass;
		// @ts-ignore - ignore the date to string conversion
		createAction({ description: `Updated class "${university_class.name}"`, type: ACTION_TYPE.UPDATE_CLASS, owner_id: session?.user?.id, data: { work_id: university_class.work_id, class_id: university_class.class_id, new_class, old_class } }); // writes an action as history
		return { data: decodeClass(new_class), error: null };
	} catch (error) {
		return { data: null, error: getErrorMessage(error) };
	}
}
