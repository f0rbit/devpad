import CenteredContainer from "@/components/CenteredContainer";
import TitleInjector from "@/components/Projects/TitleInjector";
import Link from "next/link";

export default function HomePage() {
	return (
		<CenteredContainer>
			<TitleInjector title="Home" />
			<div className="pt-8 flex w-full flex-col justify-center gap-2 text-center text-[#d9d8e1]">
				<div className="text-3xl font-bold">Recent Projects</div>
				<div className="h-96 w-full rounded-md border-1"></div>
				<div className="flex flex-row justify-center gap-2">
					<Link href={"/project"}>
						<button className="rounded-md border-1 border-[#5c5c65] bg-[#323236] px-4 py-0.5 text-xl hover:bg-[#3f3f43]">View All</button>
					</Link>
					<button className="rounded-md border-1 border-[#5c5c65] bg-[#323236] px-4 py-0.5 text-xl hover:bg-[#3f3f43]">Create New</button>
				</div>
				<div className="text-3xl font-bold">Weekly Tasks</div>
				<div className="h-96 w-full rounded-md border-1"></div>
			</div>
		</CenteredContainer>
	);
}
