import { Step, Stepper } from "@f0rbit/ui";

export default function HowItWorks() {
	return (
		<Stepper>
			<Step title="connect" description="sign in with github" />
			<Step title="write" description="create and edit posts in markdown" />
			<Step title="publish" description="go live instantly or schedule for later" />
		</Stepper>
	);
}
