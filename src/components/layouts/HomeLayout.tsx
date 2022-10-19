import Head from 'next/head';
import { ReactNode } from 'react';

const HomeLayout = ({
    title,
    children
}: {
    title: string;
    children: ReactNode;
}) => {
    return (
        <div className="relative overflow-x-hidden">
            <Head>
                <title>{'devpad | ' + title}</title>
                <link rel="shortcut icon" href="/devpad-favicon.ico" />
            </Head>
            <main>{children}</main>
            <footer className="absolute bottom-0 w-screen h-[52px] bg-neutral-900 p-4">
                <div className="text-center font-sans text-sm text-neutral-500">
                    <span>website by </span>
                    <a
                        href="https://forbit.dev"
                        className="hover:text-blue-500 hover:underline"
                    >
                        forbit.dev
                    </a>
                </div>
            </footer>
        </div>
    );
};

export default HomeLayout;
