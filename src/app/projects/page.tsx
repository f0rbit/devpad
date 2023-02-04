import CenteredContainer from "@/components/CenteredContainer";
import TitleInjector from "@/components/Projects/TitleInjector";
import Link from "next/link";

export default function HomePage() {
	return (
		<CenteredContainer>
			<TitleInjector title="Home" />
			<div className="pt-8 flex w-full flex-col justify-center gap-2 text-center text-[#d9d8e1]">
				<div className="text-3xl font-bold">Recent Projects</div>
				<div className="h-96 w-full rounded-xl border-1 border-borders-primary bg-base-accent-primary"></div>
				<div className="flex flex-row justify-center gap-2 text-lg font-semibold">
					<Link href={"/project"}>
						<button className="rounded-xl bg-accent-btn-secondary px-4 py-0.5 hover:bg-accent-btn-secondary-hover">View All</button>
					</Link>
					<button className="rounded-xl bg-accent-btn-secondary px-4 py-0.5 hover:bg-accent-btn-secondary-hover">Create New</button>
				</div>
				<div className="text-3xl font-bold">Weekly Tasks</div>
				<div className="h-96 w-full rounded-xl border-1 border-borders-primary bg-base-accent-primary"></div>
			</div>
		</CenteredContainer>
	);
}
