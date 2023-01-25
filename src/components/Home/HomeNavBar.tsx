import { ReactNode, useContext, useState } from "react";
import { Transition } from "@headlessui/react";
import logo from "public/devpad-logo.png";
import Link from "next/link";
import Image, { StaticImageData } from "next/image";
import HomeButton from "./HomeButton";
import HoverLink from "../HoverLink";
import { LoginContext } from "src/pages/_app";
import { signOut, useSession } from "next-auth/react";
import HOME_LINKS from "@/components/Home/HomeLinks";
import { PageLink } from "@/types/page-link";

const NavLink = (name: string, large: boolean, dest: string) => {
	const { setLoginOpen } = useContext(LoginContext);
	const { status } = useSession();

	const ClickableLink = ({ text, click }: { text: string; click: () => void }) => {
		return (
			<button onClick={click}>
				<HoverLink text={text} />
			</button>
		);
	};

	if (["Login", "Logout"].includes(name)) {
		return status !== "authenticated" ? <ClickableLink text={"Login"} click={() => setLoginOpen(true)} /> : <ClickableLink text={"Logout"} click={() => signOut()} />;
	}

	return (
		<Link href={dest}>
			<a className={"link-hover font-medium"} href={dest}>
				<HoverLink text={name} />
			</a>
		</Link>
	);
};

const Icon = ({ src }: { src: StaticImageData }) => {
	return (
		<div className="flex w-12 justify-center align-middle">
			<Image src={src} width={64} height={64} alt="icon" />
		</div>
	);
};

const MobileMenuIcon = ({ isOpen }: { isOpen: boolean }) => {
	const hamburger = "M4 6h16M4 12h16M4 18h16";
	const cross = "M6 18L18 6M6 6l12 12";
	return (
		<>
			<span className="sr-only">Open main menu</span>
			<svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isOpen ? cross : hamburger} />
			</svg>
		</>
	);
};

const MobileLinks = ({ isOpen }: { isOpen: boolean }) => {
	return (
		<Transition
			show={isOpen}
			enter="transition ease-out duration-100 transform"
			enterFrom="opacity-0 scale-95"
			enterTo="opacity-100 scale-100"
			leave="transition ease-in duration-75 transform"
			leaveFrom="opacity-100 scale-100"
			leaveTo="opacity-0 scale-95"
		>
			<div className="absolute w-full rounded-xl bg-pad-gray-900 md:hidden" id="mobile-menu">
				<div className="flex flex-col items-center justify-center space-y-2 px-2 pt-2 pb-3 sm:px-3">
					{HOME_LINKS.map((l: PageLink, index: number) => l.title != "Login" && <div key={index}>{NavLink(l.title, true, l.destination)}</div>)}
					<HomeButton text={"Login"} dest={"login"} />
				</div>
			</div>
		</Transition>
	);
};

const MobileMenuToggle = ({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (isOpen: boolean) => void }) => {
	return (
		<div className="absolute right-0 -mr-2 flex md:hidden">
			<button
				onClick={() => setIsOpen(!isOpen)}
				type="button"
				className="inline-flex items-center justify-center rounded-md bg-pad-gray-700 p-2 text-white hover:bg-pad-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-neutral-500 "
				aria-controls="mobile-menu"
				aria-expanded="false"
			>
				<MobileMenuIcon isOpen={isOpen} />
			</button>
		</div>
	);
};

const DevpadTitle = ({ noicon }: { noicon: boolean }) => {
	return (
		<div className="absolute left-0 flex items-center justify-center align-middle">
			<div>{!noicon && <Icon src={logo} />}</div>
			<div className="ml-2 text-4xl font-medium text-gray-600 dark:text-white">devpad</div>
		</div>
	);
};

function HomeNavBar({ noicon }: { noicon: boolean }) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<nav className="relative z-50">
			<div className="relative z-50">
				<div className="relative flex h-16 w-full flex-row flex-nowrap items-center justify-center">
					<DevpadTitle noicon={noicon} />
					<div className="absolute right-0 ml-10 hidden items-baseline space-x-4 md:flex lg:space-x-8">
						{HOME_LINKS.map((l: PageLink, index: number) => <div key={index}>{NavLink(l.title, false, l.destination)}</div>)}
						<HomeButton text={"Get Started"} dest={"/get-started"} />
					</div>
					<MobileMenuToggle isOpen={isOpen} setIsOpen={setIsOpen} />
				</div>
			</div>
			<MobileLinks isOpen={isOpen} />
		</nav>
	);
}

export default HomeNavBar;
