import CenteredContainer from "@/components/common/CenteredContainer";
import { NextPage } from "next";
import { useSession } from "next-auth/react";
import Head from "next/head";

const profile: NextPage = () => {
	const { data: session, status } = useSession();
	var darkMode = false;
	if (typeof localStorage !== "undefined") {
		var root = document.getElementsByTagName("html")[0];
		root?.classList?.remove("dark");
		root?.classList?.add(localStorage.getItem("darkMode") === "true" ? "dark" : "light");
		darkMode = localStorage.getItem("darkMode") === "true";
	}

	return (
		<div className="h-screen w-screen items-center">
			<CenteredContainer>
				<Head>
					<title>Todo | Profile</title>
				</Head>
				<div className="mt-16 flex h-full flex-col items-center justify-center gap-4 align-middle">
					<div>Status: {status}</div>
					<pre>{JSON.stringify(session, null, 4)}</pre>
					<div className="flex gap-2">
						<input type="checkbox" defaultChecked={darkMode} id="dark-mode" />
						<label>Dark Mode</label>
					</div>
					<div>
						<button
							onClick={() => {
								localStorage.setItem("darkMode", (document.getElementById("dark-mode") as HTMLInputElement)?.checked ? "true" : "false");
							}}
							className="rounded-md bg-pad-gray-400 px-4 py-2 hover:bg-pad-gray-500"
						>
							Save
						</button>
					</div>
					<div className="flex flex-col">
						<img src={session?.user?.image ?? ""} alt="Profile Picture" className="mb-2 h-32 w-32 rounded-full  " />
						<div className="text-2xl font-bold">{session?.user?.name}</div>
						<div className="font-light">{session?.user?.email}</div>
					</div>
				</div>
			</CenteredContainer>
		</div>
	);
};

export default profile;
