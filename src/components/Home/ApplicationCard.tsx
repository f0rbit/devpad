import Image, { StaticImageData } from "next/image";
import HomeButton, { UnwrappedButton } from "@/components/Home/HomeButton";

type ApplicationCardProps = {
    icon: string | JSX.Element;
    title: string;
    description: string;
    version: string;
    reverse: boolean;
    link: string;
    images?: StaticImageData[];
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
                <div className="h-4 w-4 -ml-[10px] 2xl:-ml-[6px] rounded-full border-2 dark:border-pad-gray-900 bg-pad-purple-500"></div>
            </div>
            <div
                style={{minHeight: "24rem"}}
                className={
                    "relative md:border-none border-2 dark:md:bg-transparent light:bg-gray-50 dark:bg-pad-gray-800 dark:hover:border-pad-purple-500 dark:border-transparent flex h-max hover:scale-105 space-y-4 md:origin-left transition-all duration-500 rounded-3xl p-6 my-8 group flex-col " + (reverse ? "md:flex-row-reverse" : "md:flex-row")
                }
            >
                {images.length > 0 && <div style={{minWidth: "16rem"}} className="w-full md:w-1/2 drop-shadow-lg md:mx-8 flex justify-center items-center mt-8 ">
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
                </div>}
                <div className="md:relative w-full md:w-1/2 md:bg-gray-100 dark:md:bg-pad-gray-800 md:border-2 dark:md:border-pad-gray-700 md:group-hover:border-pad-purple-500 md:shadow-lg p-4 rounded-3xl md:mx-8">
                    <div className="flex flex-row items-center justify-start text-3xl font-bold drop-shadow-xl">
                        <div className="h-8 w-8 drop-shadow-md">{icon}</div>
                        <div className="ml-4 dark:text-white text-gray-700">{title}</div>
                    </div>
                    <p className="mt-4 text-lg text-gray-500 dark:text-neutral-400 p-2">
                        {description}
                    </p>
                    <div className="w-full absolute bottom-4 right-0 md:opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex justify-center items-center">
                        <UnwrappedButton
                            text={'Go!'}
                            dest={link}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};

export default ApplicationCard;
