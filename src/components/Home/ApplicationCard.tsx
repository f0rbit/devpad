import Image, { StaticImageData } from "next/image";
import { UnwrappedButton } from "@/components/Home/HomeButton";

type ApplicationCardProps = {
	icon: string | JSX.Element;
	title: string;
	description: string;
	version: string;
	reverse: boolean;
	link: string;
	images: StaticImageData[];
};

const ApplicationCard = ({
	icon,
	title,
	description,
	version,
	reverse,
	images,
	link
}: ApplicationCardProps) => {
	return (
		<>
			<div className="absolute left-3 mt-[16%] hidden lg:block">
				<span className="absolute right-0 mr-5 -mt-1 whitespace-nowrap text-right font-mono text-pad-gray-200">
					{version}
				</span>
				<div className="-ml-[10px] h-4 w-4 rounded-full border-2 bg-pad-purple-500 dark:border-pad-gray-900 2xl:-ml-[6px]"></div>
			</div>
			<div
				style={{ minHeight: "24rem" }}
				className={
					"light:bg-gray-50 group relative my-8 flex h-max flex-col space-y-4 rounded-3xl border-2 p-6 transition-all duration-500 hover:scale-105 dark:border-transparent dark:bg-pad-gray-800 dark:hover:border-pad-purple-500 md:origin-left md:border-none dark:md:bg-transparent " +
					(reverse ? "md:flex-row-reverse" : "md:flex-row")
				}
			>
				{images.length > 0 && (
					<div
						style={{ minWidth: "16rem" }}
						className="mt-8 flex w-full items-center justify-center drop-shadow-lg md:mx-8 md:w-1/2 "
					>
						{images?.map((image, index) => {
							return (
								<div key={index} className="w-full shadow-xl">
									<Image
										src={image}
										alt="project image"
										width={1600}
										height={900}
										className="rounded-xl"
									></Image>
								</div>
							);
						})}
					</div>
				)}
				<div className="w-full rounded-3xl p-4 md:relative md:mx-8 md:w-1/2 md:border-2 md:bg-gray-100 md:shadow-lg md:group-hover:border-pad-purple-500 dark:md:border-pad-gray-700 dark:md:bg-pad-gray-800">
					<div className="flex flex-row items-center justify-start text-3xl font-bold drop-shadow-xl">
						<div className="h-8 w-8 drop-shadow-md">{icon}</div>
						<div className="ml-4 text-gray-700 dark:text-white">
							{title}
						</div>
					</div>
					<p className="mt-4 p-2 text-lg text-gray-500 dark:text-neutral-400">
						{description}
					</p>
					<div className="absolute bottom-4 right-0 flex w-full items-center justify-center transition-opacity duration-500 group-hover:opacity-100 md:opacity-0">
						<UnwrappedButton text={"Go!"} dest={link} />
					</div>
				</div>
			</div>
		</>
	);
};

export default ApplicationCard;
