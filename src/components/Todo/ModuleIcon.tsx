import { Module } from "@/types/page-link";
import { CalendarCheck2, CalendarClock, Flag, ListChecks, Newspaper, Quote } from "lucide-react";

export const ModuleIcon: Record<Module, JSX.Element> = {
	[Module.SUMMARY]: <Newspaper />,
	[Module.CHECKLIST]: <ListChecks />,
	[Module.START_DATE]: <CalendarCheck2 />,
	[Module.END_DATE]: <CalendarClock />,
	[Module.PRIORITY]: <Flag />,
	[Module.DESCRIPTION]: <Quote />
};
