import { Module } from "@/types/page-link";
import { CalendarCheck2, CalendarClock, Flag, ListChecks, Newspaper, Quote } from "lucide-react";

export default function ModuleIcon({ module, className }: {module: Module, className?: string}) {
	switch (module) {
		case Module.SUMMARY:
			return <Newspaper className={className} />;
		case Module.CHECKLIST:
			return <ListChecks className={className} />;
		case Module.START_DATE:
			return <CalendarCheck2 className={className} />;
		case Module.END_DATE:
			return <CalendarClock className={className} />;
		case Module.PRIORITY:
			return <Flag className={className} />;
		case Module.DESCRIPTION:
			return <Quote className={className} />;
		default: return <></>;
	}
}