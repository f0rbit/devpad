"use client";
import React from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
	return <div className="h-full w-full bg-yellow-300">{children}</div>;
}
