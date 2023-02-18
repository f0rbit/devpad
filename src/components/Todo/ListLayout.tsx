import { LayoutGrid, LayoutList } from "lucide-react";

// export const TODO_LAYOUT = {
// 	LIST: "LIST",
// 	GRID: "GRID"
// };

// export type TodoLayout = typeof TODO_LAYOUT[keyof typeof TODO_LAYOUT];
export enum TODO_LAYOUT {
	LIST = "LIST",
	GRID = "GRID"
}

export const LayoutIcon = ({ layout }: { layout: string }) => {
	switch (layout) {
		case TODO_LAYOUT.LIST:
			return <LayoutList />;
		case TODO_LAYOUT.GRID:
			return <LayoutGrid />;
		default:
			return <></>;
	}
};
