import { useContext, useState } from "react";
import SectionLink, { SectionLinkType } from "./SectionItem";
import { ChevronDown, ChevronRight } from "lucide-react";
import { hoverLinkClass } from "../HoverLink";
import { TodoContext } from "src/pages/todo/dashboard";
const CollapseableSection = ({
	title,
	links,
	mobile
}: {
	title: string;
	links: SectionLinkType[];
	mobile: boolean;
}) => {
	const [expanded, setExpanded] = useState(title == "Projects");
	const { selectedSection } = useContext(TodoContext);

	return (
		<div className="h-min">
			<button
				className={"-ml-0.5 inline-flex " + hoverLinkClass}
				onClick={() => {
					setExpanded(!expanded);
				}}
				title={"Expand " + title + " Section"}
			>
				<span>{expanded ? <ChevronRight /> : <ChevronDown />}</span>
				<span>{title}</span>
			</button>
			{expanded && (
				<div className="ml-8 flex flex-col gap-1">
					{links.map((link, index) => {
						return (
							<div key={index} className="">
								<SectionLink
									link={link}
									mobile={mobile}
									selected={selectedSection == link.url}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export default CollapseableSection;
