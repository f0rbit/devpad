import { Home, Menu, Search } from "lucide-react";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import HoverLink, { hoverLinkClass } from "../HoverLink";

const TodoNavbar = () => {
	const { toggleList } = useContext(TodoContext);
	return (
		<div className="bg-gray-200 dark:bg-pad-gray-900">
			<div className="mx-4 my-1 flex h-[40px] flex-row items-center gap-4 py-1 text-gray-600 dark:text-pad-gray-300">
				<button onClick={toggleList} className={hoverLinkClass}>
					<Menu className={"min-w-min"} />
				</button>
				{/* <div className="ml-auto flex flex-row-reverse items-center gap-4">
					<HoverLink text={"Profile"} />
					<HoverLink text={"Settings"} />
					<HoverLink text={"Help"} />
				</div> */}
			</div>
		</div>
	);
};

export default TodoNavbar;
