import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { hoverLinkClass } from "../HoverLink";

export type SectionLinkType = {
    title: string;
    description: string;
    icon?: string;
    url: string;
};

const SectionLink = ({ link, mobile }: { link: SectionLinkType, mobile: boolean }) => {
    return (
        <TodoContext.Consumer>
            {({ setSelectedSection, setShowList }) => {
                return (
                    <button
                        title={link.description}
                        className={hoverLinkClass}
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
