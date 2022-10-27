export const linkClass = "text-gray-500 dark:text-pad-gray-400";
export const hoverClass =
	"cursor-pointer hover:text-pad-purple-500 dark:hover:text-pad-purple-500 transition-colors duration-300";
export const hoverLinkClass = linkClass + " " + hoverClass;

export default function HoverLink({ text }: { text: string }) {
	return <span className={hoverLinkClass + " w-max"}>{text}</span>;
}
