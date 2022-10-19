import { ReactNode } from 'react';

const CeneteredContainer = ({ children }: { children: ReactNode }) => {
    return (
        <div className="mx-4 flex justify-center">
            <div className="2xl:1/2 w-full text-white lg:w-3/4 xl:w-2/3">
                {children}
            </div>
        </div>
    );
};

export default CeneteredContainer;
