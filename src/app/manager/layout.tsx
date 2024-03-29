import BaseLayout from "@/components/layouts/BaseLayout";
import { getSession } from "src/utils/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
	const session = await getSession();
	return <BaseLayout children={children} session={session} />;
}
