import { exampleRouter } from "@/server/trpc/router/example";
import { publicProcedure } from "@/server/trpc/trpc";
import { TRPCClient } from "@trpc/client";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { trpc } from "src/utils/trpc";

const ListRenderer = () => {
    const { selectedSection } = useContext(TodoContext);
    const { data } = trpc.example.getAll.useQuery();
    if (!data) {
        return <div>Loading...</div>;
    }
    return (
        <div className="h-full w-full overflow-auto bg-gray-100 dark:bg-pad-gray-800">
            <div className="h-[2000px] w-full">
                <h2>{selectedSection} Items</h2>
                <div>
                    {data.map((item, index) => {
                        return (
                            <pre key={index}>
                                {JSON.stringify(item, null, 2)}
                            </pre>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ListRenderer;
