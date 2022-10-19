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
        <>
            <Head>
                <title>{'devpad | ' + title}</title>
            </Head>
            <main style={{ minHeight: 'calc(100vh - 52px)' }}>{children}</main>
            <footer className="h-[52px] bg-neutral-900 p-4">
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
        </>
    );
};

export default HomeLayout;
