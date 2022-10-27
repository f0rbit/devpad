import Head from "next/head";
import { ReactNode } from "react";
import CenteredContainer from "@/components/CenteredContainer";
import HomeNavBar from "../Home/HomeNavBar";
import LoginDialog from "../LoginModal";

const HomeLayout = ({
	title,
	children
}: {
	title: string;
	children: ReactNode;
}) => {
	return (
		<div className="relative overflow-x-hidden">
			<Head>
				<title>{"devpad | " + title}</title>
				<link rel="shortcut icon" href="/devpad-favicon.ico" />
			</Head>
			<main style={{ minHeight: "calc(100vh - 52px)" }}>
				<CenteredContainer>
					<div className="relative w-full">
						<HomeNavBar noicon={false} />
					</div>
					<LoginDialog />
					{children}
				</CenteredContainer>
			</main>
			<footer className="h-[52px] w-screen bg-gray-300 p-4 dark:bg-neutral-900">
				<div className="text-center font-sans text-sm text-neutral-500">
					<span>website by </span>
					<a
						href="https://forbit.dev"
						className="hover:text-blue-500 hover:underline"
					>
						forbit.dev
					</a>
				</div>
			</footer>
		</div>
	);
};

export default HomeLayout;
