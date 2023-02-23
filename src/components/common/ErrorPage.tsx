import ErrorWrapper from "./ErrorWrapper";
import GenericButton from "./GenericButton";

export default function ErrorPage({error, reset}: {error: Error, reset: () => void}) {
    return (
        <div className="w-full h-full flex flex-col gap-4 justify-center items-center">
            <ErrorWrapper message={error.name +": " + error.message} />
            <pre>{error.stack}</pre>
            <pre>{JSON.stringify(error.cause)}</pre>
            <GenericButton onClick={() => reset()}>Retry</GenericButton>
        </div>
    );
}