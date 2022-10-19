import ErrorWrapper from '@/components/ErrorWrapper';

const InDevelopment = ({ message }: { message?: string }) => {
    return (
        <div className="flex h-screen w-screen items-center justify-center pb-32 align-middle ">
            <span className="drop-shadow-md">
                <ErrorWrapper
                    message={message ?? 'This app is still in development!'}
                />
            </span>
        </div>
    );
};
export default InDevelopment;
