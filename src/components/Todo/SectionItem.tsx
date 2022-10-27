import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
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
							selected
								? "text-pad-purple-200 " + hoverClass
								: hoverLinkClass
						}
						onClick={() => {
							setSelectedSection(link.url);
							if (mobile) setShowList(false);
						}}
					>
						<span>{link.icon}</span> <span>{link.title}</span>
					</button>
				);
			}}
		</TodoContext.Consumer>
	);
};

export default SectionLink;
