import InDevelopment from "@/components/layouts/InDevelopment";
import { GetServerSideProps, GetServerSidePropsResult, InferGetServerSidePropsType, NextPage, NextPageContext } from "next";
import { getSession, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import React, { ComponentProps, FunctionComponent } from "react";

export const getServerSideProps: GetServerSideProps = async (context: any) => {
	const { projectid } = context.query;
	// get the session
	const session = await getSession(context);
	if (!session) {
		return {
			redirect: {
				destination: "/login",
				permanent: false,
			},
		};
	}
	// get the project
	const project = { id: projectid }
	return {
		props: {
			project,
		},
	}
}

const ProjectPage: NextPage = ({ project }: InferGetServerSidePropsType<typeof getServerSideProps>) => {
	// get the session
	const { data: session, status } = useSession();
    
	return (
		<div className="flex h-screen items-center">
			{JSON.stringify(session)}
            {project.id}
		</div>
	);
};

export default ProjectPage;
