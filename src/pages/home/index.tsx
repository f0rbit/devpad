import HomeLayout from "@/components/layouts/HomeLayout";
import { NextPage } from "next";
import APPLICATIONS from "@/components/Home/Applications";
import ApplicationCard from "@/components/Home/ApplicationCard";

const home: NextPage = () => {
	return (
		<HomeLayout title={"Home Page"}>
			<div className="relative mt-24 mb-12 flex flex-row flex-nowrap">
				<div className="relative left-0 hidden w-24 justify-center lg:flex ">
					<div style={{ height: "calc(100% - 30px)" }} className="w-1 rounded-full bg-pad-purple-500"></div>
				</div>
				<div className="">
					{APPLICATIONS.map((application, index) => (
						<ApplicationCard key={index} application={application} />
					))}
				</div>
			</div>
		</HomeLayout>
	);
};

export default home;
