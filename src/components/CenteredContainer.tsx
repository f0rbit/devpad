import { ReactNode } from "react";

const CenteredContainer = ({ children }: { children: ReactNode }) => {
	return (
		<div className="relative z-0 mx-4 flex justify-center">
			<div className="w-full lg:w-3/4 xl:w-2/3 2xl:w-1/2">{children}</div>
		</div>
	);
};

export default CenteredContainer;
