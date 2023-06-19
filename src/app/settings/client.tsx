"use client";

import GenericButton from "@/components/common/GenericButton";
import { generateAPIKey } from "@/server/api/keys";
import { APIKey, User } from "@prisma/client";
import { useState } from "react";

export function SettingsPage({ initial_tags, user_id }: { initial_tags: APIKey[]; user_id: string }) {
	const [tags, setTags] = useState(initial_tags);

	const newKey = async () => {
		const { data, error } = await generateAPIKey({ user_id });
		if (error) {
			console.error(error);
			return;
		}
		if (!data) {
			console.error("invalid response");
			return;
		}
		setTags([...tags, data]);
	};
	return (
		<>
			<h1 className="mb-2 text-center text-3xl font-bold text-base-text-secondary">Settings</h1>
			<pre>{JSON.stringify(tags, null, 2)}</pre>
			<form action={newKey}>
				<GenericButton>Generate Key</GenericButton>
			</form>
		</>
	);
}
