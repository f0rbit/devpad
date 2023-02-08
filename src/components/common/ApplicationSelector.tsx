"use client"

import { Boxes } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import APPLICATIONS from "../Home/Applications";

export default function ApplicationSelector() {
    const [open, setOpen] = useState(false);
    const path = usePathname();

    // get the first part of the path
    const dir = "/" + path?.split("/")[1];
    
    return (
        <div className="relative flex">
            <button onClick={() => setOpen(!open)} title="Applications">
                <Boxes />
            </button>
            {open && (
                <div className="absolute top-[140%] right-3 border-1 border-borders-primary bg-base-bg-primary p-2 rounded-md z-50 text-base-text-subtlish font-poppins font-semibold">
                    { APPLICATIONS.map((app, index) => 
                        <Link href={app.link} key={index} onClick={() => setOpen(false)}>
                            <div className="flex flex-row items-center gap-2 w-full hover:bg-base-accent-primary px-2 py-1 rounded-md">
                                <div className="w-5 h-5">
                                    {app.icon}
                                </div>
                                <div className={"text-base w-max " + (dir == app.link ? "text-pad-purple-500 font-bold" : "")}>
                                    {app.title}
                                </div>
                            </div>          
                        </Link>
                    )} 
                </div>
            )}
        </div>
    )
}