import { StaticImageData } from "next/image";

export enum ApplicationVersion {
	NOT_STARTED = "Not Started",
	IN_DEVELOPMENT = "In Development",
	IN_TESTING = "In Testing",
	RELEASED = "Released"
}

export type Application = {
	reverse: boolean;
	version: ApplicationVersion;
	icon: string | JSX.Element;
	title: string;
	description: string;
	images: StaticImageData[];
	link: string;
}


