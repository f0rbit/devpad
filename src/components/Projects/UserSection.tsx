"use client";
import { ChevronDown, ChevronUp, Github, LogOut, Moon } from "lucide-react";
import { Session } from "next-auth";
import { useState } from "react";
import Image from "next/image";
import { signIn, signOut } from "next-auth/react";

export const UserSection = ({ session }: { session: Session | null }) => {
	const [open, setOpen] = useState(false);
	if (!session) return <button className="text-lg hover:text-blue-300 hover:cursor-pointer flex flex-row gap-1 items-center" onClick={() => signIn("github")}><Github className="w-5" />Login</button>;
	return (
		<div className="relative">
			<div className="flex flex-row items-center justify-center gap-2 hover:cursor-pointer" onClick={() => setOpen(!open)}>
				{/* <div className="text-base">{session?.user?.name}</div> */}
				<Image src={session?.user?.image ?? ""} width={64} height={64} className="h-8 w-8 rounded-full" alt={"profile image"} />
				{open ? <ChevronUp /> : <ChevronDown />}
			</div>
			{open && <ProfileLinks session={session} />}
		</div>
	);
};

const ProfileLinks = ({ session }: { session: Session | null }) => {
	return (
		<div className="absolute top-[120%] right-2 z-50">
			<div className="w-40 rounded-md border-1 border-[#5c5c65] bg-[#323236] text-[#a8a7b2]">
				<div className="flex flex-col gap-0 py-1 text-sm">
					<div className="mb-1 border-b-1 border-b-[#5c5c65] px-3 pt-1 pb-2">
						<div className="truncate text-base" title={session?.user?.name ?? ""}>
							{session?.user?.name}
						</div>
						<div className="truncate" title={session?.user?.email ?? ""}>
							{session?.user?.email}
						</div>
					</div>
					{/* <div className="border-b border-white"></div> */}
					<div className="mx-1 flex flex-row items-center gap-3 rounded-md px-2 py-1 hover:cursor-pointer hover:bg-[#47474d]">
						<div>
							<Moon className="w-5" />
						</div>
						<div>Change Theme</div>
					</div>
					<div className="mx-1 flex flex-row items-center gap-3 rounded-md px-2 py-1 font-bold text-red-400 hover:cursor-pointer hover:bg-[#47474d]" onClick={() => signOut()}>
						<div>
							<LogOut className="w-5" />
						</div>
						<div>Logout</div>
					</div>
				</div>
			</div>
		</div>
	);
};
