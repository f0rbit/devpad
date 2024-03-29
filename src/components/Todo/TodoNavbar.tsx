import { Menu } from "lucide-react";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo";
import { hoverLinkClass } from "../HoverLink";

const TodoNavbar = () => {
	const { toggleList } = useContext(TodoContext);
	return (
		<div className="bg-gray-700 dark:bg-base-bg-primary">
			<div className="mx-4 my-1 flex h-[40px] flex-row items-center gap-4 py-1 text-gray-600 dark:text-base-text-subtlish">
				<button onClick={toggleList} className={hoverLinkClass}>
					<Menu className={"min-w-min"} />
				</button>
			</div>
		</div>
	);
};

export default TodoNavbar;
