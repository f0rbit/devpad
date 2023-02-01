export const hoverClass = "cursor-pointer hover:text-pad-purple-500 dark:hover:text-pad-purple-500 transition-colors duration-300";
export const hoverLinkClass = hoverClass;

export default function HoverLink({ text }: { text: string }) {
	return <span className={hoverLinkClass + " w-max"}>{text}</span>;
}
