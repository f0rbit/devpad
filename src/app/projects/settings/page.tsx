import CenteredContainer from "@/components/common/CenteredContainer";
import TitleInjector from "@/components/Projects/TitleInjector";

export default function HomePage() {
	return (
		<CenteredContainer>
			<TitleInjector title="Settings" />
			<div className="pt-8 flex w-full flex-col justify-center gap-2 text-center text-base-text-secondary">
				<div>Settings</div>
			</div>
		</CenteredContainer>
	);
}
