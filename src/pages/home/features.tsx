import HomeLayout from "@/components/layouts/HomeLayout";
import InDevelopment from "@/components/layouts/InDevelopment";
import { NextPage } from "next";

const calendar: NextPage = () => {
    return (
        <HomeLayout title={"Features"}>
            <div className="mt-[40vh]">

                <InDevelopment message={"This page is not implemented yet!"} />
            </div>
        </HomeLayout>
    );
};

export default calendar;
