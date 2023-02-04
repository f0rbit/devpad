import CenteredContainer from "@/components/CenteredContainer";
import TitleInjector from "@/components/Projects/TitleInjector";

export default function HomePage() {
	return (
		<CenteredContainer>
			<TitleInjector title="Create Project" />
			<div className="pt-8 flex w-full flex-col justify-center gap-2 text-center text-base-text-secondary">
				<div>Create a new project!</div>
			</div>
		</CenteredContainer>
	);
}
