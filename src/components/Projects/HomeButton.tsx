"use client"
import { CornerDownLeft, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HomeButton() {
    const path = usePathname();

	// if path is only one level deep, then the home button should link to the root
	// if path is more than one level deep, then the home button should link to the parent directory
	
	const link = !path ? "/" : path.split("/").length > 2 ? path.split("/").slice(0, -1).join("/") : "/";


	return (
		<Link href ={link} title={link == "/" ? "Home" : "Back"}>
			{link == "/" ? <Home /> : <CornerDownLeft />}
		</Link>
	);
}
