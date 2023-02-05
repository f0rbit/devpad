"use client"
import ErrorWrapper from "@/components/ErrorWrapper";

export default function ErrorPage({error, reset}: {error: Error, reset: () => void}) {
    return (
        <div className="w-full h-full flex flex-col gap-4 justify-center items-center">
            <ErrorWrapper message={error.name +": " + error.message} />
            <pre>{error.stack}</pre>
            <pre>{JSON.stringify(error.cause)}</pre>
            <button className="bg-pad-gray-400 px-4 py-1 rounded-md border-pad-gray-300 border-1" onClick={() => reset()}>Retry</button>
        </div>
    );
}