const ErrorWrapper = ({ message }: { message: string }) => {
    return (
        <div className="h-max w-max rounded-lg bg-red-300 py-2 px-4 font-bold text-red-100">
            {message}
        </div>
    );
};

export default ErrorWrapper;
