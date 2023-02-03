export type PageLink = {
	title: string;
	destination: string;
	colour?: string;
};

export enum Module {
	SUMMARY = "summary",
	CHECKLIST = "checklist",
	START_DATE = "start_date",
	END_DATE = "end_date",
	PRIORITY = "priority",
	DESCRIPTION = "description",
}

export enum TaskPriority {
	LOW,
	MEDIUM,
	HIGH,
	URGENT,
}

export type ProjectRouteLink = {
    text: string;
    href: string;
}