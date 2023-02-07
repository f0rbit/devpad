"use client"
import { Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HomeButton() {
    const path = usePathname();

    const link = path == "/projects" ? "/" : "/projects";
	return (
		<Link href ={link}>
			<Home />
		</Link>
	);
}
