import { ReactNode, useState } from 'react';
import { Transition } from '@headlessui/react';
import logo from 'public/devpad-logo.png';
import Link from 'next/link';
import Image from 'next/image';
import { PageLink } from '@/types/page-link';
import HomeButton from './HomeButton';

const HOME_LINKS: PageLink[] = [
    {
        title: 'Home',
        destination: '/'
    },
    {
        title: 'Features',
        destination: '/features'
    },
    {
        title: 'Plans',
        destination: '/plans'
    },
    {
        title: 'Resources',
        destination: '/resources'
    },
    {
        title: 'Login',
        destination: '/login'
    }
];

function NavLink(name: string, large: boolean, dest: string) {
    return (
        <Link href={dest}>
            <a
                className={
                    'font-medium text-gray-500 hover:text-pad-purple-500 dark:text-pad-gray-400'
                }
                href={dest}
            >
                {name}
            </a>
        </Link>
    );
}

const Icon = () => {
    return (
        <div className="flex w-12 justify-center align-middle">
            <Image src={logo} width={64} height={64} alt="icon" />
        </div>
    );
};

const Hamburger = ({ isOpen }: { isOpen: boolean }) => {
    return (
        <>
            <span className="sr-only">Open main menu</span>
            {!isOpen ? (
                <svg
                    className="block h-6 w-6"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M4 6h16M4 12h16M4 18h16"
                    />
                </svg>
            ) : (
                <svg
                    className="block h-6 w-6"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            )}
        </>
    );
};
type NavProps = {
    noicon: boolean;
};

function HomeNavBar({ noicon }: NavProps) {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <nav className="">
            <div className="relative">
                <div className="relative flex h-16 w-full flex-row flex-nowrap items-center justify-center">
                    <div className="absolute left-0 flex items-center justify-center align-middle">
                        <div>{!noicon && <Icon />}</div>
                        <div className="ml-2 text-4xl font-medium text-pad-gray-600 dark:text-white">
                            devpad
                        </div>
                    </div>
                    <div className="absolute right-0 ml-10 hidden items-baseline space-x-4 lg:space-x-8 md:flex">
                        {HOME_LINKS.map((l: PageLink) =>
                            NavLink(l.title, false, l.destination)
                        )}
                        <HomeButton
                            text={'Get Started'}
                            dest={'/get-started'}
                        />
                    </div>
                    <div className="-mr-2 flex md:hidden absolute right-0">
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            type="button"
                            className="inline-flex items-center justify-center rounded-md bg-neutral-800 p-2 text-neutral-500 hover:bg-neutral-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-neutral-500 "
                            aria-controls="mobile-menu"
                            aria-expanded="false"
                        >
                            <Hamburger isOpen={isOpen}/>
                        </button>
                    </div>
                </div>
                
            </div>
                <Transition
                    show={isOpen}
                    enter="transition ease-out duration-100 transform"
                    enterFrom="opacity-0 scale-95"
                    enterTo="opacity-100 scale-100"
                    leave="transition ease-in duration-75 transform"
                    leaveFrom="opacity-100 scale-100"
                    leaveTo="opacity-0 scale-95"
                >
                    {() => (
                        <div className="md:hidden absolute w-full bg-red-500" id="mobile-menu">
                            <div className="flex flex-col justify-center items-center space-y-2 px-2 pt-2 pb-3 sm:px-3">
                                {HOME_LINKS.map((l: PageLink) =>
                                    NavLink(l.title, true, l.destination)
                                )}
                            </div>
                        </div>
                    )}
                </Transition>
        </nav>
    );
}

export default HomeNavBar;
