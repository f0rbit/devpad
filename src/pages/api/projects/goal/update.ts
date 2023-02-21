import { updateProjectGoal } from "@/server/api/goals";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const update_goal = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });
    if (!session) {
        res.send({ error: "You must be signed in to access this route." });
        return;
    }
    const { data, error } = await updateProjectGoal(JSON.parse(req.body), session);
    res.send({ data, error });
};

export default update_goal;
