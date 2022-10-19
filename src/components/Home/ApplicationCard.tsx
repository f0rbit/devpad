import Image, { StaticImageData } from 'next/image';

type ImageSource = string | StaticImageData;
type ApplicationCardProps = {
    icon: string | JSX.Element;
    title: string;
    description: string;
    version: string;
    reverse: boolean;
    images?: ImageSource[];
};

const ApplicationCard = ({
    icon,
    title,
    description,
    version,
    reverse,
    images
}: ApplicationCardProps) => {
    return (
        <>
            <div className="absolute left-[1.69%] mt-2">
                <span className="absolute right-0 mr-5 -mt-1 whitespace-nowrap text-right font-mono text-pad-gray-200">
                    {version}
                </span>
                <div className=" h-4 w-4  rounded-full border-2 border-pad-gray-900 bg-pad-purple-500"></div>
            </div>
            <div
                className={
                    'flex h-96 ' + (reverse ? 'flex-row-reverse' : 'flex-row')
                }
            >
                <div className="w-1/2 drop-shadow-lg">
                    {images?.map((image, index) => {
                        console.log(image);
                        return (
                            <div key={index} className="w-96">
                                <Image
                                    src={image}
                                    alt="project image"
                                    width={1600}
                                    height={900}
                                ></Image>
                            </div>
                        );
                    })}
                </div>
                <div className="w-1/2">
                    <div className="flex flex-row items-center justify-start align-middle text-3xl font-bold drop-shadow-xl">
                        <div className="w-8 h-8 drop-shadow-md">{icon}</div>
                        <div className="ml-4">{title}</div>
                    </div>
                    <p className="mt-4 mr-16 text-lg text-neutral-400">
                        {description}
                    </p>
                </div>
            </div>
        </>
    );
};

export default ApplicationCard;
