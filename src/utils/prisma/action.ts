import { Action, ACTION_TYPE, Prisma } from "@prisma/client";

export async function createAction(data: Prisma.ActionUncheckedCreateInput) {
    const action = await prisma?.action.create({ data });
    return action;
}