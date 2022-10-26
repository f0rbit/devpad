import { LayoutGrid, LayoutList } from "lucide-react";

export const TODO_LAYOUT = {
    LIST: "LIST",
    GRID: "GRID", 
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
}