import { useContext } from "react";
import { TodoContext } from "src/pages/todo";
import { hoverClass, hoverLinkClass } from "../HoverLink";

export type SectionLinkType = {
	title: string;
	description: string;
	icon?: string;
	url: string;
};

const SectionLink = ({
	link,
	mobile,
	selected
}: {
	link: SectionLinkType;
	mobile: boolean;
	selected?: boolean;
}) => {
	return (
		<TodoContext.Consumer>
			{({ setSelectedSection, setShowList }) => {
				return (
					<button
						title={link.description}
						className={
							(selected
								? "text-pad-purple-200 " + hoverClass
								: hoverLinkClass) + " w-full"
						}
						onClick={() => {
							setSelectedSection(link.url);
							if (mobile) setShowList(false);
						}}
					>
						<div className="flex flex-row gap-x-1 align-middle">
							<div>{link.icon}</div>{" "}
							<div className="truncate">{link.title}</div>
						</div>
					</button>
				);
			}}
		</TodoContext.Consumer>
	);
};

export default SectionLink;
