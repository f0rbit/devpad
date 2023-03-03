"use client";
import { FetchedProject } from "@/types/page-link";
import { useState } from "react";

export default function ProjectSpecification({ project }: { project: FetchedProject }) {
	const [specification, setSpecification] = useState(project.specification);

	return <textarea placeholder="Detailed Specification" className="scrollbar-hide h-48 text-base-text-subtlish" value={specification ?? undefined}></textarea>;
}
