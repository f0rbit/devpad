import InDevelopment from "@/components/layouts/InDevelopment";
import { NextPage } from "next";
import Head from "next/head";

const calendar: NextPage = () => {
	return (
		<div className="flex h-screen items-center">
			<Head>
				<title>Todo | Home</title>
			</Head>
			<InDevelopment />
		</div>
	);
};

export default calendar;
