import { updateUniversityClass } from "@/server/api/class";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const restricted = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { data, error } = await updateUniversityClass(JSON.parse(req.body), session);
		res.send({ data, error });
	} else {
		res.send({ data: null, error: "You must be signed in to access this route." });
	}
};

export default restricted;
