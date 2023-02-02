import ErrorWrapper from "@/components/ErrorWrapper";
import InDevelopment from "@/components/layouts/InDevelopment";
import { GetServerSideProps, GetServerSidePropsResult, InferGetServerSidePropsType, NextPage, NextPageContext } from "next";
import { getSession, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { ComponentProps, FunctionComponent, useContext } from "react";
import { trpc } from "src/utils/trpc";
import { ProjectsContext } from "../_app";

const ProjectPage: NextPage = () => {
	const { projectid } = useRouter().query;
	const { projects, fetched } = useContext(ProjectsContext);
	
	if (!fetched) {
		return (
			<div className="flex h-screen items-center justify-center">
				<ErrorWrapper message="No Data" />
				<Link href={"/"}>Go Back</Link>
			</div>
		);
	}
	const project = projects.find((project) => project.project_id === projectid);
	// get the session
    if (!project) {
		return <div className="flex h-screen items-center w-screen justify-center">
			<ErrorWrapper message="Project not found!"></ErrorWrapper>
		</div>
	}
	console.log(project);
	return (
		<div className="flex h-screen items-center">
			<pre>
            {JSON.stringify(project, null, 2)}
			</pre>
		</div>
	);
};

export default ProjectPage;
