const ErrorWrapper = ({message}: {message: string}) => {
    return (<div className="bg-red-300 py-2 px-4 rounded-lg text-red-100 font-bold w-max h-max">
        {message}
    </div>)
}

export default ErrorWrapper;