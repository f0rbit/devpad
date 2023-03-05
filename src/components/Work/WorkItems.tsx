"use client";

import { Work } from "@prisma/client";
import Link from "next/link";
import { useState } from "react";
import GenericButton from "../common/GenericButton";

export default function WorkItems({ work }: { work: Work[] }) {
	const [items, setItems] = useState(work);

	return (
		<div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
			{items.map((item, index) => (
				<Link href={`/manager/${item.work_id}`} key={index} className="h-full w-full">
					<GenericButton style="py-3 w-full h-full">
						<h2 className="text-center text-2xl font-semibold">{item.name}</h2>
						<div className="text-center text-sm capitalize text-base-text-dark">{item.type.toLowerCase()}</div>
						<summary className="block text-center text-base-text-subtle">{item.description}</summary>
					</GenericButton>
				</Link>
			))}
		</div>
	);
}
