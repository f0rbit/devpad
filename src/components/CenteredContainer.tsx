import { ReactNode } from 'react';

const CenteredContainer = ({ children }: { children: ReactNode }) => {
    return (
        <div className="mx-4 flex justify-center">
            <div className="2xl:w-1/2 w-full lg:w-3/4 xl:w-2/3">
                {children}
            </div>
        </div>
    );
};

export default CenteredContainer;
