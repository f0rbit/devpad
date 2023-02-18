import TodoCreator from "@/components/common/TodoCreator";
import { CreateItemOptions } from "@/types/page-link";

export const TodoCreateForm = ({ createItem, setOpen }: { createItem: (item: CreateItemOptions) => void; setOpen: (open: boolean) => void }) => {
	return (
		<div className="w-[56rem] max-w-[85vw]">
			<TodoCreator
				onCreate={(item) => {
					createItem(item);
					setOpen(false);
				}}
			/>
		</div>
	);
};

export default TodoCreateForm;
