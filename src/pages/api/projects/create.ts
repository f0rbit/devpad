import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { CreateProjectType } from "@/types/page-link";
import { NextApiRequest, NextApiResponse } from "next";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";

const restricted = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { data, error } = await createProject(JSON.parse(req.body), session);
		res.send({
			project_id: data,
			error
		});
	} else {
		res.send({
			error: "You must be signed in to access this route."
		});
	}
};

// create a project
export const createProject = async (project: CreateProjectType, session: Session): Promise<{ data: string | null; error: string | null }> => {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
    try {
        const result = await prisma?.project.create({
            data: {
                ...project,
                owner_id: session?.user?.id
            },
            select: {
                project_id: true
            }
        });
        if (result?.project_id) {
            return {
                data: result.project_id,
                error: null
            };
        } else {
            return {
                data: null,
                error: "Project could not be created."
            };
        }
    } catch (err) {
        return {
            data: null,
            error: getErrorMessage(err)
        };
    }
};

export default restricted;
